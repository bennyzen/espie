import { describe, it, expect } from 'vitest'
import { createOpusCodec, getOpusBackend } from '../../server/utils/opus'

describe('getOpusBackend', () => {
  it('returns native or wasm string', () => {
    const backend = getOpusBackend()
    expect(['native', 'wasm']).toContain(backend)
  })
})

describe('createOpusCodec', () => {
  it('creates a codec with encode, decode, and destroy methods', () => {
    const codec = createOpusCodec(16000, 1)
    expect(typeof codec.encode).toBe('function')
    expect(typeof codec.decode).toBe('function')
    expect(typeof codec.destroy).toBe('function')
    codec.destroy()
  })

  it('encodes a silence buffer to an Opus frame', () => {
    const codec = createOpusCodec(16000, 1)
    // 320 samples = 20ms at 16kHz mono (16-bit PCM = 640 bytes)
    const silence = Buffer.alloc(640)
    const encoded = codec.encode(silence, 320)
    expect(Buffer.isBuffer(encoded)).toBe(true)
    expect(encoded.length).toBeGreaterThan(0)
    codec.destroy()
  })

  it('decodes an encoded frame back to PCM', () => {
    const codec = createOpusCodec(16000, 1)
    const silence = Buffer.alloc(640)
    const encoded = codec.encode(silence, 320)
    const decoded = codec.decode(encoded, 320)
    expect(Buffer.isBuffer(decoded)).toBe(true)
    // Decoded should be the same size as the original PCM
    expect(decoded.length).toBe(640)
    codec.destroy()
  })
})
