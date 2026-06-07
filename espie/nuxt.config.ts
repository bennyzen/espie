// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  future: { compatibilityVersion: 4 },
  modules: ['@nuxt/ui', '@nuxtjs/mdc'],

  // Per-page document titles. The dashboard layout sets the page title via
  // useHead (derived from the route); this template suffixes the app name.
  app: {
    head: {
      titleTemplate: '%s · Espie',
      title: 'Espie',
    },
  },

  // Prevent ECONNRESET from crashing the dev server.
  //
  // Two layers of defense, both in the PARENT Nuxt CLI process
  // (Nitro plugins run in the worker and can't prevent the parent's restart):
  //
  // 1. Socket error handler: catches ECONNRESET as a socket 'error' event
  //    (e.g. when the device disconnects and the TCP read fails immediately)
  //
  // 2. process.emit override: intercepts ECONNRESET that surfaces as an
  //    unhandledRejection from ws-internal promises (e.g. when a pending
  //    WebSocket write rejects after the socket dies). Without this, the
  //    Nuxt CLI's process.once('unhandledRejection', restart) triggers
  //    a full dev server shutdown.
  hooks: {
    listen(server) {
      const NETWORK_ERRORS = ['ECONNRESET', 'EPIPE', 'ENOTCONN', 'ECONNABORTED']
      const isNetworkError = (err: any) => {
        if (!err) return false
        const msg = err?.message || String(err)
        const code = err?.code || ''
        return NETWORK_ERRORS.some((e: string) => msg.includes(e) || code === e)
      }

      // Layer 1: socket error events
      server.prependListener('upgrade', (_req: any, socket: any) => {
        if (!socket.__errorGuarded) {
          socket.__errorGuarded = true
          socket.on('error', (err: any) => {
            if (NETWORK_ERRORS.includes(err?.code)) return
            console.error('[upgrade-guard] Socket error:', err)
          })
        }
      })

      // Layer 2: intercept unhandled rejections from ws internals
      const originalEmit = process.emit.bind(process)
      ;(process as any).emit = function (event: string, ...args: any[]): boolean {
        if (event === 'unhandledRejection' && isNetworkError(args[0])) {
          console.warn('[ws] Network error in parent process — suppressed')
          return true
        }
        return originalEmit(event, ...args)
      }
    },
  },

  css: ['~/assets/css/main.css'],

  colorMode: {
    preference: 'dark',
  },

  devServer: {
    port: parseInt(process.env.NUXT_PORT || '8000'),
  },

  vite: {
    optimizeDeps: {
      include: ['@vue/devtools-core', '@vue/devtools-kit', 'esptool-js'],
    },
  },

  nitro: {
    experimental: {
      websocket: true,
    },
    // Externalize native and CJS modules so Nitro does not try to bundle them
    externals: {
      external: [
        'better-sqlite3',
        'sqlite-vec',
        'onnxruntime-node',
        'onnxruntime-common',
        '@discordjs/opus',
        'opusscript',
        'avr-vad',
        'fastembed',
        'groq-sdk',
        'openai',
        'ai',
        '@earendil-works/pi-agent-core',
        '@earendil-works/pi-ai',
        '@modelcontextprotocol/sdk',
        'chokidar',
        'node-cron',
        'edge-tts-universal',
      ],
    },
    // Force node-cron external at rollup level (CJS events import breaks when bundled)
    rollupConfig: {
      external: ['node-cron'],
    },
  },
})
