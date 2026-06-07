// Say tool — lets the agent speak through a connected ESP32 device.
// Always persists the message to the DB (visible in web UI chat).
// Additionally speaks it aloud if a device is idle and connected.

import { Type } from '@sinclair/typebox'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { DeviceTransport } from '../utils/device-registry'
import { deviceRegistry } from '../utils/device-registry'
import { createTTS } from '../providers/registry'
import { mp3ToPcm, pcmToOpusFrames } from '../utils/audio-converter'
import { createOpusCodec } from '../utils/opus'
import { loadConfig } from '../utils/config'
import { useDatabase } from '../utils/db'
import { messageBus } from '../utils/message-bus'
import crypto from 'crypto'

export interface SayToolOptions {
  /** Device transport for voice output. If null, voice is skipped. */
  transport?: DeviceTransport | null
  /** Source label (e.g. 'schedule') — used for visual differentiation on device. */
  source?: string
  /** Session ID to associate the message with in the DB. */
  sessionId?: string
}

export function createSayTool(options: SayToolOptions): AgentTool<any> {
  return {
    name: 'say',
    label: 'say',
    description:
      'Speak a message aloud through the device speaker. Use this to proactively say something to the user. ' +
      'The text will be synthesized to speech and played on the device. ' +
      'If the device is busy, the message is saved for the user to read in the web UI.',
    parameters: Type.Object({
      text: Type.String({
        description: 'The text to speak aloud',
      }),
    }),
    execute: async (
      _toolCallId: string,
      params: { text: string },
      signal?: AbortSignal,
    ) => {
      // Always persist to DB
      persistMessage(params.text, options.sessionId)

      // Try voice output if transport is available and device is idle
      const spoke = await trySpeak(params.text, options, signal)

      const status = spoke ? `Spoke: "${params.text}"` : `Saved (device busy): "${params.text}"`
      return {
        content: [{ type: 'text' as const, text: status }],
        details: { text: params.text, spoke },
      }
    },
  }
}

/** Save the message to the messages table so the web UI chat can display it. */
function persistMessage(text: string, sessionId?: string): void {
  try {
    const db = useDatabase()
    const sid = sessionId || getOrCreateSchedulerSession(db)
    const id = crypto.randomUUID()
    const now = Date.now()
    db.prepare(
      'INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(id, sid, 'assistant', text, now)
    messageBus.publish({ id, sessionId: sid, role: 'assistant', content: text, sessionType: 'scheduler', createdAt: now })
  } catch (err) {
    console.error('[say] Failed to persist message:', err)
  }
}

/** Get or create a daily scheduler session so all scheduled messages group together. */
function getOrCreateSchedulerSession(db: import('better-sqlite3').Database): string {
  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  const sessionId = `scheduler-${today}`
  const existing = db.prepare('SELECT id FROM sessions WHERE id = ?').get(sessionId) as any
  if (!existing) {
    db.prepare(
      'INSERT INTO sessions (id, device_id, client_id, started_at, type) VALUES (?, ?, ?, ?, ?)',
    ).run(sessionId, 'scheduler', 'scheduler', Date.now(), 'scheduler')
  }
  return sessionId
}

/** Attempt to speak the text on the device. Returns true if spoken. */
async function trySpeak(
  text: string,
  options: SayToolOptions,
  signal?: AbortSignal,
): Promise<boolean> {
  const transport = options.transport
  if (!transport) return false

  // Check if device is idle — don't interrupt active conversations
  const devices = deviceRegistry.getAll()
  const device = devices[0]
  if (device && device.state !== 'connected' && device.state !== 'idle') {
    console.log(`[say] Device busy (${device.state}), skipping voice output`)
    return false
  }

  try {
    const config = loadConfig()
    const tts = createTTS(config.tts)
    const mp3Data = await tts.synthesize(text, signal)
    const pcmData = await mp3ToPcm(mp3Data, signal)
    const codec = await createOpusCodec(24000, 1)

    try {
      const opusFrames = pcmToOpusFrames(pcmData, codec)
      const ttsStart: Record<string, string> = { type: 'tts', state: 'start' }
      if (options.source) ttsStart.source = options.source
      transport.sendText(JSON.stringify(ttsStart))

      const sentenceStart: Record<string, string> = { type: 'tts', state: 'sentence_start', text }
      if (options.source) sentenceStart.source = options.source
      transport.sendText(JSON.stringify(sentenceStart))

      // Wait for the device to process tts:start and transition to Speaking state.
      // Unlike the voice pipeline (where LLM generation creates a natural delay),
      // say() pre-synthesizes everything — without this pause, audio frames arrive
      // before the device's Schedule() callback executes the state transition,
      // causing the audio service to receive frames in an unexpected state → reboot.
      await new Promise(r => setTimeout(r, 200))

      // Send opus frames at real-time pace (60ms per frame) with drift compensation.
      const FRAME_INTERVAL_MS = 60
      const startTime = Date.now()
      for (let i = 0; i < opusFrames.length; i++) {
        if (signal?.aborted) break
        transport.sendBinary(opusFrames[i]!)
        if (i < opusFrames.length - 1) {
          const nextTargetTime = startTime + ((i + 1) * FRAME_INTERVAL_MS)
          const delay = Math.max(1, nextTargetTime - Date.now())
          await new Promise(r => setTimeout(r, delay))
        }
      }

      transport.sendText(JSON.stringify({ type: 'tts', state: 'stop' }))
      return true
    } finally {
      codec.destroy()
    }
  } catch (err) {
    console.error('[say] Voice output failed:', err)
    return false
  }
}
