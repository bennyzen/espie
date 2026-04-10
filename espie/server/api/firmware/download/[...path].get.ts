import fs from 'fs'
import path from 'path'

export default defineEventHandler(async (event) => {
  const pathSegments = getRouterParam(event, 'path') || ''

  const firmwareDir = path.resolve(process.env.FIRMWARE_DIR || './data/firmware')
  const filePath = path.resolve(firmwareDir, pathSegments)

  if (!filePath.startsWith(firmwareDir + path.sep) && filePath !== firmwareDir) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }

  if (!fs.existsSync(filePath)) {
    throw createError({ statusCode: 404, statusMessage: 'File not found' })
  }

  const stat = fs.statSync(filePath)
  if (!stat.isFile()) {
    throw createError({ statusCode: 404, statusMessage: 'Not a file' })
  }

  const filename = path.basename(filePath)
  setResponseHeader(event, 'content-type', 'application/octet-stream')
  setResponseHeader(event, 'content-length', stat.size)
  setResponseHeader(event, 'content-disposition', `attachment; filename="${filename}"`)

  return sendStream(event, fs.createReadStream(filePath))
})
