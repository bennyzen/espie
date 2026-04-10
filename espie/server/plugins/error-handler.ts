// Nitro plugin: safety net for network errors in the worker process.
//
// The primary fix is in nuxt.config.ts (listen hook), which handles
// the raw TCP socket errors in the parent Nuxt CLI process. This plugin
// is a fallback for any network errors that still reach the worker.

const NETWORK_ERRORS = ['ECONNRESET', 'EPIPE', 'ENOTCONN', 'ECONNABORTED']

function isNetworkError(err: any): boolean {
  if (!err) return false
  const msg = err?.message || String(err)
  const code = err?.code || ''
  return NETWORK_ERRORS.some(e => msg.includes(e) || code === e)
}

export default defineNitroPlugin(() => {
  process.on('unhandledRejection', (reason: any) => {
    if (isNetworkError(reason)) {
      console.warn('[ws] Network error in worker — ignored')
      return
    }
    console.error('[unhandledRejection]', reason)
  })

  process.on('uncaughtException', (err: any) => {
    if (isNetworkError(err)) {
      console.warn('[ws] Network error in worker — ignored')
      return
    }
    console.error('[uncaughtException]', err)
  })
})
