import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock MCP SDK modules
const mockConnect = vi.fn()
const mockListTools = vi.fn()
const mockCallTool = vi.fn()
const mockClose = vi.fn()

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(function (this: any) {
    this.connect = mockConnect
    this.listTools = mockListTools
    this.callTool = mockCallTool
    this.close = mockClose
  }),
}))

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn().mockImplementation(function (this: any) {
    // Stdio transport mock - no methods needed
  }),
}))

import { createMCPBridge } from '../../server/tools/mcp-bridge'
import { loadBuiltinTools } from '../../server/tools/builtin'

describe('createMCPBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListTools.mockResolvedValue({
      tools: [
        {
          name: 'call_service',
          description: 'Call a Home Assistant service',
          inputSchema: {
            type: 'object',
            properties: {
              domain: { type: 'string' },
              service: { type: 'string' },
            },
          },
        },
        {
          name: 'get_state',
          description: 'Get entity state from Home Assistant',
          inputSchema: {
            type: 'object',
            properties: {
              entity_id: { type: 'string' },
            },
          },
        },
      ],
    })
    mockCallTool.mockResolvedValue({
      content: [{ type: 'text', text: 'Done' }],
    })
  })

  it('connects to MCP server and returns AgentTool array', async () => {
    const { tools, cleanup } = await createMCPBridge('uvx', ['ha-mcp'])

    expect(mockConnect).toHaveBeenCalledTimes(1)
    expect(mockListTools).toHaveBeenCalledTimes(1)
    expect(tools).toHaveLength(2)
    expect(typeof cleanup).toBe('function')
  })

  it('each MCP tool has name, description, label, parameters, execute', async () => {
    const { tools } = await createMCPBridge('uvx', ['ha-mcp'])

    for (const tool of tools) {
      expect(tool).toHaveProperty('name')
      expect(tool).toHaveProperty('description')
      expect(tool).toHaveProperty('label')
      expect(tool).toHaveProperty('parameters')
      expect(tool).toHaveProperty('execute')
      expect(typeof tool.name).toBe('string')
      expect(typeof tool.description).toBe('string')
      expect(typeof tool.label).toBe('string')
      expect(typeof tool.execute).toBe('function')
    }
  })

  it('MCP tool execute() calls client.callTool() and returns AgentToolResult', async () => {
    const { tools } = await createMCPBridge('uvx', ['ha-mcp'])
    const callServiceTool = tools.find((t) => t.name === 'call_service')!

    const result = await callServiceTool.execute('call-1', {
      domain: 'light',
      service: 'turn_on',
    })

    expect(mockCallTool).toHaveBeenCalledWith({
      name: 'call_service',
      arguments: { domain: 'light', service: 'turn_on' },
    })
    expect(result.content).toEqual([{ type: 'text', text: 'Done' }])
    expect(result.details).toBeDefined()
  })

  it('MCP tool handles array content (multiple text blocks joined)', async () => {
    mockCallTool.mockResolvedValue({
      content: [
        { type: 'text', text: 'Line 1' },
        { type: 'text', text: 'Line 2' },
      ],
    })

    const { tools } = await createMCPBridge('uvx', ['ha-mcp'])
    const tool = tools[0]

    const result = await tool.execute('call-1', {})

    expect(result.content).toEqual([{ type: 'text', text: 'Line 1\nLine 2' }])
  })

  it('cleanup() calls client.close()', async () => {
    const { cleanup } = await createMCPBridge('uvx', ['ha-mcp'])

    await cleanup()

    expect(mockClose).toHaveBeenCalledTimes(1)
  })

  it('throws meaningful error if MCP server fails to connect', async () => {
    mockConnect.mockRejectedValue(new Error('ENOENT'))

    await expect(createMCPBridge('bad-cmd', ['--arg'])).rejects.toThrow(
      /Failed to connect to MCP server: bad-cmd --arg/,
    )
  })
})

describe('loadBuiltinTools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConnect.mockResolvedValue(undefined)
    mockListTools.mockResolvedValue({
      tools: [
        {
          name: 'call_service',
          description: 'Call a Home Assistant service',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
    })
    mockCallTool.mockResolvedValue({
      content: [{ type: 'text', text: 'OK' }],
    })
  })

  it('returns combined MCP tools when env vars present', async () => {
    const originalToken = process.env.HA_TOKEN
    const originalUrl = process.env.HA_BASE_URL

    process.env.HA_TOKEN = 'test-token'
    process.env.HA_BASE_URL = 'http://localhost:8123'

    try {
      const { tools, cleanup } = await loadBuiltinTools()
      expect(tools.length).toBeGreaterThan(0)
      expect(typeof cleanup).toBe('function')
    } finally {
      if (originalToken !== undefined) process.env.HA_TOKEN = originalToken
      else delete process.env.HA_TOKEN
      if (originalUrl !== undefined) process.env.HA_BASE_URL = originalUrl
      else delete process.env.HA_BASE_URL
    }
  })

  it('returns empty tools when HA env vars missing', async () => {
    const originalToken = process.env.HA_TOKEN
    const originalUrl = process.env.HA_BASE_URL

    delete process.env.HA_TOKEN
    delete process.env.HA_BASE_URL

    try {
      const { tools, cleanup } = await loadBuiltinTools()
      expect(tools).toEqual([])
      expect(typeof cleanup).toBe('function')
    } finally {
      if (originalToken !== undefined) process.env.HA_TOKEN = originalToken
      if (originalUrl !== undefined) process.env.HA_BASE_URL = originalUrl
    }
  })
})
