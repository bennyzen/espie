import { describe, it, expect } from 'vitest'
import { generateNvsPartition, crc32 } from '../../server/utils/nvs-generator'

describe('generateNvsPartition', () => {
  it('returns a 16384-byte buffer', () => {
    const buf = generateNvsPartition({ wifi: { ssid: 'test', password: 'pass' } })
    expect(buf.byteLength).toBe(16384)
  })

  it('writes ACTIVE page state at offset 0', () => {
    const buf = generateNvsPartition({ wifi: { ssid: 'test', password: 'pass' } })
    const view = new DataView(buf.buffer, buf.byteOffset)
    expect(view.getUint32(0, true)).toBe(0xFFFFFFFE)
  })

  it('writes NVS version 0xFE at offset 8', () => {
    const buf = generateNvsPartition({ wifi: { ssid: 'test', password: 'pass' } })
    expect(buf[8]).toBe(0xFE)
  })

  it('writes namespace entry "wifi" at entry 0 (offset 64)', () => {
    const buf = generateNvsPartition({ wifi: { ssid: 'test', password: 'pass' } })
    expect(buf[64]).toBe(0) // nsIndex
    expect(buf[65]).toBe(0x01) // type U8
    expect(buf[66]).toBe(1) // span
    const key = String.fromCharCode(...buf.slice(72, 76))
    expect(key).toBe('wifi')
    expect(buf[88]).toBe(1) // namespace index value
  })

  // Regression: ESP-IDF includes the full 16-byte key field in its key-lookup
  // hash and zero-pads after the null terminator. Padding with 0xFF made the
  // device silently fail to find keys (e.g. ota_url), even though the data was
  // intact — the bug behind "device won't connect" despite a provisioned NVS.
  it('zero-pads the key field after the null terminator (not 0xFF)', () => {
    const buf = generateNvsPartition({
      wifi: { ssid: 'net', password: 'pw', ota_url: 'http://192.168.1.1:8000/xiaozhi/ota/' },
    })
    // namespace entry "wifi" @64: key bytes 72-87, "wifi"=72-75, null=76, pad 77-87
    for (let i = 76; i < 88; i++) expect(buf[i]).toBe(0)
    // ssid string entry @96: key bytes 104-119, "ssid"=104-107, null=108, pad 109-119
    for (let i = 108; i < 120; i++) expect(buf[i]).toBe(0)
  })

  it('writes ssid string entry with correct type', () => {
    const buf = generateNvsPartition({ wifi: { ssid: 'mynet', password: 'pass' } })
    expect(buf[96]).toBe(1) // nsIndex = wifi namespace
    expect(buf[97]).toBe(0x21) // type SZ (string)
    const key = String.fromCharCode(...buf.slice(104, 108))
    expect(key).toBe('ssid')
  })

  it('writes string data in the span entries following the header entry', () => {
    const buf = generateNvsPartition({ wifi: { ssid: 'hello', password: 'pass' } })
    expect(buf[98]).toBe(2) // span
    const data = String.fromCharCode(...buf.slice(128, 133))
    expect(data).toBe('hello')
    expect(buf[133]).toBe(0) // null terminator
  })

  it('writes ota_url when provided', () => {
    const buf = generateNvsPartition({
      wifi: { ssid: 'net', password: 'pw', ota_url: 'http://192.168.1.1:8000/xiaozhi/ota/' },
    })
    expect(buf.byteLength).toBe(16384)
    const str = Buffer.from(buf.slice(64, 4096)).toString('binary')
    expect(str).toContain('ota_url')
  })

  it('pages 1-3 are all 0xFF (uninitialized)', () => {
    const buf = generateNvsPartition({ wifi: { ssid: 'x', password: 'y' } })
    for (let i = 4096; i < 16384; i++) {
      expect(buf[i]).toBe(0xFF)
    }
  })

  it('marks used entries as WRITTEN in bitmap', () => {
    const buf = generateNvsPartition({ wifi: { ssid: 'ab', password: 'cd' } })
    expect(buf[32]).not.toBe(0xFF) // At least entry 0 is WRITTEN
  })
})

describe('crc32', () => {
  it('matches esp_rom_crc32_le(0xFFFFFFFF) / zlib.crc32(data, 0xFFFFFFFF)', () => {
    // Python: zlib.crc32(b"Hello", 0xFFFFFFFF) == 3456926048
    const data = new TextEncoder().encode('Hello')
    expect(crc32(data)).toBe(3456926048)
  })
})
