import fs from 'fs'
import path from 'path'

/**
 * Parse a version string into semver triple [major, minor, patch].
 * Only the first three numeric groups matter for comparison.
 * A trailing fourth segment (e.g. the timestamp in '1.0.0.20260330230942')
 * is dev-build metadata — stored but not used for ordering.
 */
export function parseVersion(ver: string): { semver: number[], build: number | null } {
  const parts = ver.match(/\d+/g)
  if (!parts) return { semver: [0, 0, 0], build: null }
  const nums = parts.map(Number)
  return {
    semver: [nums[0] ?? 0, nums[1] ?? 0, nums[2] ?? 0],
    build: nums.length > 3 ? nums[3]! : null,
  }
}

/**
 * Return true if version string a is strictly higher than b.
 * Compares only the semver triple (major.minor.patch). Dev-build timestamps
 * (4th segment) are ignored — '1.0.0.20260330' is NOT higher than '1.0.0'.
 * This prevents OTA loops when the binary's embedded version differs from
 * the filename version (e.g. dev-ota.sh adds a timestamp to the filename
 * but the binary reports the base version from CMakeLists.txt).
 */
export function isHigherVersion(a: string, b: string): boolean {
  const ta = parseVersion(a).semver
  const tb = parseVersion(b).semver
  for (let i = 0; i < 3; i++) {
    if (ta[i]! > tb[i]!) return true
    if (ta[i]! < tb[i]!) return false
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
    const ver = match[2]!
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

  return candidates[0] ?? null
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
  deviceId: string
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
