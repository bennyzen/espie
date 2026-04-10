// SSE composable for streaming server logs from /api/logs.
// Supports optional level filtering and maintains a capped log buffer.

import type { Ref } from 'vue'

export interface LogEntry {
  timestamp: number
  level: 'info' | 'warn' | 'error'
  message: string
}

export function useLogs(levelFilter?: Ref<string | undefined>) {
  const logs = ref<LogEntry[]>([])
  const maxLogs = 1000
  let eventSource: EventSource | null = null

  function connect() {
    eventSource?.close()
    const base = '/api/logs'
    const url = levelFilter?.value ? `${base}?level=${levelFilter.value}` : base
    eventSource = new EventSource(url)
    eventSource.onmessage = (event) => {
      try {
        const entry = JSON.parse(event.data) as LogEntry
        logs.value.push(entry)
        if (logs.value.length > maxLogs) {
          logs.value.shift()
        }
      } catch {
        // Ignore malformed SSE data
      }
    }
  }

  onMounted(() => connect())

  // Reconnect when filter changes
  if (levelFilter) {
    watch(levelFilter, () => {
      logs.value = []
      connect()
    })
  }

  function clear() {
    logs.value = []
  }

  onUnmounted(() => {
    eventSource?.close()
  })

  return { logs, clear }
}
