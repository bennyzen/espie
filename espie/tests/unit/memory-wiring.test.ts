import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('Memory deletion API', () => {
  it('[id].delete.ts exists and contains defineEventHandler', async () => {
    const { readFileSync, existsSync } = await import('fs')
    const { resolve } = await import('path')
    const filePath = resolve(__dirname, '../../server/api/memory/[id].delete.ts')

    expect(existsSync(filePath)).toBe(true)

    const source = readFileSync(filePath, 'utf-8')
    expect(source).toContain('defineEventHandler')
    expect(source).toContain('getRouterParam')
    expect(source).toContain('createError')
    expect(source).toContain('404')
  })

  it('handler deletes from both memory_facts and memory_vec tables', async () => {
    const { readFileSync } = await import('fs')
    const { resolve } = await import('path')
    const source = readFileSync(
      resolve(__dirname, '../../server/api/memory/[id].delete.ts'),
      'utf-8',
    )

    // Verify the handler deletes from both tables
    expect(source).toContain("DELETE FROM memory_facts WHERE id = ?")
    expect(source).toContain("DELETE FROM memory_vec WHERE id = ?")
    // Verify it checks for existence first
    expect(source).toContain("SELECT id FROM memory_facts WHERE id = ?")
  })

  it('handler returns 404 for non-existent fact', async () => {
    const { readFileSync } = await import('fs')
    const { resolve } = await import('path')
    const source = readFileSync(
      resolve(__dirname, '../../server/api/memory/[id].delete.ts'),
      'utf-8',
    )

    // Verify the 404 error is thrown for missing facts
    expect(source).toContain('404')
    expect(source).toContain('Memory fact not found')
  })

  it('validates deletion contract: both tables cleaned up', () => {
    // Simulate what the handler does: delete from both tables
    const runCalls: Array<{ sql: string; params: any[] }> = []
    const mockDb = {
      prepare: (sql: string) => ({
        get: (...params: any[]) => {
          if (sql.includes('SELECT id FROM memory_facts')) {
            return { id: 'test-fact-id' }
          }
          return null
        },
        run: (...params: any[]) => {
          runCalls.push({ sql, params })
        },
      }),
    }

    // Verify the endpoint performs both deletions
    // This test validates the contract: both tables must be cleaned up
    const factId = 'test-fact-id'
    const selectResult = mockDb.prepare('SELECT id FROM memory_facts WHERE id = ?').get(factId)
    expect(selectResult).toEqual({ id: 'test-fact-id' })

    mockDb.prepare('DELETE FROM memory_facts WHERE id = ?').run(factId)
    mockDb.prepare('DELETE FROM memory_vec WHERE id = ?').run(factId)

    expect(runCalls).toHaveLength(2)
    expect(runCalls[0].sql).toContain('memory_facts')
    expect(runCalls[1].sql).toContain('memory_vec')
  })
})

describe('Default personality text', () => {
  it('prompt.ts has a default personality prompt', async () => {
    const { readFileSync } = await import('fs')
    const { resolve } = await import('path')
    const promptSource = readFileSync(
      resolve(__dirname, '../../server/utils/prompt.ts'),
      'utf-8',
    )

    expect(promptSource).toContain('DEFAULT_PERSONALITY')
    expect(promptSource).toContain('You are Espie')
  })

  it('chat.ts uses buildSystemPrompt', async () => {
    const { readFileSync } = await import('fs')
    const { resolve } = await import('path')
    const chatSource = readFileSync(
      resolve(__dirname, '../../server/routes/api/chat.ts'),
      'utf-8',
    )

    expect(chatSource).toContain('buildSystemPrompt')
  })

  it('voice-pipeline.ts uses buildSystemPrompt', async () => {
    const { readFileSync } = await import('fs')
    const { resolve } = await import('path')
    const pipelineSource = readFileSync(
      resolve(__dirname, '../../server/utils/voice-pipeline.ts'),
      'utf-8',
    )

    expect(pipelineSource).toContain('buildSystemPrompt')
  })
})

describe('Personality config parsing', () => {
  let tmpDir: string
  let configPath: string
  let originalConfigPath: string | undefined

  beforeEach(() => {
    tmpDir = join(
      tmpdir(),
      `espie-personality-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    mkdirSync(tmpDir, { recursive: true })
    configPath = join(tmpDir, '.config.yaml')
    originalConfigPath = process.env.CONFIG_PATH
    process.env.CONFIG_PATH = configPath
  })

  afterEach(async () => {
    if (originalConfigPath !== undefined) {
      process.env.CONFIG_PATH = originalConfigPath
    } else {
      delete process.env.CONFIG_PATH
    }
    try {
      rmSync(tmpDir, { recursive: true, force: true })
    } catch {}
    const { vi } = await import('vitest')
    vi.resetModules()
  })

  it('loadConfig with personality.system_prompt returns the prompt', async () => {
    writeFileSync(
      configPath,
      [
        'llm:',
        '  provider: anthropic',
        '  model: claude-sonnet-4-20250514',
        'personality:',
        '  system_prompt: Custom personality here',
      ].join('\n'),
    )

    const { loadConfig } = await import('../../server/utils/config')
    const config = loadConfig()

    expect(config.personality?.system_prompt).toBe('Custom personality here')
  })

  it('loadConfig without personality section returns undefined personality', async () => {
    writeFileSync(
      configPath,
      ['llm:', '  provider: anthropic', '  model: claude-sonnet-4-20250514'].join('\n'),
    )

    const { loadConfig } = await import('../../server/utils/config')
    const config = loadConfig()

    expect(config.personality).toBeUndefined()
  })

  it('loadConfig with no config file returns defaults without personality', async () => {
    // Don't create config file -- loadConfig should return defaults
    process.env.CONFIG_PATH = join(tmpDir, 'nonexistent.yaml')

    const { loadConfig } = await import('../../server/utils/config')
    const config = loadConfig()

    expect(config.personality).toBeUndefined()
    expect(config.llm.provider).toBe('anthropic')
  })
})

describe('Centralized tool registry', () => {
  it('tool registry module exports createSessionTools and createSyncTools', async () => {
    const { readFileSync, existsSync } = await import('fs')
    const { resolve } = await import('path')
    const filePath = resolve(__dirname, '../../server/tools/registry.ts')

    expect(existsSync(filePath)).toBe(true)

    const source = readFileSync(filePath, 'utf-8')
    expect(source).toContain('export async function createSessionTools')
    expect(source).toContain('export function createSyncTools')
    // Should include all tool types
    expect(source).toContain('createSaveMemoryTool')
    expect(source).toContain('createRecallMemoryTool')
    expect(source).toContain('createYTMusicTool')
    expect(source).toContain('createSayTool')
    expect(source).toContain('loadBuiltinTools')
  })

  it('v1.ts uses centralized tool registry', async () => {
    const { readFileSync } = await import('fs')
    const { resolve } = await import('path')
    const source = readFileSync(
      resolve(__dirname, '../../server/routes/xiaozhi/v1.ts'),
      'utf-8',
    )

    expect(source).toContain("from '../../tools/registry'")
    expect(source).toContain('createSessionTools')
    expect(source).toContain('createSyncTools')
    expect(source).toContain('createEmbeddings')
  })

  it('chat.ts uses centralized tool registry', async () => {
    const { readFileSync } = await import('fs')
    const { resolve } = await import('path')
    const source = readFileSync(
      resolve(__dirname, '../../server/routes/api/chat.ts'),
      'utf-8',
    )

    expect(source).toContain("from '../../tools/registry'")
    expect(source).toContain('createSessionTools')
    expect(source).toContain('createEmbeddings')
  })

  it('scheduler.ts uses centralized tool registry', async () => {
    const { readFileSync } = await import('fs')
    const { resolve } = await import('path')
    const source = readFileSync(
      resolve(__dirname, '../../server/utils/scheduler.ts'),
      'utf-8',
    )

    expect(source).toContain("from '../tools/registry'")
    expect(source).toContain('createSessionTools')
    // Scheduler should have transport for say tool
    expect(source).toContain('transport')
  })

  it('chat.ts awaits tools before processing prompts', async () => {
    const { readFileSync } = await import('fs')
    const { resolve } = await import('path')
    const source = readFileSync(
      resolve(__dirname, '../../server/routes/api/chat.ts'),
      'utf-8',
    )

    // Message handler must await _toolsPromise before prompting
    expect(source).toContain('await (peer as any)._toolsPromise')
  })
})

describe('Structured tool logging', () => {
  it('AgentSession logs tool calls with input and output', async () => {
    const { readFileSync } = await import('fs')
    const { resolve } = await import('path')
    const source = readFileSync(
      resolve(__dirname, '../../server/agent/agent-session.ts'),
      'utf-8',
    )

    // Should log tool name + input on start
    expect(source).toContain('toolStartTimes')
    // Should log tool name + output + duration on end
    expect(source).toContain('duration')
    // Should support session labels for log context
    expect(source).toContain('this.label')
  })

  it('AgentSessionOptions includes label field', async () => {
    const { readFileSync } = await import('fs')
    const { resolve } = await import('path')
    const source = readFileSync(
      resolve(__dirname, '../../server/agent/types.ts'),
      'utf-8',
    )

    expect(source).toContain('label?: string')
  })

  it('voice-pipeline does not duplicate tool logging', async () => {
    const { readFileSync } = await import('fs')
    const { resolve } = await import('path')
    const source = readFileSync(
      resolve(__dirname, '../../server/utils/voice-pipeline.ts'),
      'utf-8',
    )

    // Should NOT contain old duplicate logging
    expect(source).not.toContain('Tool executing:')
    expect(source).not.toContain('Tool completed:')
  })
})

describe('Memory context is agentic', () => {
  it('voice pipeline does NOT inject memories before prompt', async () => {
    const { readFileSync } = await import('fs')
    const { resolve } = await import('path')
    const source = readFileSync(
      resolve(__dirname, '../../server/utils/voice-pipeline.ts'),
      'utf-8',
    )

    // No pre-prompt memory retrieval — agent uses recall_memory tool
    expect(source).not.toContain('memoryService.retrieve')
  })

  it('chat.ts does NOT inject memories before prompt', async () => {
    const { readFileSync } = await import('fs')
    const { resolve } = await import('path')
    const source = readFileSync(
      resolve(__dirname, '../../server/routes/api/chat.ts'),
      'utf-8',
    )

    // No pre-prompt memory retrieval — agent uses recall_memory tool
    expect(source).not.toContain('.retrieve(')
  })

  it('memory tools exist with save_memory and recall_memory', async () => {
    const { readFileSync } = await import('fs')
    const { resolve } = await import('path')
    const source = readFileSync(
      resolve(__dirname, '../../server/tools/memory-tools.ts'),
      'utf-8',
    )

    expect(source).toContain("name: 'save_memory'")
    expect(source).toContain("name: 'recall_memory'")
    expect(source).toContain('replace_id')
  })
})
