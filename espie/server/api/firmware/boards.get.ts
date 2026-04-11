import fs from 'fs'
import path from 'path'

export default defineEventHandler(async () => {
  const firmwareDir = process.env.FIRMWARE_DIR || './data/firmware'
  const boardsPath = path.join(firmwareDir, 'boards.json')

  if (!fs.existsSync(boardsPath)) {
    throw createError({ statusCode: 404, statusMessage: 'No boards.json found' })
  }

  return JSON.parse(fs.readFileSync(boardsPath, 'utf-8'))
})
