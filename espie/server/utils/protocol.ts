// ESP32 WebSocket Protocol Type Definitions
// Defines all message types exchanged between the ESP32 device and the Espie server.

// --- Incoming messages (Device -> Server) ---

export interface HelloMessage {
  type: 'hello'
  version?: number
  audio_params?: {
    format: string
    sample_rate?: number
    channels?: number
    frame_duration?: number
  }
  features?: {
    mcp?: boolean
  }
}

export interface ListenMessage {
  type: 'listen'
  state: 'start' | 'stop' | 'detect'
  mode?: 'auto' | 'manual'
}

export interface AbortMessage {
  type: 'abort'
}

export interface PingMessage {
  type: 'ping'
}

// --- Outgoing messages (Server -> Device) ---

export interface HelloResponse {
  type: 'hello'
  version: number
  transport: 'websocket'
  session_id: string
  audio_params: {
    format: 'opus'
    sample_rate: 24000
    channels: 1
    frame_duration: 60
  }
}

export interface SttMessage {
  type: 'stt'
  text: string
}

export interface TtsMessage {
  type: 'tts'
  state: 'start' | 'stop' | 'sentence_start' | 'sentence_end'
  text?: string
}

export interface LlmMessage {
  type: 'llm'
  text: string
  emotion?: string
}

export interface MusicMessage {
  type: 'music'
  state: 'playing' | 'idle'
  title?: string
  artist?: string
}

// --- Union types ---

export interface PongMessage {
  type: 'pong'
}

export type DeviceMessage = HelloMessage | ListenMessage | AbortMessage | PingMessage
export type ServerMessage = HelloResponse | SttMessage | TtsMessage | LlmMessage | MusicMessage | PongMessage

// --- Helper functions ---

/**
 * Parse a JSON text message from the ESP32 device into a typed protocol message.
 * Returns null if the data is invalid JSON or lacks a `type` field.
 */
export function parseProtocolMessage(data: string): DeviceMessage | null {
  try {
    const parsed = JSON.parse(data)
    if (typeof parsed === 'object' && parsed !== null && typeof parsed.type === 'string') {
      return parsed as DeviceMessage
    }
    return null
  } catch {
    return null
  }
}

/**
 * Create the hello response that the server sends back to the ESP32 device
 * after receiving a hello message. Audio params are hardcoded to match
 * the firmware's expected format.
 */
export function createHelloResponse(sessionId: string): HelloResponse {
  return {
    type: 'hello',
    version: 1,
    transport: 'websocket',
    session_id: sessionId,
    audio_params: {
      format: 'opus',
      sample_rate: 24000,
      channels: 1,
      frame_duration: 60,
    },
  }
}

/**
 * Determine if incoming WebSocket data is a text (JSON) message.
 * Returns true for strings (protocol messages), false for Buffer/Uint8Array (audio frames).
 */
export function isTextMessage(data: unknown): boolean {
  return typeof data === 'string'
}
