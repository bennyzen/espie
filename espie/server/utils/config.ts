// Config loader — reads provider configuration from YAML file and environment variables.
// Returns sensible defaults when no config file exists.
// Also provides saveConfig() for writing, maskApiKey() for display, and loadConfigMasked().

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'

export interface OAuthCredentials {
  refresh: string
  access: string
  expires: number
  [key: string]: unknown
}

export interface EspieConfig {
  llm: { provider: string; model: string }
  asr: { provider: string; model?: string }
  tts: { provider: string; voice?: string }
  plugins: { dir: string }
  api_keys?: Record<string, string>
  oauth_credentials?: Record<string, OAuthCredentials>
  personality?: { system_prompt?: string }
  timezone?: string
  location?: string
  home_assistant?: { base_url?: string; token?: string }
  wifi?: { ssid?: string; password?: string }
}

const DEFAULTS: EspieConfig = {
  llm: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
  asr: { provider: 'groq' },
  tts: { provider: 'edge' },
  plugins: { dir: './plugins' },
}

/**
 * Parse a simple YAML config file with nested key-value pairs.
 * Supports one level of nesting (section + key: value).
 * Handles multiline strings using YAML literal block scalar (|).
 * No external YAML library needed for this flat structure.
 */
function parseSimpleYaml(content: string): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {}
  let currentSection = ''
  let multilineKey = ''
  let multilineValue = ''
  let inMultiline = false

  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    // Inside multiline block scalar
    if (inMultiline) {
      // Multiline block continues while indented (4+ spaces) or empty lines
      if (line.startsWith('    ') || trimmed === '') {
        multilineValue += (multilineValue ? '\n' : '') + (trimmed === '' ? '' : line.slice(4))
        continue
      } else {
        // End of multiline block — trim trailing empty lines
        result[currentSection][multilineKey] = multilineValue.replace(/\n+$/, '')
        inMultiline = false
        multilineKey = ''
        multilineValue = ''
        // Fall through to process current line
      }
    }

    if (!trimmed || trimmed.startsWith('#')) continue

    // Section header (no leading spaces, ends with colon, no value after colon)
    if (!line.startsWith(' ') && !line.startsWith('\t') && trimmed.endsWith(':')) {
      currentSection = trimmed.slice(0, -1)
      result[currentSection] = result[currentSection] || {}
      continue
    }

    // Key-value pair under a section (indented)
    if (currentSection && trimmed.includes(':')) {
      const colonIdx = trimmed.indexOf(':')
      const key = trimmed.slice(0, colonIdx).trim()
      const value = trimmed.slice(colonIdx + 1).trim()

      // Check for YAML literal block scalar indicator
      if (value === '|') {
        inMultiline = true
        multilineKey = key
        multilineValue = ''
        continue
      }

      result[currentSection][key] = value
    }
  }

  // Handle multiline at end of file — trim trailing empty lines
  if (inMultiline && currentSection && multilineKey) {
    result[currentSection][multilineKey] = multilineValue.replace(/\n+$/, '')
  }

  return result
}

/**
 * Generate a simple YAML string from a config object.
 * Supports one level of nesting and multiline strings via literal block scalar (|).
 */
function toSimpleYaml(config: Record<string, Record<string, string>>): string {
  const lines: string[] = []

  for (const [section, values] of Object.entries(config)) {
    lines.push(`${section}:`)
    for (const [key, value] of Object.entries(values)) {
      if (value.includes('\n')) {
        // Use YAML literal block scalar for multiline
        lines.push(`  ${key}: |`)
        for (const valueLine of value.split('\n')) {
          lines.push(`    ${valueLine}`)
        }
      } else {
        lines.push(`  ${key}: ${value}`)
      }
    }
  }

  return lines.join('\n') + '\n'
}

/**
 * Load configuration from file and environment variables.
 * Config file path: CONFIG_PATH env var or './data/.config.yaml'.
 * Returns defaults for any missing values.
 */
export function loadConfig(): EspieConfig {
  const configPath = process.env.CONFIG_PATH || './data/.config.yaml'

  if (!existsSync(configPath)) {
    return { ...DEFAULTS }
  }

  const content = readFileSync(configPath, 'utf-8')
  const parsed = parseSimpleYaml(content)

  const config: EspieConfig = {
    llm: {
      provider: parsed.llm?.provider || DEFAULTS.llm.provider,
      model: parsed.llm?.model || DEFAULTS.llm.model,
    },
    asr: {
      provider: parsed.asr?.provider || DEFAULTS.asr.provider,
      model: parsed.asr?.model || undefined,
    },
    tts: {
      provider: parsed.tts?.provider || DEFAULTS.tts.provider,
      voice: parsed.tts?.voice || undefined,
    },
    plugins: {
      dir: parsed.plugins?.dir || DEFAULTS.plugins.dir,
    },
    timezone: parsed.general?.timezone || undefined,
    location: parsed.general?.location || undefined,
  }

  // Load optional sections — api_keys supports arbitrary provider names
  if (parsed.api_keys) {
    config.api_keys = {}
    for (const [key, value] of Object.entries(parsed.api_keys)) {
      if (value) config.api_keys[key] = value
    }
  }

  // Load OAuth credentials (stored as oauth_PROVIDER_field)
  if (parsed.oauth_credentials) {
    config.oauth_credentials = {}
    const credMap = new Map<string, Partial<OAuthCredentials>>()
    for (const [key, value] of Object.entries(parsed.oauth_credentials)) {
      const match = key.match(/^(.+?)_(refresh|access|expires)$/)
      if (match) {
        const provider = match[1]
        const field = match[2]
        if (!credMap.has(provider)) credMap.set(provider, {})
        const cred = credMap.get(provider)!
        if (field === 'expires') cred.expires = parseInt(value)
        else (cred as any)[field] = value
      }
    }
    for (const [provider, cred] of credMap) {
      if (cred.refresh && cred.access && cred.expires) {
        config.oauth_credentials[provider] = cred as OAuthCredentials
      }
    }
  }

  if (parsed.personality) {
    config.personality = {}
    if (parsed.personality.system_prompt) {
      config.personality.system_prompt = parsed.personality.system_prompt
    }
  }

  if (parsed.home_assistant) {
    config.home_assistant = {
      base_url: parsed.home_assistant.base_url || undefined,
      token: parsed.home_assistant.token || undefined,
    }
  }

  if (parsed.wifi) {
    config.wifi = {
      ssid: parsed.wifi.ssid || undefined,
      password: parsed.wifi.password || undefined,
    }
  }

  return config
}

/**
 * A value is a masked placeholder if it contains the '***' marker produced by
 * maskApiKey()/loadConfigMasked(). The /config UI is served masked secrets, so
 * an unchanged field round-trips a placeholder back on save — never persist it
 * over the real stored secret.
 */
function isMaskedValue(value: unknown): boolean {
  return typeof value === 'string' && value.includes('***')
}

/**
 * Merge an updates record into a base record, dropping any incoming masked
 * placeholder values so they don't clobber the real stored secrets.
 */
function mergeUnmasked(
  base: Record<string, string> | undefined,
  updates: Record<string, string>,
): Record<string, string> {
  const merged = { ...(base || {}) }
  for (const [key, value] of Object.entries(updates)) {
    if (isMaskedValue(value)) continue
    merged[key] = value
  }
  return merged
}

/**
 * Save configuration updates, merging with existing config.
 * Writes to CONFIG_PATH env var or './data/.config.yaml'.
 */
export function saveConfig(updates: Partial<EspieConfig>): void {
  const configPath = process.env.CONFIG_PATH || './data/.config.yaml'
  const dir = dirname(configPath)
  mkdirSync(dir, { recursive: true })

  // Load current config (or defaults)
  const current = loadConfig()

  // Deep merge each section
  if (updates.llm) {
    current.llm = { ...current.llm, ...updates.llm }
  }
  if (updates.asr) {
    current.asr = { ...current.asr, ...updates.asr }
  }
  if (updates.tts) {
    current.tts = { ...current.tts, ...updates.tts }
  }
  if (updates.plugins) {
    current.plugins = { ...current.plugins, ...updates.plugins }
  }
  if (updates.api_keys) {
    current.api_keys = mergeUnmasked(current.api_keys, updates.api_keys)
  }
  if (updates.oauth_credentials) {
    // Drop masked creds (loadConfigMasked() sets refresh/access to '***') so a
    // round-tripped masked credential can't overwrite the real tokens.
    const merged = { ...(current.oauth_credentials || {}) }
    for (const [provider, cred] of Object.entries(updates.oauth_credentials)) {
      if (isMaskedValue(cred?.refresh) || isMaskedValue(cred?.access)) continue
      merged[provider] = cred
    }
    current.oauth_credentials = merged
  }
  if (updates.personality) {
    current.personality = { ...(current.personality || {}), ...updates.personality }
  }
  if (updates.timezone !== undefined) {
    current.timezone = updates.timezone || undefined
  }
  if (updates.location !== undefined) {
    current.location = updates.location || undefined
  }
  if (updates.home_assistant) {
    const ha = { ...(current.home_assistant || {}) }
    if (updates.home_assistant.base_url !== undefined) ha.base_url = updates.home_assistant.base_url
    // Keep the stored token if the incoming one is a masked placeholder.
    if (updates.home_assistant.token !== undefined && !isMaskedValue(updates.home_assistant.token)) {
      ha.token = updates.home_assistant.token
    }
    current.home_assistant = ha
  }
  if (updates.wifi) {
    current.wifi = { ...(current.wifi || {}), ...updates.wifi }
  }
  // Convert to flat record format for YAML serialization
  const flat: Record<string, any> = {
    llm: { provider: current.llm.provider, model: current.llm.model },
    asr: { provider: current.asr.provider, ...(current.asr.model && { model: current.asr.model }) },
    tts: { provider: current.tts.provider, ...(current.tts.voice && { voice: current.tts.voice }) },
    plugins: { dir: current.plugins.dir },
  }

  if (current.timezone || current.location) {
    flat.general = {} as Record<string, string>
    if (current.timezone) flat.general.timezone = current.timezone
    if (current.location) flat.general.location = current.location
  }

  if (current.api_keys) {
    flat.api_keys = {}
    for (const [key, value] of Object.entries(current.api_keys)) {
      if (value) flat.api_keys[key] = value
    }
  }

  if (current.oauth_credentials) {
    flat.oauth_credentials = {}
    for (const [provider, cred] of Object.entries(current.oauth_credentials)) {
      flat.oauth_credentials[`${provider}_refresh`] = cred.refresh
      flat.oauth_credentials[`${provider}_access`] = cred.access
      flat.oauth_credentials[`${provider}_expires`] = String(cred.expires)
    }
  }

  if (current.personality) {
    flat.personality = {}
    if (current.personality.system_prompt) {
      flat.personality.system_prompt = current.personality.system_prompt
    }
  }

  if (current.home_assistant?.base_url || current.home_assistant?.token) {
    flat.home_assistant = {} as Record<string, string>
    if (current.home_assistant.base_url) flat.home_assistant.base_url = current.home_assistant.base_url
    if (current.home_assistant.token) flat.home_assistant.token = current.home_assistant.token
  }

  if (current.wifi?.ssid) {
    flat.wifi = {} as Record<string, string>
    flat.wifi.ssid = current.wifi.ssid
    if (current.wifi.password) flat.wifi.password = current.wifi.password
  }

  writeFileSync(configPath, toSimpleYaml(flat), 'utf-8')
}

/**
 * Mask an API key for display: show first 4 chars and last 3 chars.
 * Returns '***' for keys shorter than 9 chars or empty strings.
 */
export function maskApiKey(key: string): string {
  if (key.length <= 8) return '***'
  return `${key.slice(0, 4)}***...${key.slice(-3)}`
}

/**
 * Load configuration with API keys masked for safe display.
 */
export function loadConfigMasked(): EspieConfig {
  const config = loadConfig()

  if (config.api_keys) {
    const masked: Record<string, string> = {}
    for (const [key, value] of Object.entries(config.api_keys)) {
      masked[key] = maskApiKey(value)
    }
    config.api_keys = masked
  }

  // Mask OAuth credentials — only expose provider names and expiry
  if (config.oauth_credentials) {
    const masked: Record<string, OAuthCredentials> = {}
    for (const [provider, cred] of Object.entries(config.oauth_credentials)) {
      masked[provider] = { refresh: '***', access: '***', expires: cred.expires }
    }
    config.oauth_credentials = masked
  }

  if (config.home_assistant?.token) {
    config.home_assistant = { ...config.home_assistant, token: maskApiKey(config.home_assistant.token) }
  }

  return config
}

/**
 * Create a getApiKey callback for pi-agent-core's Agent.
 * Resolves API keys from: config api_keys → OAuth credentials → env vars.
 * For OAuth providers, auto-refreshes expired tokens and persists updated credentials.
 */
export function createApiKeyResolver(): (provider: string) => Promise<string | undefined> {
  // Map from provider ID to the env var pi-ai checks
  const envVarMap: Record<string, string> = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    google: 'GEMINI_API_KEY',
    groq: 'GROQ_API_KEY',
    cerebras: 'CEREBRAS_API_KEY',
    xai: 'XAI_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
    'vercel-ai-gateway': 'AI_GATEWAY_API_KEY',
    zai: 'ZAI_API_KEY',
    mistral: 'MISTRAL_API_KEY',
    minimax: 'MINIMAX_API_KEY',
    'minimax-cn': 'MINIMAX_CN_API_KEY',
    huggingface: 'HF_TOKEN',
    opencode: 'OPENCODE_API_KEY',
    'opencode-go': 'OPENCODE_API_KEY',
    'kimi-coding': 'KIMI_API_KEY',
  }

  return async (provider: string): Promise<string | undefined> => {
    const config = loadConfig()

    // 1. Check config api_keys first
    const configKey = config.api_keys?.[provider]
    if (configKey) return configKey

    // 2. Check OAuth credentials
    const oauthCred = config.oauth_credentials?.[provider]
    if (oauthCred) {
      // If token is still valid (with 60s buffer), use it directly
      if (oauthCred.expires > Date.now() + 60_000) {
        return oauthCred.access
      }
      // Token expired — try to refresh
      try {
        const { getOAuthProvider } = await import('@earendil-works/pi-ai/oauth')
        const oauthProvider = getOAuthProvider(provider)
        if (oauthProvider) {
          const refreshed = await oauthProvider.refreshToken(oauthCred)
          // Persist refreshed credentials
          saveConfig({ oauth_credentials: { [provider]: refreshed as OAuthCredentials } })
          return oauthProvider.getApiKey(refreshed)
        }
      } catch (err) {
        console.error(`[config] Failed to refresh OAuth token for ${provider}:`, err)
      }
    }

    // 3. Fall back to environment variable
    if (provider === 'anthropic') {
      return process.env.ANTHROPIC_OAUTH_TOKEN || process.env.ANTHROPIC_API_KEY
    }
    const envVar = envVarMap[provider]
    return envVar ? process.env[envVar] : undefined
  }
}
