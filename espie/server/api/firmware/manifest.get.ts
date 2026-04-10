import fs from 'fs'
import path from 'path'

export default defineEventHandler(async () => {
  const firmwareDir = process.env.FIRMWARE_DIR || './data/firmware'
  const manifestPath = path.join(firmwareDir, 'manifest.json')

  if (!fs.existsSync(manifestPath)) {
    throw createError({ statusCode: 404, statusMessage: 'No firmware manifest found. Run dev-ota.sh to prepare firmware files.' })
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
  return manifest
})
