import { useDatabase } from '../../utils/db'

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const page = Number(query.page) || 1
  const limit = Number(query.limit) || 50
  const q = query.q as string | undefined
  const offset = (page - 1) * limit

  const db = useDatabase()

  let whereClause = ''
  const params: (string | number)[] = []

  if (q) {
    whereClause = "WHERE content LIKE '%' || ? || '%'"
    params.push(q)
  }

  const countRow = db.prepare(
    `SELECT COUNT(*) as total FROM memory_facts ${whereClause}`
  ).get(...params) as { total: number }

  const facts = db.prepare(
    `SELECT id, content, source_message_id, created_at, last_accessed_at, access_count
     FROM memory_facts
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`
  ).all(...params, limit, offset)

  return {
    facts,
    total: countRow.total,
    page,
    limit,
  }
})
