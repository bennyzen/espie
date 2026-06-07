// GET /api/providers — returns all pi-ai LLM providers, their models, and auth metadata.
// Used by the config UI to populate dynamic provider/model dropdowns.

import { getProviders, getModels, registerBuiltInApiProviders } from '@earendil-works/pi-ai'

// Ensure all 31 providers are registered — can't rely on import side effects from other modules
registerBuiltInApiProviders()
import { getOAuthProviders } from '@earendil-works/pi-ai/oauth'

// Map provider IDs to their expected env var names (mirrors pi-ai's env-api-keys.ts)
const envVarMap: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  'azure-openai-responses': 'AZURE_OPENAI_API_KEY',
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

export default defineEventHandler(() => {
  const oauthProviderIds = new Set(getOAuthProviders().map((p) => p.id))

  const providers = getProviders().map((id) => {
    const models = getModels(id).map((m) => ({
      id: m.id,
      name: m.name,
      contextWindow: m.contextWindow,
      maxTokens: m.maxTokens,
      reasoning: m.reasoning,
    }))

    const authType = oauthProviderIds.has(id) ? 'oauth' : 'api_key'
    const envVar = envVarMap[id] || null

    return { id, authType, envVar, modelCount: models.length, models }
  })

  return { providers }
})
