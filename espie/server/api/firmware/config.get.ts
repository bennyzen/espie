import { loadConfig } from '../../utils/config'

export default defineEventHandler(async (event) => {
  const config = loadConfig()

  const host = getRequestHeader(event, 'host') || 'localhost:8000'
  const proto = getRequestHeader(event, 'x-forwarded-proto') || 'http'
  const serverUrl = `${proto}://${host}`

  return {
    ssid: config.wifi?.ssid || '',
    password: config.wifi?.password || '',
    serverUrl,
  }
})
