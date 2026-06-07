/**
 * Built-in tool registration.
 * Loads Home Assistant tools (native REST API) based on config or environment variables.
 * Returns combined AgentTool[] from all built-in sources.
 */
import { createHomeAssistantTools } from './home-assistant'
import { loadConfig } from '../utils/config'
import type { AgentTool } from '@earendil-works/pi-agent-core'

export interface BuiltinToolsResult {
  tools: AgentTool<any>[]
  cleanup: () => Promise<void>
}

/**
 * Load all built-in tools.
 * Includes Home Assistant tools if credentials are configured (config or env vars).
 */
export async function loadBuiltinTools(): Promise<BuiltinToolsResult> {
  const allTools: AgentTool<any>[] = []

  // Home Assistant — config takes priority over env vars
  const config = loadConfig()
  const haBaseUrl = config.home_assistant?.base_url || process.env.HA_BASE_URL
  const haToken = config.home_assistant?.token || process.env.HA_TOKEN

  if (haToken && haBaseUrl) {
    try {
      const haTools = createHomeAssistantTools({ baseUrl: haBaseUrl, token: haToken })
      allTools.push(...haTools)
      console.log(`[builtin-tools] Loaded ${haTools.length} Home Assistant tools`)
    } catch (err) {
      console.warn(
        '[builtin-tools] Failed to create HA tools:',
        err instanceof Error ? err.message : String(err),
      )
    }
  } else {
    console.log('[builtin-tools] Home Assistant not configured, skipping HA tools')
  }

  return {
    tools: allTools,
    cleanup: async () => {},
  }
}
