import { unlinkSync, existsSync } from 'fs'
import { resolve, basename } from 'path'
import { createError } from 'h3'

export default defineEventHandler((event) => {
  const path = getRouterParam(event, 'path') || ''
  const filename = basename(decodeURIComponent(path))

  if (!filename || !filename.endsWith('.mp3')) {
    throw createError({ statusCode: 400, message: 'Invalid filename' })
  }

  const ytmusicDir = resolve(process.env.YTMUSIC_DIR || './data/ytmusic')
  const filePath = resolve(ytmusicDir, filename)

  if (!filePath.startsWith(ytmusicDir) || !existsSync(filePath)) {
    throw createError({ statusCode: 404, message: 'Not found' })
  }

  unlinkSync(filePath)
  return { success: true }
})
