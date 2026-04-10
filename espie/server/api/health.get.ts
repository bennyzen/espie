export default defineEventHandler(() => {
  return {
    status: 'ok',
    timestamp: Date.now(),
    uptime: process.uptime(),
  }
})
