export default defineEventHandler((event) => {
  const headers = getRequestHeaders(event)
  const host = headers['host'] || 'localhost:8000'
  const wsUrl = `ws://${host}/xiaozhi/v1/`

  return `OTA endpoint running. WebSocket URL: ${wsUrl}`
})
