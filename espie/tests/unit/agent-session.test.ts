import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

// Mock pi-agent-core Agent class
const mockSubscribeCallback = { current: null as any }
const mockPrompt = vi.fn()
const mockSteer = vi.fn()
const mockSetTools = vi.fn()
const mockSubscribe = vi.fn((cb: any) => {
  mockSubscribeCallback.current = cb
  return () => {} // unsubscribe function
})

vi.mock('@earendil-works/pi-agent-core', () => ({
  Agent: vi.fn().mockImplementation(function (this: any) {
    this.prompt = mockPrompt
    this.steer = mockSteer
    this.setTools = mockSetTools
    this.subscribe = mockSubscribe
  }),
}))

vi.mock('@earendil-works/pi-ai', () => ({
  streamSimple: vi.fn(),
}))

import { AgentSession } from '../../server/agent/agent-session'
import type { AgentEvent } from '../../server/agent/types'

describe('AgentSession', () => {
  let session: AgentSession

  beforeEach(() => {
    vi.clearAllMocks()
    mockSubscribeCallback.current = null
    session = new AgentSession({
      systemPrompt: 'Test prompt',
      model: {},
    })
  })

  it('creates instance without throwing', () => {
    expect(session).toBeInstanceOf(AgentSession)
  })

  it('subscribe returns unsubscribe function that removes the handler', () => {
    const handler = vi.fn()
    const unsub = session.subscribe(handler)

    // Fire a text_delta event
    expect(mockSubscribeCallback.current).toBeTruthy()
    mockSubscribeCallback.current({
      type: 'message_update',
      message: {},
      assistantMessageEvent: { type: 'text_delta', delta: 'Hello' },
    })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith({ type: 'text_delta', delta: 'Hello' })

    // Unsubscribe and fire again
    unsub()
    handler.mockClear()
    mockSubscribeCallback.current({
      type: 'message_update',
      message: {},
      assistantMessageEvent: { type: 'text_delta', delta: 'World' },
    })
    expect(handler).not.toHaveBeenCalled()
  })

  it('prompt calls agent.prompt with the user text', async () => {
    mockPrompt.mockResolvedValue(undefined)
    await session.prompt('hello')
    expect(mockPrompt).toHaveBeenCalledWith('hello')
  })

  it('forwards text_delta events from agent to subscribers', () => {
    const handler = vi.fn()
    session.subscribe(handler)

    mockSubscribeCallback.current({
      type: 'message_update',
      message: {},
      assistantMessageEvent: { type: 'text_delta', delta: 'Hello' },
    })

    expect(handler).toHaveBeenCalledWith({ type: 'text_delta', delta: 'Hello' })
  })

  it('forwards agent_end as text_done + turn_end', async () => {
    const events: AgentEvent[] = []
    session.subscribe((e) => events.push(e))

    mockPrompt.mockImplementation(async () => {
      mockSubscribeCallback.current({
        type: 'message_update',
        message: {},
        assistantMessageEvent: { type: 'text_delta', delta: 'Hi there' },
      })
      mockSubscribeCallback.current({
        type: 'agent_end',
        messages: [],
      })
    })

    await session.prompt('test')

    const textDone = events.find((e) => e.type === 'text_done')
    const turnEnd = events.find((e) => e.type === 'turn_end')
    expect(textDone).toBeDefined()
    expect((textDone as any).fullText).toBe('Hi there')
    expect(turnEnd).toBeDefined()

    // Verify turn_end comes after text_done
    const textDoneIndex = events.findIndex((e) => e.type === 'text_done')
    const turnEndIndex = events.findIndex((e) => e.type === 'turn_end')
    expect(turnEndIndex).toBeGreaterThan(textDoneIndex)
  })

  it('forwards tool_execution_start/end as tool_start/tool_end', () => {
    const events: AgentEvent[] = []
    session.subscribe((e) => events.push(e))

    mockSubscribeCallback.current({
      type: 'tool_execution_start',
      toolCallId: 'call-1',
      toolName: 'get_weather',
      args: { city: 'Berlin' },
    })

    mockSubscribeCallback.current({
      type: 'tool_execution_end',
      toolCallId: 'call-1',
      toolName: 'get_weather',
      result: { temp: 22 },
      isError: false,
    })

    const toolStart = events.find((e) => e.type === 'tool_start')
    const toolEnd = events.find((e) => e.type === 'tool_end')

    expect(toolStart).toEqual({
      type: 'tool_start',
      toolName: 'get_weather',
      toolInput: { city: 'Berlin' },
    })
    expect(toolEnd).toEqual({
      type: 'tool_end',
      toolName: 'get_weather',
      toolOutput: { temp: 22 },
    })
  })

  it('prompt returns full accumulated response text', async () => {
    mockPrompt.mockImplementation(async () => {
      mockSubscribeCallback.current({
        type: 'message_update',
        message: {},
        assistantMessageEvent: { type: 'text_delta', delta: 'Hello ' },
      })
      mockSubscribeCallback.current({
        type: 'message_update',
        message: {},
        assistantMessageEvent: { type: 'text_delta', delta: 'world' },
      })
      mockSubscribeCallback.current({
        type: 'agent_end',
        messages: [],
      })
    })

    const result = await session.prompt('greet me')
    expect(result).toBe('Hello world')
  })

  it('interrupt calls agent.steer', () => {
    // Must be processing for interrupt to do anything
    // Simulate processing state by starting a prompt without awaiting
    mockPrompt.mockImplementation(
      () => new Promise(() => {}) // never resolves
    )
    session.prompt('test') // don't await

    session.interrupt('partial response')
    expect(mockSteer).toHaveBeenCalled()
  })

  it('processing is true during prompt, false after', async () => {
    let processingDuringPrompt = false

    mockPrompt.mockImplementation(async () => {
      processingDuringPrompt = session.processing
      mockSubscribeCallback.current({ type: 'agent_end', messages: [] })
    })

    expect(session.processing).toBe(false)
    await session.prompt('test')
    expect(processingDuringPrompt).toBe(true)
    expect(session.processing).toBe(false)
  })

  it('transport-agnostic: no audio/websocket imports in source', () => {
    const sourcePath = path.resolve(__dirname, '../../server/agent/agent-session.ts')
    const source = fs.readFileSync(sourcePath, 'utf-8')

    // Should NOT contain these transport-specific terms (case-sensitive)
    expect(source).not.toMatch(/WebSocket/)
    expect(source).not.toMatch(/opus/)
    expect(source).not.toMatch(/Buffer/)
    expect(source).not.toMatch(/audio/)
    expect(source).not.toMatch(/ws-handler/)
    expect(source).not.toMatch(/protocol\.ts/)
  })

  it('error in prompt emits error event and rejects', async () => {
    const events: AgentEvent[] = []
    session.subscribe((e) => events.push(e))

    const err = new Error('LLM failed')
    mockPrompt.mockRejectedValue(err)

    await expect(session.prompt('test')).rejects.toThrow('LLM failed')

    const errorEvent = events.find((e) => e.type === 'error')
    expect(errorEvent).toBeDefined()
    expect((errorEvent as any).error).toBe(err)
  })

  it('destroy clears all handlers', () => {
    const handler = vi.fn()
    session.subscribe(handler)

    session.destroy()

    // Events after destroy should not reach handler
    if (mockSubscribeCallback.current) {
      mockSubscribeCallback.current({
        type: 'message_update',
        message: {},
        assistantMessageEvent: { type: 'text_delta', delta: 'after destroy' },
      })
    }

    expect(handler).not.toHaveBeenCalled()
  })
})
