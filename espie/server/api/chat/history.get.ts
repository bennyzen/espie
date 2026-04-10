// GET /api/chat/history — returns recent messages across all session types
// (voice, web, scheduler) for the persistent chat timeline.

import { useDatabase } from '../../utils/db'

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const limit = Math.min(Number(query.limit) || 50, 200)
  const before = Number(query.before) || undefined

  const db = useDatabase()

  const whereClause = before ? 'WHERE m.created_at < ?' : ''
  const params: (string | number)[] = before ? [before] : []

  const rows = db.prepare(`
    SELECT m.id, m.session_id, m.role, m.content, m.created_at,
           s.type as session_type, s.device_id
    FROM messages m
    JOIN sessions s ON s.id = m.session_id
    ${whereClause}
    ORDER BY m.created_at DESC
    LIMIT ?
  `).all(...params, limit) as any[]

  // Return in chronological order
  return rows.reverse()
})
