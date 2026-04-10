// SSE endpoint for streaming server logs to the dashboard.
// Sends recent log history on connect, then streams new entries in real-time.
// Supports optional level filter via query parameter: /api/logs?level=error
// Path: /api/logs

import { logBuffer } from '../../utils/log-buffer'

export default defineEventHandler(async (event) => {
  const eventStream = createEventStream(event)

  // Optional level filter from query string
  const query = getQuery(event)
  const levelFilter = query.level as string | undefined

  // Send recent log history so client gets context on connect
  const recent = logBuffer.getRecent(100)
  for (const entry of recent) {
    if (levelFilter && entry.level !== levelFilter) continue
    await eventStream.push(JSON.stringify(entry))
  }

  // Subscribe to new log entries
  const unsubscribe = logBuffer.subscribe(async (entry) => {
    if (levelFilter && entry.level !== levelFilter) return
    try {
      await eventStream.push(JSON.stringify(entry))
    } catch {
      // Stream may be closed
    }
  })

  // Clean up on disconnect
  eventStream.onClosed(() => {
    unsubscribe()
  })

  return eventStream.send()
})
