// VAD Provider — Direct Silero ONNX inference matching the Python server's approach.
// Uses 512-sample chunks with manual state/context management.
// Does NOT use avr-vad — runs onnxruntime-node directly for exact parity.

import { createRequire } from 'node:module'

// Cache on globalThis so the native module survives Nuxt HMR re-evaluation.
// onnxruntime-node's .node binding can only be registered once per process.
let _ort: typeof import('onnxruntime-node') | null = (globalThis as any).__ort_native || null
function getOrt() {
  if (!_ort) {
    const _require = createRequire(import.meta.url)
    _ort = _require('onnxruntime-node')
    ;(globalThis as any).__ort_native = _ort
  }
  return _ort
}

export interface VADEvent {
  type: 'SPEECH_START' | 'SPEECH_END' | 'SPEECH_CONTINUE' | 'SILENCE'
}

const CHUNK_SAMPLES = 512 // Match Python server exactly

export class VADProcessor {
  private session: any = null // onnxruntime InferenceSession
  private state: Float32Array // (2, 1, 128)
  private context: Float32Array // (1, 64) — last 64 samples
  private accumBuffer: Buffer = Buffer.alloc(0)

  // Dual threshold (matching Python: 0.5 / 0.2)
  private speechThreshold = 0.5
  private silenceThreshold = 0.2
  private minSilenceDurationMs = 1000

  // State tracking
  private lastIsVoice = false
  private voiceWindow: boolean[] = [] // sliding window
  private windowSize = 10
  private windowThreshold = 3
  private clientHaveVoice = false
  private lastActivityTime = 0
  private speechStarted = false
  private frameCount = 0

  constructor() {
    this.state = new Float32Array(2 * 1 * 128) // zeros
    this.context = new Float32Array(64) // zeros
  }

  async init(): Promise<void> {
    // Reuse cached ONNX session across HMR rebuilds and reconnects.
    // The Silero model is the same for all connections — no need to re-load from disk.
    if ((globalThis as any).__vad_session) {
      this.session = (globalThis as any).__vad_session
      console.log('[vad] Reusing cached Silero VAD session')
      return
    }

    const ort = getOrt()

    // Find the Silero VAD model bundled with avr-vad
    const { resolve } = await import('path')
    const _require = createRequire(import.meta.url)
    let modelPath: string
    try {
      // avr-vad bundles Silero v5 model next to its dist/index.js
      const avrVadPath = _require.resolve('avr-vad')
      const avrVadDir = avrVadPath.substring(0, avrVadPath.lastIndexOf('/'))
      modelPath = resolve(avrVadDir, 'silero_vad_v5.onnx')
    } catch {
      // Fallback: search node_modules
      const { existsSync } = await import('fs')
      const candidates = [
        resolve(process.cwd(), 'node_modules/avr-vad/dist/silero_vad_v5.onnx'),
        resolve(process.cwd(), 'node_modules/avr-vad/silero_vad_v5.onnx'),
      ]
      modelPath = candidates.find(existsSync) || candidates[0]
    }

    this.session = await ort.InferenceSession.create(modelPath, {
      interOpNumThreads: 1,
      intraOpNumThreads: 1,
    })
    ;(globalThis as any).__vad_session = this.session

    console.log('[vad] Silero VAD initialized (direct ONNX, 512-sample chunks)')
  }

  /**
   * Process raw Int16 PCM from the device. Accumulates into 512-sample chunks
   * and runs inference on each, matching the Python server's approach exactly.
   */
  async processFrame(pcmInt16: Buffer): Promise<VADEvent[]> {
    if (!this.session) throw new Error('VAD not initialized')

    // Accumulate PCM data
    this.accumBuffer = Buffer.concat([this.accumBuffer, pcmInt16])

    const events: VADEvent[] = []
    const ort = getOrt()
    const chunkBytes = CHUNK_SAMPLES * 2

    while (this.accumBuffer.length >= chunkBytes) {
      const chunk = this.accumBuffer.subarray(0, chunkBytes)
      this.accumBuffer = this.accumBuffer.subarray(chunkBytes)

      // Convert Int16 to Float32
      const float32 = new Float32Array(CHUNK_SAMPLES)
      for (let i = 0; i < CHUNK_SAMPLES; i++) {
        float32[i] = chunk.readInt16LE(i * 2) / 32768.0
      }

      // Build input: concatenate context (64 samples) + current chunk (512 samples) = 576
      const inputData = new Float32Array(64 + CHUNK_SAMPLES)
      inputData.set(this.context, 0)
      inputData.set(float32, 64)

      // Run inference
      const inputTensor = new ort.Tensor('float32', inputData, [1, 64 + CHUNK_SAMPLES])
      const stateTensor = new ort.Tensor('float32', new Float32Array(this.state), [2, 1, 128])
      const srTensor = new ort.Tensor('int64', BigInt64Array.from([BigInt(16000)]), [])

      const results = await this.session.run({
        input: inputTensor,
        state: stateTensor,
        sr: srTensor,
      })

      // Update state and context
      const outProb = results.output.data[0] as number
      this.state = new Float32Array(results.stateN.data as Float32Array)
      // Context = last 64 samples of input
      this.context = inputData.slice(-64)

      this.frameCount++
      if (this.frameCount <= 5 || this.frameCount % 200 === 0) {
        console.log(`[vad] chunk #${this.frameCount}: prob=${outProb.toFixed(3)}`)
      }

      // Dual threshold (matching Python server)
      let isVoice: boolean
      if (outProb >= this.speechThreshold) {
        isVoice = true
      } else if (outProb <= this.silenceThreshold) {
        isVoice = false
      } else {
        isVoice = this.lastIsVoice
      }
      this.lastIsVoice = isVoice

      // Sliding window
      this.voiceWindow.push(isVoice)
      if (this.voiceWindow.length > this.windowSize) {
        this.voiceWindow.shift()
      }
      const voiceCount = this.voiceWindow.filter(Boolean).length
      const hasVoice = voiceCount >= this.windowThreshold

      // State machine: detect speech start/end
      if (hasVoice && !this.speechStarted) {
        this.speechStarted = true
        this.clientHaveVoice = true
        this.lastActivityTime = Date.now()
        events.push({ type: 'SPEECH_START' })
      } else if (hasVoice && this.speechStarted) {
        this.lastActivityTime = Date.now()
        events.push({ type: 'SPEECH_CONTINUE' })
      } else if (this.clientHaveVoice && !hasVoice) {
        const silenceDuration = Date.now() - this.lastActivityTime
        if (silenceDuration >= this.minSilenceDurationMs) {
          this.clientHaveVoice = false
          this.speechStarted = false
          events.push({ type: 'SPEECH_END' })
        }
      }
    }

    if (events.length === 0) {
      events.push({ type: 'SILENCE' })
    }

    return events
  }

  reset(): void {
    this.accumBuffer = Buffer.alloc(0)
    this.state = new Float32Array(2 * 1 * 128)
    this.context = new Float32Array(64)
    this.lastIsVoice = false
    this.voiceWindow = []
    this.clientHaveVoice = false
    this.speechStarted = false
    this.lastActivityTime = 0
    this.frameCount = 0
  }

  destroy(): void {
    // Don't destroy the ONNX session — it's cached on globalThis for reuse
    this.session = null
    this.reset()
  }
}

export async function createVAD(): Promise<VADProcessor> {
  const processor = new VADProcessor()
  await processor.init()
  return processor
}
