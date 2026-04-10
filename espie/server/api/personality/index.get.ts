import { loadConfig } from '../../utils/config'

export default defineEventHandler(() => {
  const config = loadConfig()
  return {
    system_prompt: config.personality?.system_prompt || '',
  }
})
