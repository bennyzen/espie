/**
 * Transport-agnostic agent session wrapping pi-agent-core's Agent class.
 * Manages the LLM conversation loop, tool calling, and event streaming.
 * No knowledge of voice, network, or device transport -- consumers map
 * AgentEvents to their own transport-specific actions.
 */
import { Agent } from '@earendil-works/pi-agent-core'
import { streamSimple } from '@earendil-works/pi-ai'
import type { AgentEvent, AgentEventHandler, AgentSessionOptions } from './types'

export class AgentSession {
  private agent: Agent | null
  private handlers: Set<AgentEventHandler>
  private fullResponseText: string
  private isProcessing: boolean
  private toolStartTimes: Map<string, number> = new Map()
  private label: string

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
    this.fullResponseText = ''

    try {
      await this.agent!.prompt(text)
      return this.fullResponseText
    } catch (error) {
      this.emit({
        type: 'error',
        error: error instanceof Error ? error : new Error(String(error)),
      })
      throw error
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
        this.toolStartTimes.set(toolName, Date.now())

        // Log tool call with full input params
        const inputStr = toolInput ? JSON.stringify(toolInput) : '{}'
        const truncated = inputStr.length > 500 ? inputStr.slice(0, 500) + '...' : inputStr
        console.log(`[${this.label}] ⚙ ${toolName}(${truncated})`)

        this.emit({ type: 'tool_start', toolName, toolInput })
        break
      }

      case 'tool_execution_end': {
        const toolName = event.toolName || 'unknown'
        const toolOutput = event.result
        const startTime = this.toolStartTimes.get(toolName)
        const duration = startTime ? Date.now() - startTime : 0
        this.toolStartTimes.delete(toolName)

        // Log tool result with duration
        const outputText = toolOutput?.content?.[0]?.text || ''
        const outputTruncated = outputText.length > 300 ? outputText.slice(0, 300) + '...' : outputText
        console.log(`[${this.label}] ✓ ${toolName} → ${outputTruncated} (${duration}ms)`)

        this.emit({ type: 'tool_end', toolName, toolOutput })
        break
      }

      case 'agent_end':
        this.emit({ type: 'text_done', fullText: this.fullResponseText })
        this.emit({ type: 'turn_end' })
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
