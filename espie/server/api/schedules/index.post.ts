import nodeCron from 'node-cron'
import { useDatabase } from '../../utils/db'
import { createSchedule } from '../../utils/schedules'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { name, cron, prompt } = body

  if (!name || !cron || !prompt) {
    throw createError({ statusCode: 400, message: 'name, cron, and prompt are required' })
  }
  if (!nodeCron.validate(cron)) {
    throw createError({ statusCode: 400, message: `Invalid cron expression: ${cron}` })
  }

  return createSchedule(useDatabase(), { name, cron, prompt })
})
