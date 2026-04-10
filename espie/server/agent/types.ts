/**
 * Events emitted by AgentSession during streaming.
 * Transport-agnostic -- no audio/WebSocket/voice references.
 * Consumers (VoicePipeline, WebChatHandler) map these to transport-specific actions.
 */

export type AgentEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'text_done'; fullText: string }
  | { type: 'tool_start'; toolName: string; toolInput: unknown }
  | { type: 'tool_end'; toolName: string; toolOutput: unknown }
  | { type: 'turn_end' }
  | { type: 'error'; error: Error }

export type AgentEventHandler = (event: AgentEvent) => void

export interface AgentSessionOptions {
  /** System prompt for the agent. */
  systemPrompt: string
  /** pi-ai model instance (from getModel/createLLMModel). */
  model: unknown
  /** Optional tool definitions. Can be updated later via setTools(). */
  tools?: unknown[]
  /** Thinking level for the model. Default: 'off'. */
  thinkingLevel?: 'off' | 'low' | 'medium' | 'high'
  /** Previous conversation messages to restore on reconnect. */
  previousMessages?: Array<{ role: string; content: string }>
  /** Dynamic API key resolver — called per LLM request. Enables config-based keys + OAuth token refresh. */
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined
  /** Label for structured log lines (e.g. 'voice', 'web-chat', 'scheduler'). Default: 'agent'. */
  label?: string
}
