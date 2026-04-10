// PUT /api/memory/:id -- update a memory fact's content.
// Re-embeds the updated text and replaces the vector in memory_vec.

import { useDatabase } from '../../utils/db'
import { createEmbeddings } from '../../providers/registry'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing fact ID' })
  }

  const body = await readBody<{ content: string }>(event)
  if (!body?.content?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'Missing content' })
  }

  const db = useDatabase()

  const existing = db.prepare('SELECT id FROM memory_facts WHERE id = ?').get(id) as { id: string } | undefined
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Memory fact not found' })
  }

  // Re-embed the updated content
  const embeddings = createEmbeddings()
  const [embedding] = await embeddings.embed([body.content.trim()])
  const embeddingBuffer = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength)

  // Update fact content
  db.prepare('UPDATE memory_facts SET content = ?, last_accessed_at = ? WHERE id = ?')
    .run(body.content.trim(), Date.now(), id)

  // Replace vector: delete old + insert new
  db.prepare('DELETE FROM memory_vec WHERE id = ?').run(id)
  db.prepare('INSERT INTO memory_vec (id, embedding) VALUES (?, ?)').run(id, embeddingBuffer)

  return { success: true }
})
