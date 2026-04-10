import fs from 'fs'
import path from 'path'

/**
 * Parse a version string into numeric tuple.
 * Extracts all digit groups: '1.2.3' -> [1,2,3], 'v2.0.1-beta' -> [2,0,1]
 */
export function parseVersion(ver: string): number[] {
  const parts = ver.match(/\d+/g)
  return parts ? parts.map(Number) : [0]
}

/**
 * Return true if version string a is strictly higher than b.
 * Compares lexicographically by numeric tuple, padding shorter with zeros.
 */
export function isHigherVersion(a: string, b: string): boolean {
  const ta = parseVersion(a)
  const tb = parseVersion(b)
  const maxLen = Math.max(ta.length, tb.length)
  for (let i = 0; i < maxLen; i++) {
    const ai = i < ta.length ? ta[i] : 0
    const bi = i < tb.length ? tb[i] : 0
    if (ai > bi) return true
    if (ai < bi) return false
  }
  return false
}

/**
 * Scan binDir for firmware files matching {model}_{version}.bin pattern.
 * Returns the highest version newer than deviceVersion, or null.
 */
export function findNewerFirmware(
  model: string,
  deviceVersion: string,
  binDir: string
): { version: string; filename: string } | null {
  if (!fs.existsSync(binDir)) return null

  const files = fs.readdirSync(binDir)
  const candidates: { version: string; filename: string }[] = []

  for (const fname of files) {
    // Match pattern: {model}_{version}.bin
    const match = fname.match(/^(.+?)_([0-9][A-Za-z0-9.\-_]*)\.bin$/)
    if (!match) continue
    if (match[1] !== model) continue
    const ver = match[2]
    if (isHigherVersion(ver, deviceVersion)) {
      candidates.push({ version: ver, filename: fname })
    }
  }

  if (candidates.length === 0) return null

  // Sort descending by version, return highest
  candidates.sort((a, b) => {
    if (isHigherVersion(a.version, b.version)) return -1
    if (isHigherVersion(b.version, a.version)) return 1
    return 0
  })

  return candidates[0]
}

export interface OtaResponse {
  server_time: {
    timestamp: number
    timezone_offset: number
  }
  websocket?: {
    url: string
    token: string
  }
  firmware: {
    version: string
    url: string
  }
}

/**
 * Build the OTA POST response.
 */
export function buildOtaResponse(opts: {
  deviceVersion: string
  deviceModel: string
  binDir: string
  wsUrl: string
  downloadBaseUrl: string
  timezoneOffsetHours: number
}): OtaResponse {
  const newer = findNewerFirmware(opts.deviceModel, opts.deviceVersion, opts.binDir)

  const response: OtaResponse = {
    server_time: {
      timestamp: Date.now(),
      timezone_offset: opts.timezoneOffsetHours * 60,
    },
    websocket: {
      url: opts.wsUrl,
      token: '',
    },
    firmware: {
      version: newer ? newer.version : opts.deviceVersion,
      url: newer ? `${opts.downloadBaseUrl}/${newer.filename}` : '',
    },
  }

  return response
}

/**
 * Sanitize filename to prevent path traversal. Returns basename only.
 */
export function sanitizeFilename(filename: string): string {
  return path.basename(filename)
}

/**
 * Validate that a filename matches the safe firmware pattern.
 * Only allows alphanumeric characters, dots, dashes, underscores, ending in .bin
 */
export function isValidBinFilename(filename: string): boolean {
  return /^[A-Za-z0-9.\-_]+\.bin$/.test(filename)
}
