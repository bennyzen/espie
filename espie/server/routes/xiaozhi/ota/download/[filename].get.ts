import { sanitizeFilename, isValidBinFilename } from '../../../../utils/ota'
import fs from 'fs'
import path from 'path'

export default defineEventHandler(async (event) => {
  const filename = getRouterParam(event, 'filename') || ''

  // Sanitize: take basename only
  const safe = sanitizeFilename(filename)

  // Validate filename pattern
  if (!isValidBinFilename(safe)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid filename' })
  }

  const binDir = process.env.BIN_DIR || './data/bin'
  const filePath = path.join(binDir, safe)

  // Verify both binDir and file exist before realpath checks
  if (!fs.existsSync(binDir)) {
    throw createError({ statusCode: 404, statusMessage: 'File not found' })
  }

  if (!fs.existsSync(filePath)) {
    throw createError({ statusCode: 404, statusMessage: 'File not found' })
  }

  // Verify realpath is under binDir (prevent symlink traversal)
  const fileReal = fs.realpathSync(filePath)
  const binDirReal = fs.realpathSync(binDir)

  if (!fileReal.startsWith(binDirReal + path.sep) && fileReal !== binDirReal) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }

  // Stream the file with Content-Length (ESP32 OTA requires it)
  const stat = fs.statSync(fileReal)
  setResponseHeader(event, 'content-type', 'application/octet-stream')
  setResponseHeader(event, 'content-length', stat.size)
  setResponseHeader(event, 'content-disposition', `attachment; filename="${safe}"`)

  return sendStream(event, fs.createReadStream(fileReal))
})
