/**
 * Integration test: verifies fastembed produces correct 384-dim embeddings
 * and that they can be saved/retrieved via MemoryService with a real SQLite DB.
 *
 * This catches the silent failure where fastembed yields batches ([Float32Array])
 * and wrapping with new Float32Array(batch) produces Float32Array(1) [NaN],
 * which sqlite-vec rejects because the dimension doesn't match.
 */
import { describe, it, expect, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const tempDirs: string[] = []

afterAll(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('Embeddings integration', () => {
  it('createEmbeddings().embed() returns 384-dim Float32Array, not a wrapped batch', async () => {
    const { createEmbeddings } = await import('../../server/providers/embeddings')
    const provider = createEmbeddings()

    const results = await provider.embed(['test sentence'])

    expect(results).toHaveLength(1)
    expect(results[0]).toBeInstanceOf(Float32Array)
    expect(results[0].length).toBe(384)
    // Must not be NaN (the old bug produced Float32Array([NaN]))
    expect(Number.isNaN(results[0][0])).toBe(false)
  }, 30000)

  it('embed() handles multiple texts correctly', async () => {
    const { createEmbeddings } = await import('../../server/providers/embeddings')
    const provider = createEmbeddings()

    const results = await provider.embed(['first', 'second', 'third'])

    expect(results).toHaveLength(3)
    for (const emb of results) {
      expect(emb).toBeInstanceOf(Float32Array)
      expect(emb.length).toBe(384)
      expect(Number.isNaN(emb[0])).toBe(false)
    }
  }, 30000)

  it('MemoryService.save() + retrieve() round-trip with real embeddings', async () => {
    // Set up a real temp DB
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'espie-embed-test-'))
    tempDirs.push(dir)
    process.env.DATABASE_PATH = path.join(dir, 'test.db')

    // Fresh imports
    const { vi } = await import('vitest')
    vi.resetModules()
    const { useDatabase, closeDatabase } = await import('../../server/utils/db')
    const { createMemoryService } = await import('../../server/utils/memory')
    const { createEmbeddings } = await import('../../server/providers/embeddings')

    const db = useDatabase()
    const embeddings = createEmbeddings()
    const service = createMemoryService(db, embeddings)

    try {
      // Save should not throw
      const result = await service.save('User prefers dark mode')
      expect(result.action).toBe('created')
      expect(result.id).toBeTruthy()

      // Verify row exists in DB
      const row = db.prepare('SELECT content FROM memory_facts WHERE id = ?').get(result.id) as any
      expect(row.content).toBe('User prefers dark mode')

      // Retrieve should find it
      const found = await service.retrieve('dark mode', 5)
      expect(found.length).toBeGreaterThan(0)
      expect(found[0].content).toBe('User prefers dark mode')
    } finally {
      closeDatabase()
    }
  }, 30000)
})
