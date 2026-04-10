/**
 * Tool registry — centralized tool assembly for all session types.
 * Creates the right tool set for voice, web chat, and scheduler sessions.
 * Single source of truth: add a new tool here, every session type gets it.
 */
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type Database from 'better-sqlite3'
import type { EmbeddingProvider } from '../providers/embeddings'
import type { DeviceTransport } from '../utils/device-registry'
import { createSaveMemoryTool, createRecallMemoryTool } from './memory-tools'
import { createYTMusicTool } from './ytmusic'
import { createSayTool } from './say'
import { createWeatherTool } from './weather'
import { createListSchedulesTool, createCreateScheduleTool, createUpdateScheduleTool, createDeleteScheduleTool } from './schedule-tools'
import { createMemoryService, type MemoryService } from '../utils/memory'

export interface ToolRegistryOptions {
  /** Database for memory service. Required for memory tools. */
  db: Database.Database
  /** Embedding provider for memory. Required for memory tools. */
  embeddings: EmbeddingProvider
  /** Device transport for say tool. Null/undefined if no device is connected. */
  transport?: DeviceTransport | null
  /** Pre-created memory service (reuse across tools). Created from db+embeddings if not provided. */
  memoryService?: MemoryService
  /** Source label for say tool (e.g. 'schedule'). */
  source?: string
}

export interface ToolRegistryResult {
  /** All tools ready to pass to AgentSession. */
  tools: AgentTool<any>[]
  /** Memory service instance (for external use, e.g. memory API). */
  memoryService: MemoryService
  /** Cleanup function — call on session close. */
  cleanup: () => Promise<void>
}

/**
 * Create the full tool set for a session.
 * Loads builtin tools (HA) async, creates memory tools, ytmusic, and optionally say.
 * Returns immediately with sync tools; call result.loaded to await async tools.
 */
export async function createSessionTools(options: ToolRegistryOptions): Promise<ToolRegistryResult> {
  const memoryService = options.memoryService || createMemoryService(options.db, options.embeddings)

  // Sync tools — always available
  const tools: AgentTool<any>[] = [
    createYTMusicTool(),
    createWeatherTool(),
    createSaveMemoryTool(memoryService),
    createRecallMemoryTool(memoryService),
    createListSchedulesTool(options.db),
    createCreateScheduleTool(options.db),
    createUpdateScheduleTool(options.db),
    createDeleteScheduleTool(options.db),
  ]

  // Say tool — always available (persists to DB; speaks only if device is idle)
  tools.push(createSayTool({ transport: options.transport, source: options.source }))

  // Async tools — Home Assistant via builtin loader
  let builtinCleanup: (() => Promise<void>) | undefined
  try {
    const { loadBuiltinTools } = await import('./builtin')
    const result = await loadBuiltinTools()
    tools.push(...result.tools)
    builtinCleanup = result.cleanup
  } catch (err) {
    console.warn('[tool-registry] Failed to load builtin tools:', err)
  }

  return {
    tools,
    memoryService,
    cleanup: async () => {
      await builtinCleanup?.()
    },
  }
}

/**
 * Create sync-only tools for immediate use while async tools load.
 * Used by voice pipeline to have tools ready before HA finishes loading.
 */
export function createSyncTools(options: ToolRegistryOptions): {
  tools: AgentTool<any>[]
  memoryService: MemoryService
} {
  const memoryService = options.memoryService || createMemoryService(options.db, options.embeddings)

  const tools: AgentTool<any>[] = [
    createYTMusicTool(),
    createWeatherTool(),
    createSaveMemoryTool(memoryService),
    createRecallMemoryTool(memoryService),
    createListSchedulesTool(options.db),
    createCreateScheduleTool(options.db),
    createUpdateScheduleTool(options.db),
    createDeleteScheduleTool(options.db),
  ]

  tools.push(createSayTool({ transport: options.transport, source: options.source }))

  return { tools, memoryService }
}
