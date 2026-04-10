import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MemoryService } from '../../server/utils/memory'

function createMockMemoryService() {
  return {
    save: vi.fn().mockResolvedValue({ action: 'created', id: 'test-id-123' }),
    retrieve: vi.fn().mockResolvedValue([
      { id: 'fact-1', content: 'User prefers dark mode', distance: 0.05 },
      { id: 'fact-2', content: 'User has a cat', distance: 0.12 },
    ]),
    deleteFact: vi.fn(),
  } as unknown as MemoryService
}

describe('save_memory tool', () => {
  let mockService: MemoryService

  beforeEach(() => {
    mockService = createMockMemoryService()
  })

  it('has correct name and label', async () => {
    const { createSaveMemoryTool } = await import('../../server/tools/memory-tools')
    const tool = createSaveMemoryTool(mockService)

    expect(tool.name).toBe('save_memory')
    expect(tool.label).toBe('save_memory')
  })

  it('has a description about saving facts', async () => {
    const { createSaveMemoryTool } = await import('../../server/tools/memory-tools')
    const tool = createSaveMemoryTool(mockService)

    expect(tool.description).toContain('Save')
    expect(tool.description.length).toBeGreaterThan(20)
  })

  it('calls memoryService.save with the fact parameter', async () => {
    const { createSaveMemoryTool } = await import('../../server/tools/memory-tools')
    const tool = createSaveMemoryTool(mockService)

    await tool.execute('tool-call-1', { fact: 'User likes pizza' })

    expect(mockService.save).toHaveBeenCalledWith('User likes pizza')
  })

  it('returns confirmation text with the fact', async () => {
    const { createSaveMemoryTool } = await import('../../server/tools/memory-tools')
    const tool = createSaveMemoryTool(mockService)

    const result = await tool.execute('tool-call-1', { fact: 'User likes pizza' })

    expect(result.content).toBeDefined()
    expect(result.content[0].type).toBe('text')
    expect(result.content[0].text).toContain('User likes pizza')
  })
})

describe('recall_memory tool', () => {
  let mockService: MemoryService

  beforeEach(() => {
    mockService = createMockMemoryService()
  })

  it('has correct name and label', async () => {
    const { createRecallMemoryTool } = await import('../../server/tools/memory-tools')
    const tool = createRecallMemoryTool(mockService)

    expect(tool.name).toBe('recall_memory')
    expect(tool.label).toBe('recall_memory')
  })

  it('has a description about searching memory', async () => {
    const { createRecallMemoryTool } = await import('../../server/tools/memory-tools')
    const tool = createRecallMemoryTool(mockService)

    expect(tool.description).toContain('memory')
    expect(tool.description.length).toBeGreaterThan(20)
  })

  it('calls memoryService.retrieve with the query parameter', async () => {
    const { createRecallMemoryTool } = await import('../../server/tools/memory-tools')
    const tool = createRecallMemoryTool(mockService)

    await tool.execute('tool-call-2', { query: 'dark mode preferences' })

    expect(mockService.retrieve).toHaveBeenCalledWith('dark mode preferences')
  })

  it('formats results as bullet list', async () => {
    const { createRecallMemoryTool } = await import('../../server/tools/memory-tools')
    const tool = createRecallMemoryTool(mockService)

    const result = await tool.execute('tool-call-2', { query: 'preferences' })

    expect(result.content[0].type).toBe('text')
    expect(result.content[0].text).toContain('User prefers dark mode')
    expect(result.content[0].text).toContain('User has a cat')
  })

  it('returns "No relevant memories found" when empty', async () => {
    ;(mockService.retrieve as any).mockResolvedValue([])

    const { createRecallMemoryTool } = await import('../../server/tools/memory-tools')
    const tool = createRecallMemoryTool(mockService)

    const result = await tool.execute('tool-call-2', { query: 'something unknown' })

    expect(result.content[0].text).toContain('No relevant memories found')
  })
})
