import nodeCron from 'node-cron'
import { useDatabase } from '../../utils/db'
import { updateSchedule } from '../../utils/schedules'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const body = await readBody(event)

  if (body.cron && !nodeCron.validate(body.cron)) {
    throw createError({ statusCode: 400, message: `Invalid cron expression: ${body.cron}` })
  }

  const schedule = updateSchedule(useDatabase(), id, body)
  if (!schedule) {
    throw createError({ statusCode: 404, message: 'Schedule not found' })
  }
  return schedule
})
