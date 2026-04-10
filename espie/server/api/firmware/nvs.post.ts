import { generateNvsPartition } from '../../utils/nvs-generator'
import { loadConfig } from '../../utils/config'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)

  const config = loadConfig()
  const ssid = body?.ssid || config.wifi?.ssid
  const password = body?.password || config.wifi?.password
  const otaUrl = body?.otaUrl

  if (!ssid) {
    throw createError({ statusCode: 400, statusMessage: 'WiFi SSID is required' })
  }

  const nvsBinary = generateNvsPartition({
    wifi: {
      ssid,
      password: password || '',
      ota_url: otaUrl || undefined,
    },
  })

  setResponseHeader(event, 'content-type', 'application/octet-stream')
  setResponseHeader(event, 'content-length', nvsBinary.byteLength)
  return nvsBinary
})
