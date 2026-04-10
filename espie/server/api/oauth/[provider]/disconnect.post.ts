// POST /api/oauth/:provider/disconnect — removes stored OAuth credentials for a provider.

import { loadConfig, saveConfig } from '../../../utils/config'

export default defineEventHandler((event) => {
  const provider = getRouterParam(event, 'provider')
  if (!provider) {
    throw createError({ statusCode: 400, statusMessage: 'Missing provider parameter' })
  }

  const config = loadConfig()
  if (config.oauth_credentials?.[provider]) {
    const updated = { ...config.oauth_credentials }
    delete updated[provider]
    saveConfig({ oauth_credentials: updated })
    return { ok: true, message: `Disconnected ${provider} OAuth` }
  }

  return { ok: true, message: `No credentials found for ${provider}` }
})
