// Web Serial API type augmentation (not in TypeScript's default lib)
declare global {
  interface Navigator {
    serial: {
      requestPort(options?: { filters?: { usbVendorId?: number }[] }): Promise<any>
      getPorts(): Promise<any[]>
    }
  }
}

export type WizardStep = 'idle' | 'connecting' | 'board-select' | 'connected' | 'flashing' | 'complete' | 'error'

export interface FlashLogEntry {
  timestamp: number
  level: 'info' | 'success' | 'warn' | 'error'
  message: string
}

export interface FlashProgress {
  partName: string
  partIndex: number
  totalParts: number
  written: number
  total: number
  percent: number
}

export interface ChipInfo {
  chipName: string
  mac: string
  description: string
  features: string[]
}

export interface BoardEntry {
  id: string
  name: string
  description: string
  chipFamily: string
  bootloader: { path: string; offset: string }
  partitionTable: { path: string; offset: string }
  otaData: { path: string; offset: string }
  app: { path: string; offset: string }
  version: string
}

interface BoardsManifest {
  nvsOffset: string
  boards: BoardEntry[]
}

export function useFlashWizard() {
  const step = ref<WizardStep>('idle')
  const logs = ref<FlashLogEntry[]>([])
  const progress = ref<FlashProgress | null>(null)
  const chipInfo = ref<ChipInfo | null>(null)
  const errorMessage = ref('')
  const isWebSerialSupported = ref(false)
  const isLinux = ref(false)

  // Multi-board state
  const boards = ref<BoardEntry[]>([])
  const selectedBoard = ref<BoardEntry | null>(null)
  const nvsOffset = ref('0x9000')

  // WiFi form state (pre-filled from server)
  const wifiSsid = ref('')
  const wifiPassword = ref('')
  const serverUrl = ref('')

  // Custom firmware file (advanced users)
  const customFirmware = ref<File | null>(null)

  // esptool-js instances (kept as raw refs to avoid Vue reactivity on classes)
  let transport: any = null
  let loader: any = null

  // --- Logging ---
  function log(level: FlashLogEntry['level'], message: string) {
    logs.value.push({ timestamp: Date.now(), level, message })
  }

  // --- Feature detection ---
  function checkSupport() {
    if (import.meta.client) {
      isWebSerialSupported.value = 'serial' in navigator
      isLinux.value = navigator.userAgent.includes('Linux') && !navigator.userAgent.includes('Android')
    }
  }

  // --- Load WiFi config from server ---
  async function loadConfig() {
    try {
      const config = await $fetch<{ ssid: string; password: string; serverUrl: string }>('/api/firmware/config')
      wifiSsid.value = config.ssid
      wifiPassword.value = config.password
      serverUrl.value = config.serverUrl
    } catch {
      log('warn', 'Could not load WiFi config from server')
    }
  }

  // --- Load boards manifest and filter by chip ---
  async function loadBoards(chipFamily: string) {
    try {
      const data = await $fetch<BoardsManifest>('/api/firmware/boards')
      nvsOffset.value = data.nvsOffset
      boards.value = data.boards.filter(b => chipFamily.startsWith(b.chipFamily))

      if (boards.value.length === 0) {
        log('warn', `No boards available for ${chipFamily}`)
      } else if (boards.value.length === 1) {
        selectBoard(boards.value[0]!)
      } else {
        log('info', `Found ${boards.value.length} boards for ${chipFamily}`)
      }
    } catch {
      boards.value = []
      log('warn', 'Could not load boards manifest from server')
    }
  }

  // --- Select a board ---
  function selectBoard(board: BoardEntry) {
    selectedBoard.value = board
    log('success', `Selected board: ${board.name}`)
    step.value = 'connected'
  }

  // --- Connect to device ---
  async function connect() {
    if (!isWebSerialSupported.value) {
      errorMessage.value = 'Web Serial API is not available. Access this page via HTTPS or localhost.'
      step.value = 'error'
      return
    }

    step.value = 'connecting'
    log('info', 'Requesting serial port...')

    try {
      // Request port with Espressif USB VID filter (0x303A)
      const port = await navigator.serial.requestPort({
        filters: [{ usbVendorId: 0x303A }],
      })

      log('info', 'Port selected, initializing transport...')

      // Dynamic import — esptool-js is browser-only
      const { ESPLoader, Transport } = await import('esptool-js')

      transport = new Transport(port, false)

      const terminal = {
        clean: () => {},
        writeLine: (data: string) => {
          const trimmed = data.trim()
          if (trimmed && !trimmed.startsWith('...')) {
            log('info', trimmed)
          }
        },
        write: (_data: string) => {},
      }

      loader = new ESPLoader({
        transport,
        baudrate: 115200,
        terminal,
      })

      log('info', 'Connecting to bootloader...')
      const chip = await loader.main('default_reset')
      log('success', `Connected: ${chip}`)

      const mac = await loader.chip.readMac(loader)
      const desc = await loader.chip.getChipDescription(loader)
      const features = await loader.chip.getChipFeatures(loader)

      chipInfo.value = {
        chipName: chip,
        mac,
        description: desc,
        features,
      }

      log('success', `Chip: ${desc}`)
      log('info', `MAC: ${mac}`)
      log('info', `Features: ${features.join(', ')}`)

      await Promise.all([loadConfig(), loadBoards(chip)])

      // If loadBoards auto-selected a single board, step is already 'connected'.
      // Otherwise, let the user pick.
      if (!selectedBoard.value) {
        step.value = 'board-select'
      }
    } catch (err: any) {
      if (err.name === 'NotFoundError') {
        step.value = 'idle'
        log('info', 'Port selection cancelled')
        return
      }
      const msg = err.message || String(err)
      if (msg.includes('already open') || msg.includes('busy')) {
        errorMessage.value = 'Port is busy. Close any serial monitors (idf.py monitor) and try again.'
      } else if (msg.includes('denied') || msg.includes('permission')) {
        errorMessage.value = 'Permission denied. On Linux, run: sudo chmod 666 /dev/ttyACM0'
      } else {
        errorMessage.value = `Connection failed: ${msg}. Make sure the device is powered on.`
      }
      step.value = 'error'
      log('error', errorMessage.value)
    }
  }

  // --- Flash firmware ---
  async function flash() {
    if (!loader) return

    step.value = 'flashing'

    try {
      const fileArray: { data: Uint8Array; address: number }[] = []
      const partNames: string[] = []

      if (customFirmware.value) {
        log('info', 'Reading custom firmware file...')
        const data = new Uint8Array(await customFirmware.value.arrayBuffer())
        fileArray.push({ data, address: 0x20000 })
        partNames.push('custom firmware')
        log('info', `Custom firmware: ${(data.length / 1024).toFixed(0)} KB`)
      } else if (selectedBoard.value) {
        // Download per-board parts (bootloader, partition table, OTA data, app)
        const board = selectedBoard.value
        const boardParts = [
          { name: 'bootloader', ...board.bootloader },
          { name: 'partition-table', ...board.partitionTable },
          { name: 'ota-data', ...board.otaData },
          { name: 'firmware', ...board.app },
        ]

        for (const part of boardParts) {
          log('info', `Downloading ${part.name}...`)
          const response = await fetch(`/api/firmware/download/${part.path}`)
          if (!response.ok) throw new Error(`Failed to download ${part.name}: ${response.statusText}`)
          const data = new Uint8Array(await response.arrayBuffer())
          fileArray.push({ data, address: parseInt(part.offset, 16) })
          partNames.push(part.name)
          log('success', `${part.name}: ${(data.length / 1024).toFixed(0)} KB`)
        }

        log('info', `Board: ${board.name} (v${board.version})`)

        // Generate NVS partition with WiFi config
        log('info', 'Generating NVS partition with WiFi config...')
        const nvsResponse = await fetch('/api/firmware/nvs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ssid: wifiSsid.value,
            password: wifiPassword.value,
            otaUrl: `${serverUrl.value}/xiaozhi/ota/`,
          }),
        })
        if (!nvsResponse.ok) throw new Error('Failed to generate NVS partition')
        const nvsData = new Uint8Array(await nvsResponse.arrayBuffer())
        fileArray.push({ data: nvsData, address: parseInt(nvsOffset.value, 16) })
        partNames.push('nvs')
        log('success', `NVS partition: ${(nvsData.length / 1024).toFixed(0)} KB (WiFi: ${wifiSsid.value})`)
      } else {
        errorMessage.value = 'No board selected. Upload a custom firmware or select a board first.'
        step.value = 'error'
        return
      }

      fileArray.sort((a, b) => a.address - b.address)

      log('info', `Flashing ${fileArray.length} partitions...`)

      await loader.writeFlash({
        fileArray,
        flashMode: 'dio',
        flashFreq: '80m',
        flashSize: '16MB',
        eraseAll: false,
        compress: true,
        reportProgress: (fileIndex: number, written: number, total: number) => {
          const name = partNames[fileIndex] || `part ${fileIndex}`
          const pct = total > 0 ? Math.round((written / total) * 100) : 0
          progress.value = {
            partName: name,
            partIndex: fileIndex,
            totalParts: fileArray.length,
            written,
            total,
            percent: pct,
          }
          if (pct % 25 === 0 && pct > 0 && written < total) {
            log('info', `Writing ${name}... ${pct}%`)
          }
          if (written >= total) {
            log('success', `${name} written (${(total / 1024).toFixed(0)} KB)`)
          }
        },
      })

      log('success', 'All partitions written successfully!')
      log('info', 'Rebooting device...')

      // ESP32-S3 native USB has no external EN reset circuit — hard_reset via RTS
      // doesn't work. Use software reset through the stub loader instead.
      try {
        await loader.softReset(false)
      } catch {
        // If soft reset fails, try hard reset as fallback
        try { await loader.after('hard_reset') } catch { /* ignore */ }
      }
      await disconnect()

      log('success', 'Device rebooting. Waiting for WiFi connection...')

      step.value = 'complete'
    } catch (err: any) {
      errorMessage.value = `Flash failed: ${err.message || err}. Do not unplug the device.`
      step.value = 'error'
      log('error', errorMessage.value)
    }
  }

  async function disconnect() {
    try {
      if (transport) {
        await transport.disconnect()
        transport = null
        loader = null
      }
    } catch {
      // Ignore disconnect errors
    }
  }

  function reset() {
    step.value = 'idle'
    logs.value = []
    progress.value = null
    chipInfo.value = null
    errorMessage.value = ''
    customFirmware.value = null
    selectedBoard.value = null
    boards.value = []
    disconnect()
  }

  function retry() {
    errorMessage.value = ''
    step.value = 'idle'
  }

  onMounted(() => {
    checkSupport()
  })

  onUnmounted(() => {
    disconnect()
  })

  return {
    step: readonly(step),
    logs: readonly(logs),
    progress: readonly(progress),
    chipInfo: readonly(chipInfo),
    errorMessage: readonly(errorMessage),
    boards: readonly(boards),
    selectedBoard: readonly(selectedBoard),
    isWebSerialSupported: readonly(isWebSerialSupported),
    isLinux: readonly(isLinux),
    wifiSsid,
    wifiPassword,
    serverUrl,
    customFirmware,
    connect,
    flash,
    selectBoard,
    reset,
    retry,
  }
}
