import { buildOtaResponse } from '../../../utils/ota'

export default defineEventHandler(async (event) => {
  const headers = getRequestHeaders(event)
  const body = await readBody(event).catch(() => ({})) || {}

  const deviceId = headers['device-id'] || ''

  if (!deviceId) {
    throw createError({ statusCode: 400, statusMessage: 'device-id header required' })
  }

  // Determine device model (prefer headers, fallback to body)
  let deviceModel = headers['device-model'] || headers['device_model'] || headers['model'] || ''
  if (!deviceModel) {
    if (body.board && typeof body.board === 'object') {
      deviceModel = body.board.type || ''
    } else if (body.model) {
      deviceModel = body.model
    }
  }
  if (!deviceModel) deviceModel = 'default'

  // Determine device version (prefer headers, fallback to body)
  let deviceVersion = ''
  for (const h of ['device-version', 'device_version', 'firmware-version', 'app-version', 'application-version']) {
    if (headers[h]) { deviceVersion = headers[h] as string; break }
  }
  if (!deviceVersion && body.application?.version) {
    deviceVersion = body.application.version
  }
  if (!deviceVersion) deviceVersion = '0.0.0'

  // Build URLs
  const host = headers['host'] || 'localhost:8000'
  const protocol = headers['x-forwarded-proto'] || 'http'
  const wsUrl = `ws://${host}/xiaozhi/v1/`
  const downloadBaseUrl = `${protocol}://${host}/xiaozhi/ota/download`

  const tzOffsetHours = parseInt(process.env.TZ_OFFSET_HOURS || '0', 10)
  const binDir = process.env.BIN_DIR || './data/bin'

  const response = buildOtaResponse({
    deviceId,
    deviceVersion,
    deviceModel,
    binDir,
    wsUrl,
    downloadBaseUrl,
    timezoneOffsetHours: tzOffsetHours,
  })

  console.log(`[ota] POST from device ${deviceId} (model: ${deviceModel}, version: ${deviceVersion})`)

  return response
})
