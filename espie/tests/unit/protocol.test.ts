import { describe, it, expect } from 'vitest'
import {
  parseProtocolMessage,
  createHelloResponse,
  isTextMessage,
} from '../../server/utils/protocol'

describe('parseProtocolMessage', () => {
  it('parses a hello message', () => {
    const result = parseProtocolMessage('{"type":"hello","version":1}')
    expect(result).not.toBeNull()
    expect(result!.type).toBe('hello')
  })

  it('parses a listen message', () => {
    const result = parseProtocolMessage(
      '{"type":"listen","state":"start","mode":"auto"}'
    )
    expect(result).not.toBeNull()
    expect(result!.type).toBe('listen')
    if (result && result.type === 'listen') {
      expect(result.state).toBe('start')
      expect(result.mode).toBe('auto')
    }
  })

  it('returns null for invalid JSON', () => {
    const result = parseProtocolMessage('not json')
    expect(result).toBeNull()
  })

  it('returns null for JSON without type field', () => {
    const result = parseProtocolMessage('{"data":"hello"}')
    expect(result).toBeNull()
  })
})

describe('createHelloResponse', () => {
  it('creates a hello response with correct structure', () => {
    const response = createHelloResponse('session-123')
    expect(response.type).toBe('hello')
    expect(response.transport).toBe('websocket')
    expect(response.session_id).toBe('session-123')
    expect(response.audio_params).toEqual({
      format: 'opus',
      sample_rate: 24000,
      channels: 1,
      frame_duration: 60,
    })
  })

  it('uses the provided session id', () => {
    const response = createHelloResponse('abc-def-456')
    expect(response.session_id).toBe('abc-def-456')
  })
})

describe('isTextMessage', () => {
  it('returns true for a string', () => {
    expect(isTextMessage('{"type":"hello"}')).toBe(true)
  })

  it('returns false for a Buffer', () => {
    expect(isTextMessage(Buffer.from([0x01, 0x02]))).toBe(false)
  })

  it('returns false for a Uint8Array', () => {
    expect(isTextMessage(new Uint8Array([0x01, 0x02]))).toBe(false)
  })

  it('returns false for null', () => {
    expect(isTextMessage(null)).toBe(false)
  })
})
