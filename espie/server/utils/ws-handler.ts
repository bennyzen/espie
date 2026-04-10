// WebSocket handler core logic — testable without a real WebSocket connection.
// Separated from the Nitro route handler for unit testing.

import { parseProtocolMessage, createHelloResponse, isTextMessage } from './protocol'
import type { DeviceMessage, HelloMessage, ServerMessage } from './protocol'
import type Database from 'better-sqlite3'

export interface SessionContext {
  deviceId: string
  clientId: string
  sessionId: string
  state: 'connected' | 'idle' | 'listening' | 'processing' | 'speaking'
  clientAudioParams?: {
    format: string
    sample_rate?: number
    channels?: number
    frame_duration?: number
  }
  features?: { mcp?: boolean }
}

/**
 * Handle a parsed protocol message. Returns a ServerMessage to send back, or null.
 * Mutates ctx.state and ctx.clientAudioParams as side effects.
 */
export function handleProtocolMessage(ctx: SessionContext, msg: DeviceMessage): ServerMessage | null {
  switch (msg.type) {
    case 'hello': {
      const hello = msg as HelloMessage
      if (hello.audio_params) {
        ctx.clientAudioParams = hello.audio_params
      }
      if (hello.features) {
        ctx.features = hello.features
      }
      ctx.state = 'idle'
      return createHelloResponse(ctx.sessionId)
    }

    case 'listen': {
      if (msg.state === 'start' || msg.state === 'detect') {
        ctx.state = 'listening'
      } else if (msg.state === 'stop') {
        ctx.state = 'idle'
      }
      return null
    }

    case 'abort': {
      ctx.state = 'idle'
      return null
    }

    case 'ping': {
      return { type: 'pong' }
    }

    default:
      return null
  }
}

/**
 * Create a new session record in the database.
 */
export function createSession(db: Database.Database, deviceId: string, clientId: string, sessionId: string): void {
  db.prepare(
    'INSERT INTO sessions (id, device_id, client_id, started_at) VALUES (?, ?, ?, ?)'
  ).run(sessionId, deviceId, clientId, Date.now())
}

/**
 * End a session by setting the ended_at timestamp.
 */
export function endSession(db: Database.Database, sessionId: string): void {
  db.prepare(
    'UPDATE sessions SET ended_at = ? WHERE id = ?'
  ).run(Date.now(), sessionId)
}
