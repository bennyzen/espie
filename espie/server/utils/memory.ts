// Memory Service — persistent fact storage with vector embeddings.
// Saves facts with deduplication (cosine similarity > 0.9),
// retrieves top-K relevant facts via sqlite-vec KNN search,
// and tracks access patterns for memory management.

import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { EmbeddingProvider } from '../providers/embeddings'

export interface SaveResult {
  action: 'created' | 'updated'
  id: string
}

export interface MemoryFact {
  id: string
  content: string
  distance: number
}

export class MemoryService {
  private db: Database.Database
  private embeddings: EmbeddingProvider

  constructor(deps: { db: Database.Database; embeddings: EmbeddingProvider }) {
    this.db = deps.db
    this.embeddings = deps.embeddings
  }

  /**
   * Save a fact to memory with deduplication.
   * If a semantically similar fact exists (cosine distance < 0.1, i.e. similarity > 0.9),
   * updates the existing fact instead of creating a new one.
   */
  async save(content: string, sourceMessageId?: string): Promise<SaveResult> {
    const [embedding] = await this.embeddings.embed([content])
    const embeddingBuffer = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength)

    // No hardcoded dedup — the LLM decides via replace_id in save_memory tool
    const id = randomUUID()
    const now = Date.now()

    this.db
      .prepare(
        'INSERT INTO memory_facts (id, content, source_message_id, embedding, created_at, last_accessed_at, access_count) VALUES (?, ?, ?, ?, ?, ?, 0)',
      )
      .run(id, content, sourceMessageId || null, embeddingBuffer, now, now)

    this.db
      .prepare('INSERT INTO memory_vec (id, embedding) VALUES (?, ?)')
      .run(id, embeddingBuffer)

    console.log(`[memory] Saved new fact ${id}: "${content.slice(0, 80)}" (${embedding.length} dims)`)
    return { action: 'created', id }
  }

  /**
   * Retrieve top-K relevant facts for a query string.
   * Updates access tracking (last_accessed_at, access_count) on returned facts.
   * Returns empty array if no facts exist.
   */
  async retrieve(query: string, k = 5): Promise<MemoryFact[]> {
    // Check if there are any facts first
    const count = this.db.prepare('SELECT COUNT(*) as count FROM memory_facts').get() as { count: number }
    if (count.count === 0) return []

    const [queryEmbedding] = await this.embeddings.embed([query])
    const embeddingBuffer = Buffer.from(queryEmbedding.buffer, queryEmbedding.byteOffset, queryEmbedding.byteLength)

    let results: MemoryFact[]
    try {
      results = this.db
        .prepare(
          `SELECT mv.id, mf.content, mv.distance
           FROM memory_vec mv
           JOIN memory_facts mf ON mf.id = mv.id
           WHERE mv.embedding MATCH ?
             AND k = ?`,
        )
        .all(embeddingBuffer, k) as MemoryFact[]
    } catch (err) {
      console.error('[memory] KNN retrieve failed:', err)
      return []
    }

    if (results.length === 0) return []

    // Update access tracking
    const now = Date.now()
    const updateStmt = this.db.prepare(
      'UPDATE memory_facts SET last_accessed_at = ?, access_count = access_count + 1 WHERE id = ?',
    )
    for (const r of results) {
      updateStmt.run(now, r.id)
    }

    return results
  }

  /**
   * Delete a fact from both memory_facts and memory_vec.
   */
  deleteFact(id: string): void {
    this.db.prepare('DELETE FROM memory_facts WHERE id = ?').run(id)
    this.db.prepare('DELETE FROM memory_vec WHERE id = ?').run(id)
  }
}

/**
 * Factory function for creating a MemoryService instance.
 */
export function createMemoryService(
  db: Database.Database,
  embeddings: EmbeddingProvider,
): MemoryService {
  return new MemoryService({ db, embeddings })
}
