// Nitro plugin: starts the minute-tick scheduler on server boot
// and stops it cleanly on shutdown.

import { EspieScheduler } from '../utils/scheduler'

export default defineNitroPlugin((nitro) => {
  const scheduler = new EspieScheduler()
  scheduler.start()

  nitro.hooks.hook('close', () => {
    scheduler.stop()
  })
})
