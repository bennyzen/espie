import { useDatabase } from '../../utils/db'

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, message: 'Session ID required' })
  }

  const db = useDatabase()

  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id)

  if (!session) {
    throw createError({ statusCode: 404, message: 'Session not found' })
  }

  const messages = db.prepare(
    'SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC'
  ).all(id)

  return {
    session,
    messages,
  }
})
