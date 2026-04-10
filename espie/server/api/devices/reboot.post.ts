import { deviceRegistry } from '../../utils/device-registry'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const deviceId = body?.deviceId

  if (!deviceId) {
    throw createError({ statusCode: 400, statusMessage: 'deviceId required' })
  }

  const device = deviceRegistry.get(deviceId)
  if (!device) {
    throw createError({ statusCode: 404, statusMessage: 'Device not connected' })
  }

  if (!device.transport) {
    throw createError({ statusCode: 503, statusMessage: 'Device has no active transport' })
  }

  try { device.transport.sendText(JSON.stringify({ type: 'system', command: 'reboot' })) } catch {
    throw createError({ statusCode: 503, statusMessage: 'Failed to send reboot command' })
  }
  console.log(`[devices] Reboot command sent to ${deviceId}`)

  return { ok: true }
})
