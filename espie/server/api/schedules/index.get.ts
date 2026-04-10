import { useDatabase } from '../../utils/db'
import { listSchedules } from '../../utils/schedules'

export default defineEventHandler(() => {
  return listSchedules(useDatabase())
})
