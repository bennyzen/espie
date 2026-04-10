// SSE endpoint for streaming device status events to the dashboard.
// Sends a snapshot of all connected devices on connect, then pushes updates.
// Path: /api/events

import { deviceRegistry } from '../../utils/device-registry'

export default defineEventHandler(async (event) => {
  const eventStream = createEventStream(event)

  // Send initial snapshot of all connected devices (serializable — no transport functions)
  const currentDevices = deviceRegistry.getAllSerializable()
  const snapshot = JSON.stringify({ type: 'snapshot', devices: currentDevices })
  console.log(`[events] SSE client connected — sending snapshot with ${currentDevices.length} devices`)
  await eventStream.push(snapshot)

  // Subscribe to device registry changes
  const unsubscribe = deviceRegistry.subscribe((devices) => {
    const serializable = devices.map(({ transport, ...rest }: any) => rest)
    const payload = JSON.stringify({ type: 'update', devices: serializable })
    eventStream.push(payload).catch(() => {
      // Stream may be closed
    })
  })

  // Clean up on disconnect
  eventStream.onClosed(() => {
    unsubscribe()
    console.log('[events] SSE client disconnected')
  })

  return eventStream.send()
})
