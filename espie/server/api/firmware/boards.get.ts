import fs from 'fs'
import path from 'path'

export default defineEventHandler(async () => {
  const firmwareDir = process.env.FIRMWARE_DIR || './data/firmware'
  const boardsPath = path.join(firmwareDir, 'boards.json')

  if (!fs.existsSync(boardsPath)) {
    throw createError({ statusCode: 404, statusMessage: 'No boards.json found' })
  }

  const manifest = JSON.parse(fs.readFileSync(boardsPath, 'utf-8'))

  // Filter to boards that have firmware built and available on disk
  manifest.boards = manifest.boards.filter((board: any) => {
    if (!board.version || !board.app?.path) return false
    return fs.existsSync(path.join(firmwareDir, board.app.path))
  })

  return manifest
})
