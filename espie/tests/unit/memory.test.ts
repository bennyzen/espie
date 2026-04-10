import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { EmbeddingProvider } from '../../server/providers/embeddings'

// Track temp dirs for cleanup
const tempDirs: string[] = []

function createTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'espie-memory-test-'))
  tempDirs.push(dir)
  return path.join(dir, 'test.db')
}

/**
 * Create a mock EmbeddingProvider that returns deterministic embeddings.
 * The embedding is a normalized vector where the first element is derived
 * from the first char code of the text (for predictable similarity tests).
 */
function createMockEmbeddings(): EmbeddingProvider & { embed: ReturnType<typeof vi.fn> } {
  const embed = vi.fn(async (texts: string[]) => {
    return texts.map((text) => {
      // Generate a deterministic 384-dim vector from the text
      const arr = new Float32Array(384)
      for (let i = 0; i < 384; i++) {
        arr[i] = ((text.charCodeAt(i % text.length) + i) % 100) / 100
      }
      // Normalize to unit length for cosine
      const norm = Math.sqrt(arr.reduce((sum, v) => sum + v * v, 0))
      for (let i = 0; i < 384; i++) {
        arr[i] /= norm
      }
      return arr
    })
  })

  return { embed, dimensions: 384 }
}

describe('MemoryService', () => {
  let db: any
  let closeDatabase: () => void

  beforeEach(async () => {
    process.env.DATABASE_PATH = createTempDbPath()
    // Fresh import to get a new singleton
    vi.resetModules()
    const dbMod = await import('../../server/utils/db')
    db = dbMod.useDatabase()
    closeDatabase = dbMod.closeDatabase
  })

  afterEach(() => {
    closeDatabase()
  })

  afterAll(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  describe('save()', () => {
    it('saves a new fact and returns action=created', async () => {
      const { createMemoryService } = await import('../../server/utils/memory')
      const embeddings = createMockEmbeddings()
      const service = createMemoryService(db, embeddings)

      const result = await service.save('User prefers dark mode')

      expect(result.action).toBe('created')
      expect(result.id).toBeTruthy()
      expect(embeddings.embed).toHaveBeenCalledWith(['User prefers dark mode'])

      // Verify it's in memory_facts
      const row = db.prepare('SELECT * FROM memory_facts WHERE id = ?').get(result.id) as any
      expect(row).toBeTruthy()
      expect(row.content).toBe('User prefers dark mode')
    })

    it('always creates new facts (dedup is handled by LLM via replace_id)', async () => {
      const { createMemoryService } = await import('../../server/utils/memory')

      const fixedEmbedding = new Float32Array(384)
      for (let i = 0; i < 384; i++) fixedEmbedding[i] = (i % 10) / 10
      const norm = Math.sqrt(fixedEmbedding.reduce((sum, v) => sum + v * v, 0))
      for (let i = 0; i < 384; i++) fixedEmbedding[i] /= norm

      const embeddings: EmbeddingProvider & { embed: ReturnType<typeof vi.fn> } = {
        dimensions: 384,
        embed: vi.fn(async (_texts: string[]) => [fixedEmbedding]),
      }

      const service = createMemoryService(db, embeddings)

      const result1 = await service.save('User likes coffee')
      expect(result1.action).toBe('created')

      // Same embedding but no dedup — LLM decides via tool parameters
      const result2 = await service.save('User enjoys coffee')
      expect(result2.action).toBe('created')
      expect(result2.id).not.toBe(result1.id)
    })
  })

  describe('retrieve()', () => {
    it('returns empty array when DB has no facts', async () => {
      const { createMemoryService } = await import('../../server/utils/memory')
      const embeddings = createMockEmbeddings()
      const service = createMemoryService(db, embeddings)

      const results = await service.retrieve('anything')

      expect(results).toEqual([])
    })

    it('returns matching facts sorted by relevance', async () => {
      const { createMemoryService } = await import('../../server/utils/memory')
      const embeddings = createMockEmbeddings()
      const service = createMemoryService(db, embeddings)

      // Save some facts
      await service.save('User prefers dark mode')
      await service.save('User has a cat named Luna')
      await service.save('User works from home on Fridays')

      // Retrieve (will use the mock embeddings for query)
      const results = await service.retrieve('dark mode preferences')

      expect(results.length).toBeGreaterThan(0)
      expect(results.length).toBeLessThanOrEqual(5)
      // Each result has expected shape
      for (const r of results) {
        expect(r).toHaveProperty('id')
        expect(r).toHaveProperty('content')
        expect(r).toHaveProperty('distance')
        expect(typeof r.distance).toBe('number')
      }
    })

    it('updates last_accessed_at and access_count on returned facts', async () => {
      const { createMemoryService } = await import('../../server/utils/memory')
      const embeddings = createMockEmbeddings()
      const service = createMemoryService(db, embeddings)

      const saved = await service.save('User prefers dark mode')

      // Check initial access_count
      const before = db.prepare('SELECT access_count FROM memory_facts WHERE id = ?').get(saved.id) as any
      expect(before.access_count).toBe(0)

      // Retrieve (should increment access_count)
      await service.retrieve('dark mode')

      const after = db.prepare('SELECT access_count, last_accessed_at FROM memory_facts WHERE id = ?').get(saved.id) as any
      expect(after.access_count).toBe(1)
      expect(after.last_accessed_at).toBeTruthy()
    })

    it('respects the k parameter for max results', async () => {
      const { createMemoryService } = await import('../../server/utils/memory')
      const embeddings = createMockEmbeddings()
      const service = createMemoryService(db, embeddings)

      // Save multiple facts
      await service.save('Fact one')
      await service.save('Fact two')
      await service.save('Fact three')

      const results = await service.retrieve('query', 2)

      expect(results.length).toBeLessThanOrEqual(2)
    })
  })

  describe('deleteFact()', () => {
    it('removes from both memory_facts and memory_vec', async () => {
      const { createMemoryService } = await import('../../server/utils/memory')
      const embeddings = createMockEmbeddings()
      const service = createMemoryService(db, embeddings)

      const saved = await service.save('Temporary fact')

      // Verify exists
      const before = db.prepare('SELECT COUNT(*) as count FROM memory_facts WHERE id = ?').get(saved.id) as any
      expect(before.count).toBe(1)

      // Delete
      service.deleteFact(saved.id)

      // Verify deleted from memory_facts
      const afterFacts = db.prepare('SELECT COUNT(*) as count FROM memory_facts WHERE id = ?').get(saved.id) as any
      expect(afterFacts.count).toBe(0)

      // Verify deleted from memory_vec
      const afterVec = db.prepare('SELECT COUNT(*) as count FROM memory_vec WHERE id = ?').get(saved.id) as any
      expect(afterVec.count).toBe(0)
    })
  })
})
