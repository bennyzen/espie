import { saveConfig } from '../../utils/config'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { system_prompt } = body
  saveConfig({ personality: { system_prompt } })
  return { success: true }
})
