import { describe, test, expect, beforeEach, afterEach, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { useDatabase, closeDatabase } from '../../server/utils/db'
import {
  handleProtocolMessage,
  createSession,
  endSession,
} from '../../server/utils/ws-handler'
import type { SessionContext } from '../../server/utils/ws-handler'
import type { DeviceMessage, HelloMessage, ListenMessage, AbortMessage } from '../../server/utils/protocol'

// Track temp dirs for cleanup
const tempDirs: string[] = []

function createTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'espie-ws-test-'))
  tempDirs.push(dir)
  return path.join(dir, 'test.db')
}

function makeSessionContext(overrides?: Partial<SessionContext>): SessionContext {
  return {
    deviceId: 'test-device',
    clientId: 'test-client',
    sessionId: 'test-session-123',
    state: 'connected',
    ...overrides,
  }
}

beforeEach(() => {
  process.env.DATABASE_PATH = createTempDbPath()
})

afterEach(() => {
  closeDatabase()
})

afterAll(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('handleProtocolMessage', () => {
  test('HelloMessage returns HelloResponse with correct fields', () => {
    const ctx = makeSessionContext()
    const msg: HelloMessage = { type: 'hello' }
    const response = handleProtocolMessage(ctx, msg)

    expect(response).not.toBeNull()
    expect(response!.type).toBe('hello')
    expect((response as any).transport).toBe('websocket')
    expect((response as any).audio_params.format).toBe('opus')
    expect((response as any).audio_params.sample_rate).toBe(24000)
  })

  test('HelloMessage stores audio_params from device on session context', () => {
    const ctx = makeSessionContext()
    const msg: HelloMessage = {
      type: 'hello',
      audio_params: { format: 'opus', sample_rate: 16000, channels: 1, frame_duration: 20 },
    }
    handleProtocolMessage(ctx, msg)

    expect(ctx.clientAudioParams).toEqual({
      format: 'opus',
      sample_rate: 16000,
      channels: 1,
      frame_duration: 20,
    })
  })

  test('HelloMessage stores features from device on session context', () => {
    const ctx = makeSessionContext()
    const msg: HelloMessage = {
      type: 'hello',
      features: { mcp: true },
    }
    handleProtocolMessage(ctx, msg)

    expect(ctx.features).toEqual({ mcp: true })
  })

  test('ListenMessage state=start sets session state to listening', () => {
    const ctx = makeSessionContext({ state: 'idle' })
    const msg: ListenMessage = { type: 'listen', state: 'start' }
    const response = handleProtocolMessage(ctx, msg)

    expect(response).toBeNull()
    expect(ctx.state).toBe('listening')
  })

  test('ListenMessage state=stop sets session state to idle', () => {
    const ctx = makeSessionContext({ state: 'listening' })
    const msg: ListenMessage = { type: 'listen', state: 'stop' }
    const response = handleProtocolMessage(ctx, msg)

    expect(response).toBeNull()
    expect(ctx.state).toBe('idle')
  })

  test('ListenMessage state=detect sets session state to listening', () => {
    const ctx = makeSessionContext({ state: 'idle' })
    const msg: ListenMessage = { type: 'listen', state: 'detect' }
    const response = handleProtocolMessage(ctx, msg)

    expect(response).toBeNull()
    expect(ctx.state).toBe('listening')
  })

  test('AbortMessage sets session state to idle', () => {
    const ctx = makeSessionContext({ state: 'speaking' })
    const msg: AbortMessage = { type: 'abort' }
    const response = handleProtocolMessage(ctx, msg)

    expect(response).toBeNull()
    expect(ctx.state).toBe('idle')
  })

  test('unknown message type returns null', () => {
    const ctx = makeSessionContext()
    const msg = { type: 'unknown_garbage' } as unknown as DeviceMessage
    const response = handleProtocolMessage(ctx, msg)

    expect(response).toBeNull()
  })
})

describe('createSession', () => {
  test('inserts a row in sessions table with correct device_id, client_id, started_at', () => {
    const db = useDatabase()
    const sessionId = 'session-ws-001'
    const deviceId = 'esp32-test'
    const clientId = 'client-test'

    createSession(db, deviceId, clientId, sessionId)

    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as {
      id: string
      device_id: string
      client_id: string
      started_at: number
    }

    expect(row).toBeDefined()
    expect(row.id).toBe(sessionId)
    expect(row.device_id).toBe(deviceId)
    expect(row.client_id).toBe(clientId)
    expect(row.started_at).toBeGreaterThan(0)
  })
})

describe('endSession', () => {
  test('updates ended_at for the given session_id', () => {
    const db = useDatabase()
    const sessionId = 'session-ws-002'

    // Create session first
    createSession(db, 'device-1', 'client-1', sessionId)

    // Verify ended_at is null initially
    const before = db.prepare('SELECT ended_at FROM sessions WHERE id = ?').get(sessionId) as { ended_at: number | null }
    expect(before.ended_at).toBeNull()

    // End session
    endSession(db, sessionId)

    // Verify ended_at is set
    const after = db.prepare('SELECT ended_at FROM sessions WHERE id = ?').get(sessionId) as { ended_at: number | null }
    expect(after.ended_at).not.toBeNull()
    expect(after.ended_at).toBeGreaterThan(0)
  })
})
