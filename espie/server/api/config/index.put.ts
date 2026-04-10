import { saveConfig } from '../../utils/config'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  saveConfig(body)
  return { success: true }
})
