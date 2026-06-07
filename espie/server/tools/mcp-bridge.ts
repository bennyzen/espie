/**
 * MCP-to-AgentTool bridge.
 * Connects to any MCP server (e.g. ha-mcp for Home Assistant) via stdio transport,
 * lists available tools, and converts them to pi-agent-core AgentTool[] format.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { Type } from '@sinclair/typebox'
import type { AgentTool } from '@earendil-works/pi-agent-core'

/**
 * Convert an MCP tool name to a human-readable label.
 * Replaces underscores with spaces and title-cases each word.
 */
function toLabel(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export interface MCPBridgeResult {
  tools: AgentTool<any>[]
  cleanup: () => Promise<void>
}

/**
 * Connect to an MCP server, list its tools, and return them as AgentTool[].
 *
 * @param command - The command to run (e.g. 'uvx')
 * @param args - Command arguments (e.g. ['ha-mcp', '--ha-url', '...'])
 * @returns AgentTool array and a cleanup function to close the connection
 */
export async function createMCPBridge(
  command: string,
  args: string[],
): Promise<MCPBridgeResult> {
  const client = new Client({ name: 'espie', version: '1.0.0' })
  const transport = new StdioClientTransport({ command, args })

  try {
    await client.connect(transport)
  } catch (err) {
    throw new Error(
      `Failed to connect to MCP server: ${command} ${args.join(' ')} - ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  const { tools: mcpTools } = await client.listTools()

  const tools: AgentTool<any>[] = mcpTools.map((mcpTool) => ({
    name: mcpTool.name,
    label: toLabel(mcpTool.name),
    description: mcpTool.description || '',
    parameters: Type.Unsafe(mcpTool.inputSchema as any),
    execute: async (_toolCallId: string, params: any) => {
      const result = await client.callTool({
        name: mcpTool.name,
        arguments: params,
      })

      // Extract text content from result, joining multiple blocks with newline
      const contentArray = (result.content as any[]) || []
      const textParts = contentArray
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
      const text = textParts.join('\n')

      return {
        content: [{ type: 'text' as const, text }],
        details: result,
      }
    },
  }))

  return {
    tools,
    cleanup: async () => {
      await client.close()
    },
  }
}
