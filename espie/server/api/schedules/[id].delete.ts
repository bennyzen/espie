import { useDatabase } from '../../utils/db'
import { deleteSchedule } from '../../utils/schedules'

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')!
  const deleted = deleteSchedule(useDatabase(), id)
  if (!deleted) {
    throw createError({ statusCode: 404, message: 'Schedule not found' })
  }
  return { success: true }
})
