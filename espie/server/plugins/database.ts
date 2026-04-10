// Nitro plugin: initializes SQLite database on server startup
// and closes it cleanly on shutdown.

import { useDatabase, closeDatabase } from '../utils/db'

export default defineNitroPlugin((nitro) => {
  const db = useDatabase()
  console.log('[database] SQLite initialized')

  nitro.hooks.hook('close', () => {
    closeDatabase()
    console.log('[database] SQLite closed')
  })
})
