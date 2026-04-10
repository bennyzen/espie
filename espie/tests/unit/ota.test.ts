import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import {
  parseVersion,
  isHigherVersion,
  findNewerFirmware,
  buildOtaResponse,
  sanitizeFilename,
  isValidBinFilename,
} from '../../server/utils/ota'

describe('parseVersion', () => {
  it('parses standard semver', () => {
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3])
  })

  it('parses two-segment version', () => {
    expect(parseVersion('0.9.0')).toEqual([0, 9, 0])
  })

  it('strips non-digit prefixes and suffixes', () => {
    expect(parseVersion('v2.0.1-beta')).toEqual([2, 0, 1])
  })

  it('returns [0] for empty string', () => {
    expect(parseVersion('')).toEqual([0])
  })
})

describe('isHigherVersion', () => {
  it('returns true when a > b (patch)', () => {
    expect(isHigherVersion('1.2.3', '1.2.2')).toBe(true)
  })

  it('returns false when a < b (patch)', () => {
    expect(isHigherVersion('1.2.2', '1.2.3')).toBe(false)
  })

  it('returns false when equal', () => {
    expect(isHigherVersion('1.2.3', '1.2.3')).toBe(false)
  })

  it('returns true when major version higher', () => {
    expect(isHigherVersion('2.0.0', '1.9.9')).toBe(true)
  })

  it('returns false when different lengths but equal', () => {
    expect(isHigherVersion('1.2', '1.2.0')).toBe(false)
  })
})

describe('findNewerFirmware', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ota-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('finds newer firmware for matching model', () => {
    fs.writeFileSync(path.join(tmpDir, 'mymodel_1.1.0.bin'), '')
    const result = findNewerFirmware('mymodel', '1.0.0', tmpDir)
    expect(result).toEqual({ version: '1.1.0', filename: 'mymodel_1.1.0.bin' })
  })

  it('returns null when device is newer', () => {
    fs.writeFileSync(path.join(tmpDir, 'mymodel_1.1.0.bin'), '')
    const result = findNewerFirmware('mymodel', '2.0.0', tmpDir)
    expect(result).toBeNull()
  })

  it('returns null for empty directory', () => {
    const result = findNewerFirmware('mymodel', '1.0.0', tmpDir)
    expect(result).toBeNull()
  })

  it('returns null for wrong model', () => {
    fs.writeFileSync(path.join(tmpDir, 'mymodel_1.1.0.bin'), '')
    const result = findNewerFirmware('othermodel', '1.0.0', tmpDir)
    expect(result).toBeNull()
  })

  it('returns highest version when multiple newer exist', () => {
    fs.writeFileSync(path.join(tmpDir, 'mymodel_1.1.0.bin'), '')
    fs.writeFileSync(path.join(tmpDir, 'mymodel_1.3.0.bin'), '')
    fs.writeFileSync(path.join(tmpDir, 'mymodel_1.2.0.bin'), '')
    const result = findNewerFirmware('mymodel', '1.0.0', tmpDir)
    expect(result).toEqual({ version: '1.3.0', filename: 'mymodel_1.3.0.bin' })
  })
})

describe('buildOtaResponse', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ota-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns empty firmware url when no newer firmware', () => {
    const response = buildOtaResponse({
      deviceVersion: '1.0.0',
      deviceModel: 'mymodel',
      binDir: tmpDir,
      wsUrl: 'ws://localhost:8000/xiaozhi/v1/',
      downloadBaseUrl: 'http://localhost:8003/xiaozhi/ota/download',
      timezoneOffsetHours: 0,
    })
    expect(response.firmware.url).toBe('')
    expect(response.firmware.version).toBe('1.0.0')
  })

  it('returns firmware download url when newer firmware exists', () => {
    fs.writeFileSync(path.join(tmpDir, 'mymodel_2.0.0.bin'), '')
    const response = buildOtaResponse({
      deviceVersion: '1.0.0',
      deviceModel: 'mymodel',
      binDir: tmpDir,
      wsUrl: 'ws://localhost:8000/xiaozhi/v1/',
      downloadBaseUrl: 'http://localhost:8003/xiaozhi/ota/download',
      timezoneOffsetHours: 0,
    })
    expect(response.firmware.url).toBe('http://localhost:8003/xiaozhi/ota/download/mymodel_2.0.0.bin')
    expect(response.firmware.version).toBe('2.0.0')
  })

  it('includes server_time with timestamp and timezone_offset', () => {
    const response = buildOtaResponse({
      deviceVersion: '1.0.0',
      deviceModel: 'mymodel',
      binDir: tmpDir,
      wsUrl: 'ws://localhost:8000/xiaozhi/v1/',
      downloadBaseUrl: 'http://localhost:8003/xiaozhi/ota/download',
      timezoneOffsetHours: 8,
    })
    expect(typeof response.server_time.timestamp).toBe('number')
    expect(response.server_time.timezone_offset).toBe(480)
  })

  it('includes websocket url', () => {
    const response = buildOtaResponse({
      deviceVersion: '1.0.0',
      deviceModel: 'mymodel',
      binDir: tmpDir,
      wsUrl: 'ws://192.168.1.100:8000/xiaozhi/v1/',
      downloadBaseUrl: 'http://192.168.1.100:8003/xiaozhi/ota/download',
      timezoneOffsetHours: 0,
    })
    expect(response.websocket?.url).toBe('ws://192.168.1.100:8000/xiaozhi/v1/')
  })
})

describe('sanitizeFilename', () => {
  it('strips directory traversal', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd')
  })

  it('keeps simple filenames', () => {
    expect(sanitizeFilename('firmware.bin')).toBe('firmware.bin')
  })
})

describe('isValidBinFilename', () => {
  it('accepts valid firmware filename', () => {
    expect(isValidBinFilename('model_1.0.0.bin')).toBe(true)
  })

  it('rejects path traversal attempts', () => {
    expect(isValidBinFilename('../hack.bin')).toBe(false)
  })

  it('rejects non-bin extensions', () => {
    expect(isValidBinFilename('model_1.0.0.exe')).toBe(false)
  })

  it('rejects filenames with spaces', () => {
    expect(isValidBinFilename('my firmware.bin')).toBe(false)
  })
})
