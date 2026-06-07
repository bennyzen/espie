// Plugin type definition — matches pi-agent-core AgentTool shape.
// Drop-in .ts plugin files and npm plugin packages export this interface.

import type { TSchema, Static } from '@sinclair/typebox'
import type { AgentToolResult, AgentToolUpdateCallback } from '@earendil-works/pi-agent-core'

/**
 * EspiePlugin interface — the contract for all voice assistant plugins.
 * Structurally compatible with pi-agent-core's AgentTool so plugins
 * can be passed directly to the agent without adapters.
 */
export interface EspiePlugin<TParameters extends TSchema = TSchema, TDetails = any> {
  name: string
  description: string
  parameters: TParameters
  label?: string
  execute: (
    toolCallId: string,
    params: Static<TParameters>,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<TDetails>
  ) => Promise<AgentToolResult<TDetails>>
}
