// NVS partition binary generator for ESP-IDF.
// Implements the subset needed to write string keys into a single namespace.
// Reference: ESP-IDF components/nvs_flash/ (NVS page format v2)

const NVS_PARTITION_SIZE = 16384 // 4 pages
const HEADER_SIZE = 32
const BITMAP_SIZE = 32
const ENTRY_SIZE = 32
const ENTRY_OFFSET = HEADER_SIZE + BITMAP_SIZE // 64

// Page states (uint32 LE)
const PAGE_ACTIVE = 0xFFFFFFFE

// Item types
const TYPE_U8 = 0x01
const TYPE_SZ = 0x21 // string

interface NvsWifiConfig {
  ssid: string
  password: string
  ota_url?: string
}

export interface NvsConfig {
  wifi: NvsWifiConfig
}

// CRC32 lookup table (polynomial 0xEDB88320, reflected)
const crc32Table = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    }
    table[i] = c
  }
  return table
})()

// CRC32 matching esp_rom_crc32_le(0xFFFFFFFF, ...) / zlib.crc32(data, 0xFFFFFFFF)
// Both apply internal XOR: init = 0xFFFFFFFF ^ 0xFFFFFFFF = 0x00000000
export function crc32(data: Uint8Array): number {
  let crc = 0x00000000
  for (let i = 0; i < data.length; i++) {
    crc = crc32Table[(crc ^ data[i]) & 0xFF]! ^ (crc >>> 8)
  }
  return (~crc) >>> 0
}

/**
 * Generate an ESP-IDF NVS partition binary with WiFi credentials.
 * Returns a 16KB Uint8Array ready to flash at the NVS partition offset (0x9000).
 */
export function generateNvsPartition(config: NvsConfig): Uint8Array {
  const buf = new Uint8Array(NVS_PARTITION_SIZE)
  buf.fill(0xFF) // Erased flash state

  const view = new DataView(buf.buffer)
  let entryIndex = 0

  // --- Page header (32 bytes) ---
  view.setUint32(0, PAGE_ACTIVE, true) // mState
  view.setUint32(4, 0, true) // mSeqNumber = 0
  buf[8] = 0xFE // mVersion = V2
  // bytes 9-27: reserved (already 0xFF)
  // CRC32 of bytes 4..27
  const headerCrc = crc32(buf.slice(4, 28))
  view.setUint32(28, headerCrc, true)

  // --- Helper: mark entry as WRITTEN in bitmap ---
  function markWritten(idx: number) {
    const byteOffset = HEADER_SIZE + Math.floor((idx * 2) / 8)
    const bitOffset = (idx * 2) % 8
    buf[byteOffset]! &= ~(1 << bitOffset) // Clear the low bit: 0b11 -> 0b10
  }

  // --- Helper: write a namespace entry ---
  function writeNamespaceEntry(name: string, nsIndexValue: number) {
    const off = ENTRY_OFFSET + entryIndex * ENTRY_SIZE
    buf[off + 0] = 0 // nsIndex = 0 (namespace namespace)
    buf[off + 1] = TYPE_U8
    buf[off + 2] = 1 // span = 1
    buf[off + 3] = 0xFF // chunkIndex

    const keyBytes = new TextEncoder().encode(name)
    for (let i = 0; i < 16; i++) {
      // Pad the 16-byte key field with 0x00 (NOT 0xFF) after the key bytes.
      // ESP-IDF includes the full key field in its key-lookup hash and zero-pads
      // after the null terminator; 0xFF padding makes the device's NVS silently
      // fail to find the key (lookup hash mismatch) even though the data is intact.
      buf[off + 8 + i] = i < keyBytes.length ? keyBytes[i]! : 0
    }

    buf[off + 24] = nsIndexValue

    const crcInput = new Uint8Array(28)
    crcInput.set(buf.slice(off, off + 4), 0)
    crcInput.set(buf.slice(off + 8, off + 32), 4)
    view.setUint32(off + 4, crc32(crcInput), true)

    markWritten(entryIndex)
    entryIndex++
  }

  // --- Helper: write a string entry (spans multiple entries) ---
  function writeStringEntry(nsIndex: number, key: string, value: string) {
    const strBytes = new TextEncoder().encode(value)
    const dataSize = strBytes.length + 1 // include null terminator
    const dataEntries = Math.ceil(dataSize / ENTRY_SIZE)
    const span = 1 + dataEntries

    const off = ENTRY_OFFSET + entryIndex * ENTRY_SIZE

    buf[off + 0] = nsIndex
    buf[off + 1] = TYPE_SZ
    buf[off + 2] = span
    buf[off + 3] = 0xFF // chunkIndex

    const keyBytes = new TextEncoder().encode(key)
    for (let i = 0; i < 16; i++) {
      // Pad the 16-byte key field with 0x00 (NOT 0xFF) after the key bytes.
      // ESP-IDF includes the full key field in its key-lookup hash and zero-pads
      // after the null terminator; 0xFF padding makes the device's NVS silently
      // fail to find the key (lookup hash mismatch) even though the data is intact.
      buf[off + 8 + i] = i < keyBytes.length ? keyBytes[i]! : 0
    }

    view.setUint16(off + 24, dataSize, true)
    // off+26 already 0xFFFF (reserved)
    const rawData = new Uint8Array(dataEntries * ENTRY_SIZE)
    rawData.fill(0xFF)
    rawData.set(strBytes, 0)
    rawData[strBytes.length] = 0 // null terminator
    const dataCrc = crc32(rawData.subarray(0, dataSize))
    view.setUint32(off + 28, dataCrc, true)

    const crcInput = new Uint8Array(28)
    crcInput.set(buf.slice(off, off + 4), 0)
    crcInput.set(buf.slice(off + 8, off + 32), 4)
    view.setUint32(off + 4, crc32(crcInput), true)

    markWritten(entryIndex)
    entryIndex++

    for (let i = 0; i < dataEntries; i++) {
      const dataOff = ENTRY_OFFSET + entryIndex * ENTRY_SIZE
      buf.set(rawData.slice(i * ENTRY_SIZE, (i + 1) * ENTRY_SIZE), dataOff)
      markWritten(entryIndex)
      entryIndex++
    }
  }

  // --- Write namespace "wifi" ---
  writeNamespaceEntry('wifi', 1)

  // --- Write keys ---
  writeStringEntry(1, 'ssid', config.wifi.ssid)
  writeStringEntry(1, 'password', config.wifi.password)
  if (config.wifi.ota_url) {
    writeStringEntry(1, 'ota_url', config.wifi.ota_url)
  }

  return buf
}
