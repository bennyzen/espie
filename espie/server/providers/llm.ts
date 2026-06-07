// LLM Provider — pi-ai model configuration.
// Configures LLM models via pi-ai's unified provider interface.

import { registerBuiltInApiProviders, getModel } from '@earendil-works/pi-ai'

// Register built-in providers on module load so models are available
registerBuiltInApiProviders()

/**
 * Create and return a configured Anthropic LLM model instance via pi-ai.
 * Uses LLM_MODEL env var, defaulting to claude-sonnet-4-20250514.
 */
export function createAnthropicLLM() {
  const modelName = process.env.LLM_MODEL || 'claude-sonnet-4-20250514'
  return getModel('anthropic', modelName)
}

/**
 * Backward-compatible alias — existing code importing createLLMModel continues to work.
 * Delegates to createAnthropicLLM (the default LLM provider).
 */
export function createLLMModel() {
  return createAnthropicLLM()
}
