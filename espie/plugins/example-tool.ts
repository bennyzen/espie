/**
 * Example Espie plugin — roll_dice.
 * Drop .ts files in this directory to register custom tools with the agent.
 * Each file must export a default object matching the EspiePlugin interface:
 *   - name: string (tool name, used in function calls)
 *   - description: string (shown to the LLM)
 *   - parameters: TypeBox schema (defines the tool's input)
 *   - execute: async function that returns { content, details }
 */
import { Type } from '@sinclair/typebox'
import type { EspiePlugin } from '../server/utils/plugin-types'

export default {
  name: 'roll_dice',
  description: 'Roll a die with the specified number of sides',
  parameters: Type.Object({
    sides: Type.Number({ description: 'Number of sides', default: 6 }),
  }),
  execute: async (_toolCallId, params) => {
    const sides = params.sides || 6
    const result = Math.floor(Math.random() * sides) + 1
    return {
      content: [{ type: 'text' as const, text: `Rolled a ${result} on a d${sides}` }],
      details: { result, sides },
    }
  },
} satisfies EspiePlugin
