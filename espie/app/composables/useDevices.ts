// Composable for real-time device status updates.
// Polls /api/devices every 2 seconds for reliable updates.

export interface ConnectedDevice {
  deviceId: string
  clientId: string
  sessionId: string
  connectedAt: number
  firmwareVersion?: string
  state: string
}

export function useDevices() {
  const devices = ref<ConnectedDevice[]>([])
  let pollTimer: ReturnType<typeof setInterval> | null = null

  async function fetchDevices() {
    try {
      const data = await $fetch<{ devices: ConnectedDevice[] }>('/api/devices')
      devices.value = data.devices
    } catch {
      // Server may not be ready yet
    }
  }

  onMounted(() => {
    fetchDevices()
    pollTimer = setInterval(fetchDevices, 2000)
  })

  onUnmounted(() => {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  })

  return { devices }
}
