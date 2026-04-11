// VoicePipeline — per-session voice pipeline orchestrator.
// Coordinates VAD -> ASR -> Agent -> TTS -> Opus for a single device session.
// Implements a 5-state machine: idle -> listening -> processing -> speaking -> idle
// with a speaking -> listening interrupt shortcut for barge-in.
// Supports dependency injection via PipelineOptions for swappable providers and tools.

import { readFile } from 'node:fs/promises'
import { createOpusCodec, type OpusCodec } from './opus'
import { SentenceBuffer } from './sentence-buffer'
import { mp3ToPcm, pcmToOpusFrames } from './audio-converter'
import { createVAD, type VADProcessor, type VADEvent } from '../providers/vad'
import { createASR, type ASRProvider } from '../providers/asr'
import { createTTS, type TTSProvider } from '../providers/tts'
import { createLLMModel } from '../providers/llm'
import { AgentSession } from '../agent/agent-session'
import { createApiKeyResolver } from './config'
import { buildSystemPrompt } from './prompt'
import type { AgentEvent } from '../agent/types'
import type { SttMessage, TtsMessage, LlmMessage, MusicMessage } from './protocol'
import type { MemoryService } from './memory'
import { messageBus } from './message-bus'
import { useDatabase } from './db'
import crypto from 'crypto'

export interface PipelineTransport {
  sendText: (data: string) => void
  sendBinary: (data: Buffer | Uint8Array) => void
}

export type PipelineState = 'idle' | 'listening' | 'processing' | 'speaking'

export interface PipelineOptions {
  sessionId: string
  transport: PipelineTransport
  previousMessages?: Array<{ role: string; content: string }>
  model?: any
  asr?: ASRProvider
  tts?: TTSProvider
  tools?: any[]
  systemPrompt?: string
  memoryService?: MemoryService
}

export class VoicePipeline {
  private state: PipelineState = 'idle'
  private transport: PipelineTransport
  private sessionId: string
  private vad: VADProcessor | null = null
  private asr: ASRProvider
  private tts: TTSProvider
  private agentSession: AgentSession
  private inputCodec: OpusCodec   // 16kHz mono for decoding incoming audio
  private outputCodec: OpusCodec  // 24kHz mono for encoding outgoing audio
  private sentenceBuffer: SentenceBuffer
  private speechPcmBuffers: Buffer[] = []
  private preSpeechRing: Buffer[] = []      // ring buffer for VAD lookback
  private readonly PRE_SPEECH_FRAMES = 5    // 5 × 60ms = 300ms lookback
  private opusSendQueue: Buffer[] = []
  private abortController: AbortController | null = null
  private isSending: boolean = false
  private ttsQueue: string[] = []
  private ttsProcessing: boolean = false
  private lastFrameSentAt: number = 0
  private unsubscribeAgent: (() => void) | null = null
  private conversationLog: Array<{ role: string; content: string }> = []
  private memoryService: MemoryService | null = null
  private musicPlaying: boolean = false
  private musicStreamPromise: Promise<void> | null = null

  /**
   * Create a VoicePipeline via async factory (opus codec init is async).
   */
  static async create(options: PipelineOptions): Promise<VoicePipeline> {
    const [inputCodec, outputCodec] = await Promise.all([
      createOpusCodec(16000, 1),
      createOpusCodec(24000, 1),
    ])
    return new VoicePipeline(options, inputCodec, outputCodec)
  }

  private constructor(options: PipelineOptions, inputCodec: OpusCodec, outputCodec: OpusCodec) {
    this.sessionId = options.sessionId
    this.transport = options.transport
    this.inputCodec = inputCodec
    this.outputCodec = outputCodec
    this.sentenceBuffer = new SentenceBuffer()

    // Use injected providers or fall back to factory defaults
    this.asr = options.asr || createASR()
    this.tts = options.tts || createTTS()

    this.agentSession = new AgentSession({
      systemPrompt: options.systemPrompt || buildSystemPrompt(),
      model: options.model || createLLMModel(),
      tools: options.tools,
      previousMessages: options.previousMessages,
      getApiKey: createApiKeyResolver(),
      label: 'voice',
    })
    this.speechPcmBuffers = []
    this.opusSendQueue = []

    if (options.previousMessages) {
      this.conversationLog = [...options.previousMessages]
    }

    this.memoryService = options.memoryService || null

    this.unsubscribeAgent = this.agentSession.subscribe((event) =>
      this.handleAgentEvent(event),
    )
  }

  /**
   * Initialize async resources (VAD model loading).
   */
  async init(): Promise<void> {
    this.vad = await createVAD()
    console.log(`[pipeline] Initialized for session ${this.sessionId}`)
  }

  /**
   * Process an incoming Opus audio frame from the device.
   * Decodes to PCM, feeds to VAD, handles speech events based on current state.
   */
  private frameCount = 0
  async handleAudioFrame(opusFrame: Buffer): Promise<void> {
    if (this.state === 'idle' || this.state === 'processing' || !this.vad) {
      return
    }
    this.frameCount++
    if (this.frameCount % 100 === 1) {
      console.log(`[pipeline] Audio frame #${this.frameCount}, state=${this.state}, vad=${!!this.vad}, opusLen=${opusFrame.length}`)
    }

    // Decode Opus to PCM: 960 samples at 16kHz = 60ms frame
    let pcmInt16: Buffer
    try {
      pcmInt16 = this.inputCodec.decode(opusFrame, 960)
    } catch (err) {
      if (this.frameCount <= 3) console.error(`[pipeline] Opus decode error: ${err}`)
      return
    }

    // Log first few frames to debug audio
    if (this.frameCount <= 3) {
      let energy = 0
      let maxSample = 0
      for (let i = 0; i < pcmInt16.length; i += 2) {
        const sample = Math.abs(pcmInt16.readInt16LE(i))
        energy += sample
        if (sample > maxSample) maxSample = sample
      }
      const avgEnergy = Math.round(energy / (pcmInt16.length / 2))
      console.log(`[pipeline] Frame #${this.frameCount}: opus=${opusFrame.length}B, pcm=${pcmInt16.length}B, avg=${avgEnergy}, max=${maxSample}, first4opus=[${opusFrame[0]},${opusFrame[1]},${opusFrame[2]},${opusFrame[3]}]`)
    }

    // Feed to VAD
    const events = await this.vad!.processFrame(pcmInt16)

    // Maintain pre-speech ring buffer while listening (before speech detected)
    if (this.state === 'listening' && this.speechPcmBuffers.length === 0) {
      this.preSpeechRing.push(pcmInt16)
      if (this.preSpeechRing.length > this.PRE_SPEECH_FRAMES) {
        this.preSpeechRing.shift()
      }
    }

    for (const event of events) {
      if (event.type !== 'SILENCE') {
        console.log(`[vad] ${event.type} (state=${this.state})`)
      }
      if (this.state === 'listening') {
        switch (event.type) {
          case 'SPEECH_START':
            // Prepend ring buffer (already includes current frame) to capture pre-VAD audio
            this.speechPcmBuffers.push(...this.preSpeechRing)
            this.preSpeechRing = []
            break
          case 'SPEECH_CONTINUE':
            this.speechPcmBuffers.push(pcmInt16)
            break
          case 'SPEECH_END':
            this.speechPcmBuffers.push(pcmInt16)
            console.log(`[vad] Speech segment: ${this.speechPcmBuffers.length} frames`)
            this.processSpeechSegment().catch(err =>
              console.error('[pipeline] Speech processing failed:', err))
            break
          case 'SILENCE':
            break
        }
      } else if (this.state === 'speaking') {
        // Barge-in detection: VAD detects speech while server is speaking
        switch (event.type) {
          case 'SPEECH_START':
            this.interrupt()
            // Start collecting the interrupting speech immediately
            this.speechPcmBuffers.push(pcmInt16)
            break
          case 'SPEECH_CONTINUE':
            if (this.state === 'listening') {
              this.speechPcmBuffers.push(pcmInt16)
            }
            break
          case 'SPEECH_END':
            if (this.state === 'listening') {
              this.speechPcmBuffers.push(pcmInt16)
              this.processSpeechSegment().catch(err =>
                console.error('[pipeline] Speech processing failed:', err))
            }
            break
          case 'SILENCE':
            // No action
            break
        }
      }
    }
  }

  /**
   * Handle protocol messages from the device (listen start/stop, abort).
   */
  async handleProtocolMessage(msg: {
    type: string
    state?: string
    mode?: string
  }): Promise<void> {
    if (msg.type === 'listen' && (msg.state === 'start' || msg.state === 'detect')) {
      console.log(`[pipeline] ${this.sessionId.slice(0,8)}: ${this.state} -> listening`)
      this.state = 'listening'
      this.speechPcmBuffers = []
      this.preSpeechRing = []
      this.vad?.reset()
    } else if (msg.type === 'listen' && msg.state === 'stop') {
      console.log(`[pipeline] ${this.sessionId.slice(0,8)}: ${this.state} -> idle`)
      this.state = 'idle'
    } else if (msg.type === 'abort') {
      console.log(`[pipeline] ${this.sessionId.slice(0,8)}: abort (was ${this.state})`)
      this.interrupt()
    }
  }

  /**
   * Interrupt current speaking/processing. Stops TTS, clears queue, transitions to listening.
   */
  interrupt(): void {
    if (this.state === 'speaking' || this.state === 'processing') {
      this.abortController?.abort()
      this.opusSendQueue = []
      this.ttsQueue = []
      this.musicPlaying = false
      this.musicStreamPromise = null
      this.sendJson({ type: 'tts', state: 'stop' } as TtsMessage)
      this.agentSession.interrupt(this.sentenceBuffer.pending)
      this.sentenceBuffer.clear()
      this.state = 'listening'
      this.speechPcmBuffers = []
      this.preSpeechRing = []
      this.vad?.reset()
      console.log('[pipeline] Interrupted -- returning to listening')
    }
  }

  /**
   * Update the agent's tool definitions at runtime (for plugin hot-reload).
   */
  updateTools(tools: any[]): void {
    this.agentSession.setTools(tools)
  }

  /**
   * Get conversation messages for session persistence on disconnect.
   */
  getConversationMessages(): Array<{ role: string; content: string }> {
    return [...this.conversationLog]
  }

  /**
   * Get the current pipeline state.
   */
  getState(): PipelineState {
    return this.state
  }

  /**
   * Clean up all resources.
   */
  destroy(): void {
    this.abortController?.abort()
    this.opusSendQueue = []
    this.inputCodec.destroy()
    this.outputCodec.destroy()
    if (this.vad) {
      this.vad.destroy()
      this.vad = null
    }
    this.unsubscribeAgent?.()
    this.agentSession.destroy()
    console.log(`[pipeline] Destroyed for session ${this.sessionId}`)
  }

  // --- Private methods ---

  /**
   * Process a collected speech segment: concatenate PCM, transcribe, send to agent.
   */
  private async processSpeechSegment(): Promise<void> {
    this.state = 'processing'

    const pcmData = Buffer.concat(this.speechPcmBuffers)
    this.speechPcmBuffers = []

    // Less than ~100ms of audio at 16kHz (3200 bytes = 1600 samples = 100ms)
    if (pcmData.length < 3200) {
      console.log('[pipeline] Speech segment too short, ignoring')
      this.state = 'listening'
      return
    }

    try {
      const result = await this.asr.transcribe(pcmData)
      const text = result.text

      if (!text || !text.trim()) {
        this.state = 'listening'
        return
      }

      // Use Whisper's language detection to set TTS voice for this response.
      // Only update on detection — short utterances keep the previous language.
      if (result.language) {
        this.tts.setLanguage(result.language)
        console.log(`[pipeline] Language: ${result.language} (from: "${text.slice(0, 50)}")`)
      }

      // Persist user message immediately and broadcast to web UI
      this.conversationLog.push({ role: 'user', content: text })
      this.persistAndBroadcast('user', text)

      // Send STT display message to device
      this.sendJson({ type: 'stt', text } as SttMessage)

      // Begin agent response flow
      this.abortController = new AbortController()
      this.sendJson({ type: 'tts', state: 'start' } as TtsMessage)
      this.state = 'speaking'

      await this.agentSession.prompt(text)

      // Flush remaining sentence buffer after agent completes
      const remaining = this.sentenceBuffer.flush()
      if (remaining) {
        this.enqueueTts(remaining)
      }

      // Wait for TTS queue to drain (all sentences synthesized in order)
      await this.waitForTtsQueueDrain()
      // Wait for music conversion to finish pushing frames before draining send queue
      if (this.musicStreamPromise) {
        await this.musicStreamPromise
        this.musicStreamPromise = null
      }
      // Wait for send queue to drain (all opus frames sent)
      await this.waitForSendQueueDrain()

      // Only send tts:stop if we haven't been interrupted
      if (this.state === 'speaking') {
        this.sendJson({ type: 'tts', state: 'stop' } as TtsMessage)
        this.state = 'idle'
      }
    } catch (err) {
      console.error('[pipeline] Speech processing error:', err)
      if (this.state !== 'idle') {
        this.state = 'idle'
      }
    }
  }

  /**
   * Handle agent events: stream text to sentence buffer and TTS, track conversation.
   * Music playback: when play_music tool completes, stream the downloaded MP3 through
   * the existing MP3->PCM->Opus audio pipeline to the device.
   */
  private handleAgentEvent(event: AgentEvent): void {
    if (this.state !== 'speaking') return

    switch (event.type) {
      case 'text_delta': {
        const sentences = this.sentenceBuffer.push(event.delta)
        // Skip TTS during music — text still displays on device screen
        if (!this.musicPlaying) {
          for (const sentence of sentences) {
            this.enqueueTts(sentence)
          }
        }
        this.sendJson({ type: 'llm', text: event.delta } as LlmMessage)
        break
      }
      case 'text_done':
        this.conversationLog.push({ role: 'assistant', content: event.fullText })
        this.persistAndBroadcast('assistant', event.fullText)
        break
      case 'tool_start':
        this.sendJson({
          type: 'llm',
          text: '...',
          emotion: 'thinking',
        } as LlmMessage)
        break
      case 'tool_end': {
        // Music playback: stream downloaded MP3 through audio pipeline
        if (event.toolName === 'play_music') {
          this.musicPlaying = true
          const output = event.toolOutput as any
          if (output?.details?.path) {
            this.sendJson({
              type: 'music',
              state: 'playing',
              title: output.details.title || 'Unknown',
              artist: output.details.artist || 'Unknown',
            })
            this.musicStreamPromise = this.streamMusicFile(output.details.path)
          }
        }
        break
      }
      case 'turn_end':
        this.musicPlaying = false
        break
      case 'error':
        console.error('[pipeline] Agent error:', event.error)
        break
    }
  }

  /**
   * Stream an MP3 music file through the audio pipeline to the device.
   * Reads the file, converts MP3->PCM->Opus, queues frames for sending.
   */
  private async streamMusicFile(filePath: string): Promise<void> {
    try {
      const mp3Data = await readFile(filePath)
      const pcmData = await mp3ToPcm(mp3Data, this.abortController?.signal)
      const opusFrames = pcmToOpusFrames(pcmData, this.outputCodec)
      this.opusSendQueue.push(...opusFrames)
      this.startSendLoop()
      console.log(`[pipeline] Streaming music: ${filePath} (${opusFrames.length} frames)`)
    } catch (err: any) {
      if (err?.message === 'Aborted') return
      console.error('[pipeline] Music streaming failed:', err)
    }
  }

  /**
   * Add a sentence to the TTS queue for serial processing.
   * Ensures sentences are synthesized and played in order.
   */
  private enqueueTts(sentence: string): void {
    this.ttsQueue.push(sentence)
    this.processTtsQueue()
  }

  private async processTtsQueue(): Promise<void> {
    if (this.ttsProcessing) return
    this.ttsProcessing = true
    while (this.ttsQueue.length > 0) {
      const sentence = this.ttsQueue.shift()!
      await this.synthesizeAndQueue(sentence)
    }
    this.ttsProcessing = false
  }

  /**
   * Synthesize a sentence to audio and queue Opus frames for sending.
   */
  private async synthesizeAndQueue(sentence: string): Promise<void> {
    if (this.abortController?.signal.aborted) return

    this.sendJson({
      type: 'tts',
      state: 'sentence_start',
      text: sentence,
    } as TtsMessage)

    let mp3Data: Buffer
    try {
      mp3Data = await this.tts.synthesize(sentence, this.abortController?.signal)
    } catch (err: any) {
      if (err?.message === 'Aborted') return
      console.error('[pipeline] TTS synthesis failed:', err)
      return
    }

    let pcmData: Buffer
    try {
      pcmData = await mp3ToPcm(mp3Data, this.abortController?.signal)
    } catch (err: any) {
      if (err?.message === 'Aborted') return
      console.error('[pipeline] MP3 to PCM conversion failed:', err)
      return
    }

    const opusFrames = pcmToOpusFrames(pcmData, this.outputCodec)
    this.opusSendQueue.push(...opusFrames)
    this.startSendLoop()

    this.sendJson({ type: 'tts', state: 'sentence_end' } as TtsMessage)
  }

  /**
   * Start the send loop that dispatches Opus frames at real-time pace (60ms intervals).
   * Uses drift-compensating timing: each frame is scheduled relative to the loop start
   * time, so setTimeout jitter doesn't accumulate over long playback (e.g. 3min songs).
   * Injects silence frames when the gap between consecutive sentences exceeds 500ms.
   */
  private startSendLoop(): void {
    if (this.isSending) return
    this.isSending = true

    let startTime = Date.now()
    let framesSent = 0

    const sendNext = () => {
      if (this.opusSendQueue.length === 0 || this.abortController?.signal.aborted) {
        this.isSending = false
        return
      }

      const frame = this.opusSendQueue.shift()!

      // Silence injection: if gap since last frame exceeds 500ms, inject silence frames
      const now = Date.now()
      if (this.lastFrameSentAt > 0) {
        const gap = now - this.lastFrameSentAt
        if (gap > 500) {
          const silenceFrameCount = Math.min(Math.floor(gap / 60), 10)
          // 1440 samples * 2 bytes = 2880 bytes = 60ms of silence at 24kHz
          const silencePcm = Buffer.alloc(2880)
          for (let i = 0; i < silenceFrameCount; i++) {
            const silenceOpus = this.outputCodec.encode(silencePcm, 1440)
            try { this.transport.sendBinary(silenceOpus) } catch { return }
          }
          // Reset timing baseline after silence gap
          startTime = Date.now()
          framesSent = 0
        }
      }

      try { this.transport.sendBinary(frame) } catch { return }
      this.lastFrameSentAt = Date.now()
      framesSent++

      // Drift-compensating timer: schedule relative to start time, not previous frame
      const nextTargetTime = startTime + (framesSent * 60)
      const delay = Math.max(1, nextTargetTime - Date.now())
      setTimeout(sendNext, delay)
    }

    sendNext()
  }

  /**
   * Wait for the TTS queue to drain (all sentences synthesized in order).
   */
  private waitForTtsQueueDrain(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if ((this.ttsQueue.length === 0 && !this.ttsProcessing) || this.abortController?.signal.aborted) {
          resolve()
        } else {
          setTimeout(check, 50)
        }
      }
      check()
    })
  }

  /**
   * Wait for the send queue to drain (all Opus frames sent).
   */
  private waitForSendQueueDrain(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (this.opusSendQueue.length === 0 || this.abortController?.signal.aborted) {
          resolve()
        } else {
          setTimeout(check, 50)
        }
      }
      check()
    })
  }

  /**
   * Send a JSON message to the device via transport.
   */
  private sendJson(msg: SttMessage | TtsMessage | LlmMessage | MusicMessage): void {
    try { this.transport.sendText(JSON.stringify(msg)) } catch {}
  }

  /** Persist a message to DB and broadcast to web UI in real time. */
  private persistAndBroadcast(role: string, content: string): void {
    const id = crypto.randomUUID()
    const now = Date.now()
    try {
      const db = useDatabase()
      db.prepare(
        'INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run(id, this.sessionId, role, content, now)
    } catch (err) {
      console.error('[pipeline] Failed to persist message:', err)
    }
    messageBus.publish({
      id,
      sessionId: this.sessionId,
      role,
      content,
      sessionType: 'voice',
      createdAt: now,
    })
  }
}
