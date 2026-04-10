import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import type { EspiePlugin } from '../../server/utils/plugin-types'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import { Type } from '@sinclair/typebox'

// --- Config Loader Tests ---

describe('loadConfig', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('returns defaults when no config file exists', async () => {
    // Use a non-existent config path
    const originalPath = process.env.CONFIG_PATH
    process.env.CONFIG_PATH = '/tmp/non-existent-config-12345.yaml'

    const { loadConfig } = await import('../../server/utils/config')
    const config = loadConfig()

    expect(config.llm.provider).toBe('anthropic')
    expect(config.llm.model).toBe('claude-sonnet-4-20250514')
    expect(config.asr.provider).toBe('groq')
    expect(config.tts.provider).toBe('edge')
    expect(config.plugins.dir).toBe('./plugins')

    if (originalPath !== undefined) {
      process.env.CONFIG_PATH = originalPath
    } else {
      delete process.env.CONFIG_PATH
    }
  })

  it('reads provider names from yaml config', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const os = await import('os')

    const tmpDir = os.tmpdir()
    const configPath = path.join(tmpDir, `espie-test-config-${Date.now()}.yaml`)

    fs.writeFileSync(configPath, [
      'llm:',
      '  provider: openai',
      '  model: gpt-4o',
      'asr:',
      '  provider: openai',
      'tts:',
      '  provider: openai',
      'plugins:',
      '  dir: ./custom-plugins',
    ].join('\n'))

    const originalPath = process.env.CONFIG_PATH
    process.env.CONFIG_PATH = configPath

    const { loadConfig } = await import('../../server/utils/config')
    const config = loadConfig()

    expect(config.llm.provider).toBe('openai')
    expect(config.llm.model).toBe('gpt-4o')
    expect(config.asr.provider).toBe('openai')
    expect(config.tts.provider).toBe('openai')
    expect(config.plugins.dir).toBe('./custom-plugins')

    // Cleanup
    fs.unlinkSync(configPath)
    if (originalPath !== undefined) {
      process.env.CONFIG_PATH = originalPath
    } else {
      delete process.env.CONFIG_PATH
    }
  })
})

// --- Provider Registry Tests ---

describe('Provider Registry', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  describe('createLLM', () => {
    it('returns anthropic model by default (no config)', async () => {
      const mockModel = { id: 'anthropic-default' }
      vi.doMock('@mariozechner/pi-ai', () => ({
        registerBuiltInApiProviders: vi.fn(),
        getModel: vi.fn().mockReturnValue(mockModel),
      }))

      const { createLLM } = await import('../../server/providers/registry')
      const model = createLLM()

      expect(model).toBe(mockModel)
    })

    it('returns openai model when configured', async () => {
      const mockModel = { id: 'openai-gpt4o' }
      vi.doMock('@mariozechner/pi-ai', () => ({
        registerBuiltInApiProviders: vi.fn(),
        getModel: vi.fn().mockReturnValue(mockModel),
      }))

      const { createLLM } = await import('../../server/providers/registry')
      const model = createLLM({ provider: 'openai', model: 'gpt-4o' })

      expect(model).toBe(mockModel)
    })

    it('throws on unknown provider', async () => {
      vi.doMock('@mariozechner/pi-ai', () => ({
        registerBuiltInApiProviders: vi.fn(),
        getModel: vi.fn(),
      }))

      const { createLLM } = await import('../../server/providers/registry')
      expect(() => createLLM({ provider: 'unknown' })).toThrow('Unknown LLM provider: unknown')
    })
  })

  describe('createASR', () => {
    beforeEach(() => {
      process.env.GROQ_API_KEY = 'test-groq-key'
      process.env.OPENAI_API_KEY = 'test-openai-key'
    })

    afterEach(() => {
      delete process.env.GROQ_API_KEY
      delete process.env.OPENAI_API_KEY
    })

    it('returns Groq ASR provider by default', async () => {
      vi.doMock('groq-sdk', () => ({
        default: class MockGroq {
          audio = { transcriptions: { create: vi.fn().mockResolvedValue({ text: 'test' }) } }
        },
      }))
      vi.doMock('@mariozechner/pi-ai', () => ({
        registerBuiltInApiProviders: vi.fn(),
        getModel: vi.fn(),
      }))

      const { createASR } = await import('../../server/providers/registry')
      const asr = createASR()

      expect(asr).toBeDefined()
      expect(typeof asr.transcribe).toBe('function')
    })

    it('returns OpenAI ASR provider when configured', async () => {
      vi.doMock('openai', () => ({
        default: class MockOpenAI {
          audio = { transcriptions: { create: vi.fn().mockResolvedValue({ text: 'openai-test' }) } }
        },
      }))
      vi.doMock('groq-sdk', () => ({
        default: class MockGroq {
          audio = { transcriptions: { create: vi.fn() } }
        },
      }))
      vi.doMock('@mariozechner/pi-ai', () => ({
        registerBuiltInApiProviders: vi.fn(),
        getModel: vi.fn(),
      }))

      const { createASR } = await import('../../server/providers/registry')
      const asr = createASR({ provider: 'openai' })

      expect(asr).toBeDefined()
      expect(typeof asr.transcribe).toBe('function')
    })

    it('throws on unknown ASR provider', async () => {
      vi.doMock('groq-sdk', () => ({
        default: class MockGroq {},
      }))
      vi.doMock('@mariozechner/pi-ai', () => ({
        registerBuiltInApiProviders: vi.fn(),
        getModel: vi.fn(),
      }))

      const { createASR } = await import('../../server/providers/registry')
      expect(() => createASR({ provider: 'unknown' })).toThrow('Unknown ASR provider: unknown')
    })
  })

  describe('createTTS', () => {
    beforeEach(() => {
      process.env.OPENAI_API_KEY = 'test-openai-key'
    })

    afterEach(() => {
      delete process.env.OPENAI_API_KEY
    })

    it('returns Edge TTS provider by default', async () => {
      vi.doMock('@mariozechner/pi-ai', () => ({
        registerBuiltInApiProviders: vi.fn(),
        getModel: vi.fn(),
      }))

      const { createTTS } = await import('../../server/providers/registry')
      const tts = createTTS()

      expect(tts).toBeDefined()
      expect(typeof tts.synthesize).toBe('function')
    })

    it('returns OpenAI TTS provider when configured', async () => {
      const mockArrayBuffer = new ArrayBuffer(10)
      vi.doMock('openai', () => ({
        default: class MockOpenAI {
          audio = { speech: { create: vi.fn().mockResolvedValue({ arrayBuffer: () => mockArrayBuffer }) } }
        },
      }))
      vi.doMock('@mariozechner/pi-ai', () => ({
        registerBuiltInApiProviders: vi.fn(),
        getModel: vi.fn(),
      }))

      const { createTTS } = await import('../../server/providers/registry')
      const tts = createTTS({ provider: 'openai' })

      expect(tts).toBeDefined()
      expect(typeof tts.synthesize).toBe('function')
    })

    it('throws on unknown TTS provider', async () => {
      vi.doMock('@mariozechner/pi-ai', () => ({
        registerBuiltInApiProviders: vi.fn(),
        getModel: vi.fn(),
      }))

      const { createTTS } = await import('../../server/providers/registry')
      expect(() => createTTS({ provider: 'unknown' })).toThrow('Unknown TTS provider: unknown')
    })
  })
})

// --- EspiePlugin Type Tests ---

describe('EspiePlugin type', () => {
  it('EspiePlugin satisfies AgentTool shape at the type level', () => {
    // This is a compile-time check -- if EspiePlugin does not match AgentTool shape,
    // TypeScript would error. We verify the type exists and is importable.
    const plugin: EspiePlugin = {
      name: 'test-plugin',
      description: 'A test plugin',
      parameters: Type.Object({}),
      label: 'Test',
      execute: async (_toolCallId, _params, _signal?, _onUpdate?) => {
        return { content: [{ type: 'text' as const, text: 'result' }], details: {} }
      },
    }

    expect(plugin.name).toBe('test-plugin')
    expect(plugin.description).toBe('A test plugin')
    expect(typeof plugin.execute).toBe('function')
  })
})
