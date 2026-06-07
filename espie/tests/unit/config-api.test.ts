import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdirSync, unlinkSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('saveConfig', () => {
  let tmpDir: string
  let configPath: string
  let originalConfigPath: string | undefined

  beforeEach(() => {
    tmpDir = join(tmpdir(), `espie-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tmpDir, { recursive: true })
    configPath = join(tmpDir, '.config.yaml')
    originalConfigPath = process.env.CONFIG_PATH
    process.env.CONFIG_PATH = configPath
  })

  afterEach(async () => {
    if (originalConfigPath !== undefined) {
      process.env.CONFIG_PATH = originalConfigPath
    } else {
      delete process.env.CONFIG_PATH
    }
    try { rmSync(tmpDir, { recursive: true, force: true }) } catch {}
    const { vi } = await import('vitest')
    vi.resetModules()
  })

  it('writes YAML config to file', async () => {
    const { saveConfig, loadConfig } = await import('../../server/utils/config')

    saveConfig({
      llm: { provider: 'openai', model: 'gpt-4o' },
      asr: { provider: 'groq' },
      tts: { provider: 'edge' },
      plugins: { dir: './plugins' },
    })

    const config = loadConfig()
    expect(config.llm.provider).toBe('openai')
    expect(config.llm.model).toBe('gpt-4o')
  })

  it('merges partial updates with existing config', async () => {
    // Write initial config
    writeFileSync(configPath, [
      'llm:',
      '  provider: anthropic',
      '  model: claude-sonnet-4-20250514',
      'asr:',
      '  provider: groq',
      'tts:',
      '  provider: edge',
      'plugins:',
      '  dir: ./plugins',
    ].join('\n'))

    const { saveConfig, loadConfig } = await import('../../server/utils/config')

    // Only update LLM section
    saveConfig({ llm: { provider: 'openai', model: 'gpt-4o' } })

    const config = loadConfig()
    expect(config.llm.provider).toBe('openai')
    expect(config.llm.model).toBe('gpt-4o')
    // Rest should be preserved
    expect(config.asr.provider).toBe('groq')
    expect(config.tts.provider).toBe('edge')
  })

  it('stores full API keys without masking', async () => {
    const { saveConfig, loadConfig } = await import('../../server/utils/config')

    saveConfig({
      api_keys: { groq: 'gsk_full_key_12345678' },
    })

    const config = loadConfig()
    expect(config.api_keys?.groq).toBe('gsk_full_key_12345678')
  })

  it('does not overwrite a stored API key when saved a masked placeholder', async () => {
    const { saveConfig, loadConfig, maskApiKey } = await import('../../server/utils/config')

    saveConfig({ api_keys: { groq: 'gsk_full_key_12345678' } })
    // The /config UI is served masked secrets and round-trips them back on save.
    saveConfig({ api_keys: { groq: maskApiKey('gsk_full_key_12345678') } })

    expect(loadConfig().api_keys?.groq).toBe('gsk_full_key_12345678')
  })

  it('still updates an API key when given a real new value', async () => {
    const { saveConfig, loadConfig } = await import('../../server/utils/config')

    saveConfig({ api_keys: { groq: 'gsk_old_key_12345678' } })
    saveConfig({ api_keys: { groq: 'gsk_new_key_87654321' } })

    expect(loadConfig().api_keys?.groq).toBe('gsk_new_key_87654321')
  })

  it('does not overwrite a stored Home Assistant token with a masked placeholder', async () => {
    const { saveConfig, loadConfig, maskApiKey } = await import('../../server/utils/config')

    saveConfig({ home_assistant: { base_url: 'http://ha.local:8123', token: 'llat_secret_token_value' } })
    saveConfig({ home_assistant: { base_url: 'http://ha.local:8123', token: maskApiKey('llat_secret_token_value') } })

    expect(loadConfig().home_assistant?.token).toBe('llat_secret_token_value')
  })

  it('loadConfig returns saved values after saveConfig', async () => {
    const { saveConfig, loadConfig } = await import('../../server/utils/config')

    saveConfig({
      llm: { provider: 'openai', model: 'gpt-4o' },
      asr: { provider: 'openai' },
      tts: { provider: 'openai' },
      plugins: { dir: './custom-plugins' },
    })

    const config = loadConfig()
    expect(config.llm.provider).toBe('openai')
    expect(config.asr.provider).toBe('openai')
    expect(config.tts.provider).toBe('openai')
    expect(config.plugins.dir).toBe('./custom-plugins')
  })

  it('saves multiline personality.system_prompt', async () => {
    const { saveConfig, loadConfig } = await import('../../server/utils/config')

    const prompt = 'You are a helpful assistant.\nYou speak English.\nBe concise.'
    saveConfig({ personality: { system_prompt: prompt } })

    const config = loadConfig()
    expect(config.personality?.system_prompt).toBe(prompt)
  })
})

describe('maskApiKey', () => {
  it('masks keys longer than 8 chars', async () => {
    const { maskApiKey } = await import('../../server/utils/config')

    const masked = maskApiKey('gsk_1234567890abcdef')
    expect(masked).toBe('gsk_***...def')
  })

  it('returns *** for short keys', async () => {
    const { maskApiKey } = await import('../../server/utils/config')

    const masked = maskApiKey('short')
    expect(masked).toBe('***')
  })

  it('returns *** for empty string', async () => {
    const { maskApiKey } = await import('../../server/utils/config')

    const masked = maskApiKey('')
    expect(masked).toBe('***')
  })
})

describe('loadConfigMasked', () => {
  let tmpDir: string
  let configPath: string
  let originalConfigPath: string | undefined

  beforeEach(() => {
    tmpDir = join(tmpdir(), `espie-masked-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tmpDir, { recursive: true })
    configPath = join(tmpDir, '.config.yaml')
    originalConfigPath = process.env.CONFIG_PATH
    process.env.CONFIG_PATH = configPath
  })

  afterEach(async () => {
    if (originalConfigPath !== undefined) {
      process.env.CONFIG_PATH = originalConfigPath
    } else {
      delete process.env.CONFIG_PATH
    }
    try { rmSync(tmpDir, { recursive: true, force: true }) } catch {}
    const { vi } = await import('vitest')
    vi.resetModules()
  })

  it('returns config with masked API keys', async () => {
    const { saveConfig, loadConfigMasked } = await import('../../server/utils/config')

    saveConfig({
      api_keys: { groq: 'gsk_1234567890abcdef' },
      llm: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
    })

    const config = loadConfigMasked()
    expect(config.api_keys?.groq).toBe('gsk_***...def')
    expect(config.llm.provider).toBe('anthropic')
  })
})
