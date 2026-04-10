// DELETE /api/memory/:id -- remove a memory fact from both tables.
// Used by the memory browser page to delete individual facts.

import { useDatabase } from '../../utils/db'

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing fact ID' })
  }

  const db = useDatabase()

  // Check if fact exists
  const existing = db.prepare('SELECT id FROM memory_facts WHERE id = ?').get(id) as
    | { id: string }
    | undefined

  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Memory fact not found' })
  }

  // Delete from both tables
  db.prepare('DELETE FROM memory_facts WHERE id = ?').run(id)
  db.prepare('DELETE FROM memory_vec WHERE id = ?').run(id)

  return { success: true }
})
