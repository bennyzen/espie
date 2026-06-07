/**
 * Transport-agnostic agent session wrapping pi-agent-core's Agent class.
 * Manages the LLM conversation loop, tool calling, and event streaming.
 * No knowledge of voice, network, or device transport -- consumers map
 * AgentEvents to their own transport-specific actions.
 */
import { Agent } from '@earendil-works/pi-agent-core'
import { streamSimple } from '@earendil-works/pi-ai'
import type { AgentEvent, AgentEventHandler, AgentSessionOptions } from './types'

// Tool inputs and outputs can carry secrets/PII (memory contents, HA tokens,
// search queries, location). Off by default; opt in for debugging.
const LOG_TOOL_IO = process.env.ESPIE_LOG_TOOL_IO === '1' || process.env.ESPIE_LOG_TOOL_IO === 'true'

export class AgentSession {
  private agent: Agent | null
  private handlers: Set<AgentEventHandler>
  private fullResponseText: string
  private isProcessing: boolean
  private toolStartTimes: Map<string, number> = new Map()
  private label: string
  private sawToolCall = false

  constructor(options: AgentSessionOptions) {
    this.handlers = new Set()
    this.fullResponseText = ''
    this.isProcessing = false
    this.label = options.label || 'agent'

    this.agent = new Agent({
      initialState: {
        systemPrompt: options.systemPrompt,
        model: options.model as any,
        tools: (options.tools as any[]) || [],
        thinkingLevel: options.thinkingLevel || 'off',
      },
      streamFn: streamSimple,
      getApiKey: options.getApiKey,
    })

    this.agent.subscribe((event: any) => this.handleAgentEvent(event))
  }

  /**
   * Subscribe to agent events. Returns an unsubscribe function.
   */
  subscribe(handler: AgentEventHandler): () => void {
    this.handlers.add(handler)
    return () => {
      this.handlers.delete(handler)
    }
  }

  /**
   * Send a user message to the agent and get the full response text.
   * Streams text_delta events to subscribers as they arrive.
   */
  async prompt(text: string): Promise<string> {
    this.isProcessing = true
    // The configured LLM provider can return an empty assistant turn (no text, no
    // tool calls, ~400ms) on the first request after the HTTP connection has gone
    // idle — observed with zai/GLM. That makes the first message of a session, or
    // the first after a pause, get no answer. Retry on a genuinely empty turn; the
    // connection is warm by the next attempt. Gated on "no tool call" so tools are
    // never re-executed. text_done/turn_end are emitted here (once, after the final
    // attempt) so discarded empty attempts don't surface as blank assistant turns. (#30)
    const MAX_ATTEMPTS = 5
    try {
      let attempt = 0
      while (true) {
        attempt++
        this.fullResponseText = ''
        this.sawToolCall = false
        try {
          await this.agent!.prompt(text)
        } catch (error) {
          this.emit({
            type: 'error',
            error: error instanceof Error ? error : new Error(String(error)),
          })
          throw error
        }
        const empty = !this.fullResponseText.trim() && !this.sawToolCall
        if (!empty || attempt >= MAX_ATTEMPTS) break
        // Drop the empty assistant turn (and the user message that produced it) before
        // retrying: GLM keeps returning empty if re-asked on top of an empty turn, but
        // answers a clean request. The retry re-appends the same user message.
        const msgs = (this.agent as any).state?.messages
        if (Array.isArray(msgs) && msgs.length >= 2 &&
            msgs[msgs.length - 1]?.role === 'assistant' && msgs[msgs.length - 2]?.role === 'user') {
          msgs.splice(-2, 2)
        }
        console.warn(`[${this.label}] empty response (attempt ${attempt}/${MAX_ATTEMPTS}) — likely a cold provider connection; retrying clean`)
        // Brief backoff: a fully cold connection needs a moment to establish; hammering
        // it back-to-back keeps returning empty.
        await new Promise((r) => setTimeout(r, 300 * attempt))
      }
      this.emit({ type: 'text_done', fullText: this.fullResponseText })
      this.emit({ type: 'turn_end' })
      return this.fullResponseText
    } finally {
      this.isProcessing = false
    }
  }

  /**
   * Interrupt the current response. Sends a steering message to the agent
   * so it knows its last response was cut short.
   */
  interrupt(partialText?: string): void {
    if (!this.isProcessing || !this.agent) return

    const content = partialText
      ? `[Previous response was interrupted after: "${partialText}"]`
      : '[Previous response was interrupted]'

    this.agent.steer({
      role: 'user',
      content,
      timestamp: Date.now(),
    } as any)
  }

  /**
   * Update the agent's tool definitions.
   */
  setTools(tools: unknown[]): void {
    if (this.agent) {
      // pi-agent-core 0.78 removed Agent.setTools(); tools are now updated
      // via the settable state accessor (assigning copies the top-level array).
      this.agent.state.tools = tools as any[]
    }
  }

  /**
   * Whether the agent is currently processing a prompt.
   */
  get processing(): boolean {
    return this.isProcessing
  }

  /**
   * Clean up the session, removing all event handlers.
   */
  destroy(): void {
    this.handlers.clear()
    this.agent = null
  }

  /**
   * Handle raw events from pi-agent-core and translate them
   * to our transport-agnostic AgentEvent types.
   * All tool call logging happens here — consumers don't need to log separately.
   */
  private handleAgentEvent(event: any): void {
    switch (event.type) {
      case 'message_update':
        if (event.assistantMessageEvent?.type === 'text_delta') {
          const delta = event.assistantMessageEvent.delta as string
          this.fullResponseText += delta
          this.emit({ type: 'text_delta', delta })
        }
        break

      case 'tool_execution_start': {
        const toolName = event.toolName || 'unknown'
        const toolInput = event.args
        this.sawToolCall = true
        this.toolStartTimes.set(toolName, Date.now())

        // Tool inputs can contain secrets/PII (memory contents, HA tokens, search
        // queries), so log the params verbatim only when ESPIE_LOG_TOOL_IO is set.
        if (LOG_TOOL_IO) {
          const inputStr = toolInput ? JSON.stringify(toolInput) : '{}'
          const truncated = inputStr.length > 500 ? inputStr.slice(0, 500) + '...' : inputStr
          console.log(`[${this.label}] ⚙ ${toolName}(${truncated})`)
        } else {
          console.log(`[${this.label}] ⚙ ${toolName}`)
        }

        this.emit({ type: 'tool_start', toolName, toolInput })
        break
      }

      case 'tool_execution_end': {
        const toolName = event.toolName || 'unknown'
        const toolOutput = event.result
        const startTime = this.toolStartTimes.get(toolName)
        const duration = startTime ? Date.now() - startTime : 0
        this.toolStartTimes.delete(toolName)

        // Tool results can contain secrets/PII, so log the content verbatim only
        // when ESPIE_LOG_TOOL_IO is set; otherwise just the name and duration.
        if (LOG_TOOL_IO) {
          const outputText = toolOutput?.content?.[0]?.text || ''
          const outputTruncated = outputText.length > 300 ? outputText.slice(0, 300) + '...' : outputText
          console.log(`[${this.label}] ✓ ${toolName} → ${outputTruncated} (${duration}ms)`)
        } else {
          console.log(`[${this.label}] ✓ ${toolName} (${duration}ms)`)
        }

        this.emit({ type: 'tool_end', toolName, toolOutput })
        break
      }

      case 'agent_end':
        // text_done / turn_end are emitted from prompt() after the empty-response
        // retry loop, so discarded empty attempts don't surface as blank turns. (#30)
        break
    }
  }

  /**
   * Emit an event to all subscribed handlers.
   * Wraps each handler call in try/catch to prevent one bad handler
   * from breaking others.
   */
  private emit(event: AgentEvent): void {
    for (const handler of this.handlers) {
      try {
        handler(event)
      } catch {
        // Prevent one handler from breaking others
      }
    }
  }
}
