import { describe, it, expect, vi, afterEach } from 'vitest'

// --- VAD Tests ---

describe('VADProcessor', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('creates instance without crash', async () => {
    const { VADProcessor } = await import('../../server/providers/vad')
    const processor = new VADProcessor()
    expect(processor).toBeDefined()
  })

  it('processFrame before init() rejects with error', async () => {
    const { VADProcessor } = await import('../../server/providers/vad')
    const processor = new VADProcessor()
    const pcm = Buffer.alloc(1920) // 960 samples * 2 bytes
    await expect(processor.processFrame(pcm)).rejects.toThrow('VAD not initialized')
  })

  it('processFrame with fewer than 1536 samples does not trigger VAD', async () => {
    const mockProcess = vi.fn()
    const mockVad = {
      handleEvent: vi.fn(),
      frameProcessor: { process: mockProcess },
      destroy: vi.fn(),
    }

    vi.doMock('avr-vad', () => ({
      RealTimeVAD: { new: vi.fn().mockResolvedValue(mockVad) },
      Message: {
        SpeechStart: 'SPEECH_START',
        SpeechEnd: 'SPEECH_END',
        SpeechRealStart: 'SPEECH_REAL_START',
        SpeechStop: 'SPEECH_STOP',
        FrameProcessed: 'FRAME_PROCESSED',
      },
    }))

    const { VADProcessor } = await import('../../server/providers/vad')
    const processor = new VADProcessor()
    await processor.init()

    // 960 samples = 1920 bytes (less than 1536 needed)
    const pcm = Buffer.alloc(1920)
    await processor.processFrame(pcm)

    expect(mockProcess).not.toHaveBeenCalled()
  })

  it('processFrame accumulates and triggers VAD when reaching 1536 samples', async () => {
    const mockProcess = vi.fn()
    const mockVad = {
      handleEvent: vi.fn(),
      frameProcessor: { process: mockProcess },
      destroy: vi.fn(),
    }

    vi.doMock('avr-vad', () => ({
      RealTimeVAD: { new: vi.fn().mockResolvedValue(mockVad) },
      Message: {
        SpeechStart: 'SPEECH_START',
        SpeechEnd: 'SPEECH_END',
        SpeechRealStart: 'SPEECH_REAL_START',
        SpeechStop: 'SPEECH_STOP',
        FrameProcessed: 'FRAME_PROCESSED',
      },
    }))

    const { VADProcessor } = await import('../../server/providers/vad')
    const processor = new VADProcessor()
    await processor.init()

    // First call: 960 samples (not enough for 1536)
    const pcm1 = Buffer.alloc(1920)
    await processor.processFrame(pcm1)
    expect(mockProcess).not.toHaveBeenCalled()

    // Second call: 960 more samples, total 1920 >= 1536 so VAD processes once
    const pcm2 = Buffer.alloc(1920)
    await processor.processFrame(pcm2)
    expect(mockProcess).toHaveBeenCalledTimes(1)
    expect(mockProcess).toHaveBeenCalledWith(
      expect.any(Float32Array),
      expect.any(Function),
    )

    // Verify it was called with a Float32Array of length 1536
    const callArg = mockProcess.mock.calls[0][0] as Float32Array
    expect(callArg.length).toBe(1536)
  })

  it('reset sets accumOffset to 0', async () => {
    const mockProcess = vi.fn()
    const mockVad = {
      handleEvent: vi.fn(),
      frameProcessor: { process: mockProcess },
      destroy: vi.fn(),
    }

    vi.doMock('avr-vad', () => ({
      RealTimeVAD: { new: vi.fn().mockResolvedValue(mockVad) },
      Message: {
        SpeechStart: 'SPEECH_START',
        SpeechEnd: 'SPEECH_END',
        SpeechRealStart: 'SPEECH_REAL_START',
        SpeechStop: 'SPEECH_STOP',
        FrameProcessed: 'FRAME_PROCESSED',
      },
    }))

    const { VADProcessor } = await import('../../server/providers/vad')
    const processor = new VADProcessor()
    await processor.init()

    // Push partial data
    const pcm = Buffer.alloc(1920) // 960 samples
    await processor.processFrame(pcm)

    // Reset
    processor.reset()

    // After reset, need full 1536 samples again
    // Push same 960 samples -- should not trigger
    await processor.processFrame(pcm)
    expect(mockProcess).not.toHaveBeenCalled()
  })
})

// --- ASR Tests ---

describe('ASRProvider', () => {
  const originalEnv = process.env.GROQ_API_KEY

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.GROQ_API_KEY = originalEnv
    } else {
      delete process.env.GROQ_API_KEY
    }
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('createASR throws when GROQ_API_KEY is not set', async () => {
    delete process.env.GROQ_API_KEY

    vi.doMock('groq-sdk', () => ({
      default: class MockGroq {},
    }))

    const { createASR } = await import('../../server/providers/asr')
    expect(() => createASR()).toThrow('GROQ_API_KEY environment variable is required for ASR')
  })

  it('transcribe returns transcribed text', async () => {
    process.env.GROQ_API_KEY = 'test-key'

    const mockCreate = vi.fn().mockResolvedValue({ text: 'hello world' })
    vi.doMock('groq-sdk', () => ({
      default: class MockGroq {
        audio = { transcriptions: { create: mockCreate } }
      },
    }))

    const { createASR } = await import('../../server/providers/asr')
    const asr = createASR()
    const result = await asr.transcribe(Buffer.alloc(100))

    expect(result).toBe('hello world')
  })

  it('transcribe calls Groq with whisper-large-v3-turbo model', async () => {
    process.env.GROQ_API_KEY = 'test-key'

    const mockCreate = vi.fn().mockResolvedValue({ text: 'test' })
    vi.doMock('groq-sdk', () => ({
      default: class MockGroq {
        audio = { transcriptions: { create: mockCreate } }
      },
    }))

    const { createASR } = await import('../../server/providers/asr')
    const asr = createASR()
    await asr.transcribe(Buffer.alloc(100))

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'whisper-large-v3-turbo' }),
    )
  })
})

// --- TTS Tests ---

describe('TTSProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('createTTS returns object with synthesize method', async () => {
    const { createTTS } = await import('../../server/providers/tts')
    const tts = createTTS()
    expect(tts).toBeDefined()
    expect(typeof tts.synthesize).toBe('function')
  })

  it('synthesize returns audio buffer from stream', async () => {
    const audioData = new Uint8Array([1, 2, 3])

    vi.doMock('edge-tts-universal', () => ({
      Communicate: class MockCommunicate {
        async *stream() {
          yield { type: 'audio', data: audioData }
        }
      },
    }))

    const { createTTS } = await import('../../server/providers/tts')
    const tts = createTTS()
    const result = await tts.synthesize('hello')

    expect(Buffer.isBuffer(result)).toBe(true)
    expect(result.length).toBeGreaterThan(0)
  })

  it('synthesize rejects with Aborted when signal is pre-aborted', async () => {
    const { createTTS } = await import('../../server/providers/tts')
    const tts = createTTS()

    const controller = new AbortController()
    controller.abort()

    await expect(tts.synthesize('hello', controller.signal)).rejects.toThrow('Aborted')
  })
})

// --- LLM Tests ---

describe('createLLMModel', () => {
  const originalModel = process.env.LLM_MODEL

  afterEach(() => {
    if (originalModel !== undefined) {
      process.env.LLM_MODEL = originalModel
    } else {
      delete process.env.LLM_MODEL
    }
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('calls getModel with anthropic as provider', async () => {
    const mockGetModel = vi.fn().mockReturnValue({ id: 'test' })
    vi.doMock('@earendil-works/pi-ai', () => ({
      registerBuiltInApiProviders: vi.fn(),
      getModel: mockGetModel,
    }))

    const { createLLMModel } = await import('../../server/providers/llm')
    createLLMModel()

    expect(mockGetModel).toHaveBeenCalledWith('anthropic', expect.any(String))
  })

  it('defaults to claude-sonnet-4-20250514 when LLM_MODEL is unset', async () => {
    delete process.env.LLM_MODEL

    const mockGetModel = vi.fn().mockReturnValue({ id: 'test' })
    vi.doMock('@earendil-works/pi-ai', () => ({
      registerBuiltInApiProviders: vi.fn(),
      getModel: mockGetModel,
    }))

    const { createLLMModel } = await import('../../server/providers/llm')
    createLLMModel()

    expect(mockGetModel).toHaveBeenCalledWith('anthropic', 'claude-sonnet-4-20250514')
  })

  it('uses LLM_MODEL env var when set', async () => {
    process.env.LLM_MODEL = 'claude-opus-4-20250514'

    const mockGetModel = vi.fn().mockReturnValue({ id: 'test' })
    vi.doMock('@earendil-works/pi-ai', () => ({
      registerBuiltInApiProviders: vi.fn(),
      getModel: mockGetModel,
    }))

    const { createLLMModel } = await import('../../server/providers/llm')
    createLLMModel()

    expect(mockGetModel).toHaveBeenCalledWith('anthropic', 'claude-opus-4-20250514')
  })
})
