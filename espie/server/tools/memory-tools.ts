/**
 * Memory tools — save_memory and recall_memory AgentTool definitions.
 * The agent decides when to create, update, or replace memories.
 * Memory context with IDs is injected before each prompt, so the agent
 * can see existing memories and use replace_id to update contradicting ones.
 */
import { Type } from '@sinclair/typebox'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { MemoryService } from '../utils/memory'

export function createSaveMemoryTool(memoryService: MemoryService): AgentTool<any> {
  return {
    name: 'save_memory',
    label: 'save_memory',
    description:
      'Save or update a fact about the user. ' +
      'If an existing memory is outdated or contradicted by new information, ' +
      'set replace_id to that memory\'s ID to replace it.',
    parameters: Type.Object({
      fact: Type.String({
        description: 'The fact to remember, written as a clear declarative statement',
      }),
      replace_id: Type.Optional(Type.String({
        description: 'ID of an existing memory to replace with this new fact',
      })),
    }),
    execute: async (
      _toolCallId: string,
      params: { fact: string; replace_id?: string },
      _signal?: AbortSignal,
    ) => {
      if (params.replace_id) {
        try {
          memoryService.deleteFact(params.replace_id)
          console.log(`[memory] Replaced fact ${params.replace_id}`)
        } catch {
          // Already deleted — continue
        }
      }

      const result = await memoryService.save(params.fact)
      return {
        content: [
          {
            type: 'text' as const,
            text: `Memory ${params.replace_id ? 'replaced' : 'created'}: "${params.fact}"`,
          },
        ],
        details: result,
      }
    },
  }
}

export function createRecallMemoryTool(memoryService: MemoryService): AgentTool<any> {
  return {
    name: 'recall_memory',
    label: 'recall_memory',
    description:
      'Search your memory for previously saved facts about the user. ' +
      'Returns facts with IDs that can be used with save_memory replace_id.',
    parameters: Type.Object({
      query: Type.String({
        description: 'What to search for in memory',
      }),
    }),
    execute: async (
      _toolCallId: string,
      params: { query: string },
      _signal?: AbortSignal,
    ) => {
      const results = await memoryService.retrieve(params.query)

      if (results.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No relevant memories found.' }],
          details: { results: [] },
        }
      }

      const formatted = results.map((r) => `- [${r.id}] ${r.content}`).join('\n')
      return {
        content: [{ type: 'text' as const, text: `Relevant memories:\n${formatted}` }],
        details: { results },
      }
    },
  }
}
