// Provider Registry — factory functions for swappable LLM, ASR, and TTS providers.
// Each factory accepts an optional config object to select the provider and returns
// the appropriate provider instance. Defaults match the existing stack.

import { getModel, getModels, registerBuiltInApiProviders } from '@earendil-works/pi-ai'
import { createGroqASR, createOpenAIASR, type ASRProvider } from './asr'
import { createEdgeTTS, createOpenAITTS, type TTSProvider } from './tts'
import type { EmbeddingProvider } from './embeddings'

// Register all built-in pi-ai providers on module load
registerBuiltInApiProviders()

export type { ASRProvider } from './asr'
export type { TTSProvider } from './tts'
export type { EmbeddingProvider } from './embeddings'
export { createEmbeddings } from './embeddings'

export interface ProviderConfig {
  provider: string
  model?: string
  voice?: string
}

// Default models per provider (first model in the list if not specified)
const DEFAULT_MODELS: Record<string, string> = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
  google: 'gemini-2.5-flash',
  groq: 'llama-3.3-70b-versatile',
  mistral: 'mistral-large-latest',
  xai: 'grok-3',
  openrouter: 'anthropic/claude-sonnet-4.5',
}

/**
 * Create an LLM model instance via pi-ai's unified provider interface.
 * Supports all pi-ai providers (anthropic, openai, google, groq, mistral, xai, etc.).
 * API key resolution is handled separately via Agent's getApiKey callback.
 */
export function createLLM(config?: ProviderConfig) {
  const provider = config?.provider || 'anthropic'
  const model = config?.model || DEFAULT_MODELS[provider]

  if (!model) {
    // If no default, pick the first model from the provider
    const models = getModels(provider)
    if (models.length === 0) {
      throw new Error(`No models available for provider: ${provider}`)
    }
    return models[0]
  }

  return getModel(provider, model)
}

/**
 * Create an ASR (speech-to-text) provider instance.
 * Defaults to Groq Whisper.
 * Supports: 'groq' (default), 'openai'.
 */
export function createASR(config?: ProviderConfig): ASRProvider {
  const provider = config?.provider || 'groq'

  switch (provider) {
    case 'groq':
      return createGroqASR(config?.model)

    case 'openai':
      return createOpenAIASR()

    default:
      throw new Error(`Unknown ASR provider: ${provider}`)
  }
}

/**
 * Create a TTS (text-to-speech) provider instance.
 * Defaults to Edge TTS.
 * Supports: 'edge' (default), 'openai'.
 */
export function createTTS(config?: ProviderConfig): TTSProvider {
  const provider = config?.provider || 'edge'

  switch (provider) {
    case 'edge':
      return createEdgeTTS(config?.voice)

    case 'openai':
      return createOpenAITTS(config?.voice)

    default:
      throw new Error(`Unknown TTS provider: ${provider}`)
  }
}
