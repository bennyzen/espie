import { describe, it, expect, vi } from 'vitest'
import { createWavHeader, pcmToOpusFrames } from '../../server/utils/audio-converter'
import type { OpusCodec } from '../../server/utils/opus'

describe('createWavHeader', () => {
  it('returns a 44-byte Buffer', () => {
    const header = createWavHeader(100, 16000, 1, 16)
    expect(header.length).toBe(44)
  })

  it('starts with ASCII RIFF', () => {
    const header = createWavHeader(100, 16000, 1, 16)
    expect(header.toString('ascii', 0, 4)).toBe('RIFF')
  })

  it('has WAVE at offset 8', () => {
    const header = createWavHeader(100, 16000, 1, 16)
    expect(header.toString('ascii', 8, 12)).toBe('WAVE')
  })

  it('has correct sample rate at offset 24', () => {
    const header = createWavHeader(100, 16000, 1, 16)
    expect(header.readUInt32LE(24)).toBe(16000)
  })

  it('has correct data length at offset 40', () => {
    const header = createWavHeader(100, 16000, 1, 16)
    expect(header.readUInt32LE(40)).toBe(100)
  })
})

describe('pcmToOpusFrames', () => {
  function createMockCodec(): OpusCodec {
    return {
      encode: vi.fn().mockReturnValue(Buffer.alloc(10)),
      decode: vi.fn().mockReturnValue(Buffer.alloc(2880)),
      destroy: vi.fn(),
    }
  }

  it('encodes correct number of frames from 3-frame input', () => {
    const codec = createMockCodec()
    const pcm = Buffer.alloc(2880 * 3) // 3 complete frames
    const frames = pcmToOpusFrames(pcm, codec)
    expect(frames).toHaveLength(3)
  })

  it('returns empty array when input is shorter than one frame', () => {
    const codec = createMockCodec()
    const pcm = Buffer.alloc(2000) // less than 2880
    const frames = pcmToOpusFrames(pcm, codec)
    expect(frames).toHaveLength(0)
  })

  it('calls encode with correct frame size and buffer', () => {
    const codec = createMockCodec()
    const pcm = Buffer.alloc(2880)
    pcmToOpusFrames(pcm, codec)
    expect(codec.encode).toHaveBeenCalledWith(
      expect.any(Buffer),
      1440,
    )
    // Verify the buffer passed is 2880 bytes
    const callArg = (codec.encode as ReturnType<typeof vi.fn>).mock.calls[0][0] as Buffer
    expect(callArg.length).toBe(2880)
  })
})
