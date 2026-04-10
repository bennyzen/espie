import { useDatabase } from '../../utils/db'

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const page = Number(query.page) || 1
  const limit = Number(query.limit) || 20
  const type = query.type as string | undefined
  const offset = (page - 1) * limit

  const db = useDatabase()

  let whereClause = ''
  const params: (string | number)[] = []

  if (type) {
    whereClause = 'WHERE s.type = ?'
    params.push(type)
  }

  const countRow = db.prepare(
    `SELECT COUNT(*) as total FROM sessions s ${whereClause}`
  ).get(...params) as { total: number }

  const sessions = db.prepare(
    `SELECT s.*, COUNT(m.id) as message_count,
     (SELECT content FROM messages WHERE session_id = s.id ORDER BY created_at ASC LIMIT 1) as first_message
     FROM sessions s
     LEFT JOIN messages m ON m.session_id = s.id
     ${whereClause}
     GROUP BY s.id
     ORDER BY s.started_at DESC
     LIMIT ? OFFSET ?`
  ).all(...params, limit, offset)

  return {
    sessions,
    total: countRow.total,
    page,
    limit,
  }
})
