<script setup lang="ts">
import type { LogEntry } from '~/composables/useLogs'

// Level filter state
const activeLevel = ref<string | undefined>(undefined)

const { logs, clear } = useLogs(activeLevel)

// Auto-scroll to bottom on new entries
const logContainer = ref<HTMLElement | null>(null)

watch(
  () => logs.value.length,
  async () => {
    await nextTick()
    if (logContainer.value) {
      logContainer.value.scrollTop = logContainer.value.scrollHeight
    }
  },
)

// Filter button config
const levels = [
  { label: 'All', value: undefined },
  { label: 'Info', value: 'info' },
  { label: 'Warn', value: 'warn' },
  { label: 'Error', value: 'error' },
]

function setLevel(value: string | undefined) {
  activeLevel.value = value
  // Clear logs when changing filter since SSE reconnects with new filter
  logs.value = []
}

// Badge color mapping for log levels
function levelColor(level: string): string {
  switch (level) {
    case 'info':
      return 'info'
    case 'warn':
      return 'warning'
    case 'error':
      return 'error'
    default:
      return 'neutral'
  }
}

// Format timestamp as HH:MM:SS.mmm
function formatTimestamp(ts: number): string {
  const d = new Date(ts)
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  const s = String(d.getSeconds()).padStart(2, '0')
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  return `${h}:${m}:${s}.${ms}`
}
</script>

<template>
  <div class="max-w-3xl p-6 flex flex-col h-full">
    <!-- Filter bar -->
    <div class="flex items-center gap-2 mb-4">
      <UButton
        v-for="level in levels"
        :key="level.label"
        :label="level.label"
        :variant="activeLevel === level.value ? 'solid' : 'outline'"
        size="sm"
        @click="setLevel(level.value)"
      />

      <div class="flex-1" />

      <UButton label="Clear" variant="ghost" size="sm" icon="i-lucide-trash-2" @click="clear" />
    </div>

    <!-- Log container -->
    <div
      ref="logContainer"
      class="flex-1 min-h-0 overflow-y-auto rounded-lg bg-neutral-900 dark:bg-neutral-950 p-4 space-y-1"
      style="max-height: calc(100vh - 220px)"
    >
      <!-- Empty state -->
      <div v-if="logs.length === 0" class="flex items-center justify-center h-32 text-neutral-500">
        <p>Waiting for log entries...</p>
      </div>

      <!-- Log entries -->
      <div v-for="(entry, i) in logs" :key="i" class="flex items-start gap-3 py-0.5">
        <span class="font-mono text-xs text-neutral-500 shrink-0 tabular-nums">
          {{ formatTimestamp(entry.timestamp) }}
        </span>

        <UBadge :color="levelColor(entry.level)" variant="subtle" size="xs" class="shrink-0 w-12 justify-center uppercase">
          {{ entry.level }}
        </UBadge>

        <span class="font-mono text-sm text-neutral-200 break-all">
          {{ entry.message }}
        </span>
      </div>
    </div>
  </div>
</template>
