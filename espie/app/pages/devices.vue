<script setup lang="ts">
import type { ConnectedDevice } from '~/composables/useDevices'

const { devices } = useDevices()

// Table column definitions
const columns = [
  { id: 'deviceId', accessorKey: 'deviceId', header: 'Device ID' },
  { id: 'state', accessorKey: 'state', header: 'Status' },
  { id: 'connectedAt', accessorKey: 'connectedAt', header: 'Connected Since' },
  { id: 'sessionId', accessorKey: 'sessionId', header: 'Session' },
  { id: 'firmwareVersion', accessorKey: 'firmwareVersion', header: 'Firmware' },
  { id: 'actions', header: 'Actions' },
]

const rebooting = ref<Set<string>>(new Set())

async function rebootDevice(deviceId: string) {
  rebooting.value.add(deviceId)
  try {
    await $fetch('/api/devices/reboot', { method: 'POST', body: { deviceId } })
  } catch (err: any) {
    console.error('Reboot failed:', err)
  } finally {
    setTimeout(() => rebooting.value.delete(deviceId), 5000)
  }
}

// Badge color mapping for device states
function stateColor(state: string): string {
  switch (state) {
    case 'idle':
      return 'success'
    case 'listening':
    case 'processing':
    case 'speaking':
      return 'info'
    default:
      return 'neutral'
  }
}

// Format timestamp as relative time
function formatTime(ts: number): string {
  const diff = Date.now() - ts
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return new Date(ts).toLocaleString()
}

// Truncate session ID for display
function truncateId(id: string): string {
  if (id.length <= 12) return id
  return id.slice(0, 8) + '...'
}
</script>

<template>
  <div class="max-w-3xl p-6">
    <!-- Flash wizard card -->
    <FlashWizard />

    <!-- Empty state -->
    <div v-if="devices.length === 0" class="flex flex-col items-center justify-center py-16 text-neutral-500">
      <UIcon name="i-lucide-cpu" class="size-12 mb-4" />
      <p class="text-lg font-medium">No devices connected</p>
      <p class="text-sm mt-1">ESP32 devices will appear here when they connect via WebSocket.</p>
    </div>

    <!-- Device table -->
    <UTable v-else :data="devices" :columns="columns" class="w-full">
      <template #deviceId-cell="{ row }">
        <span class="font-mono text-sm">{{ row.original.deviceId }}</span>
      </template>

      <template #state-cell="{ row }">
        <UBadge :color="stateColor(row.original.state)" variant="subtle">
          {{ row.original.state }}
        </UBadge>
      </template>

      <template #connectedAt-cell="{ row }">
        <span class="text-sm" :title="new Date(row.original.connectedAt).toISOString()">
          {{ formatTime(row.original.connectedAt) }}
        </span>
      </template>

      <template #sessionId-cell="{ row }">
        <span class="font-mono text-sm text-neutral-500" :title="row.original.sessionId">
          {{ truncateId(row.original.sessionId) }}
        </span>
      </template>

      <template #firmwareVersion-cell="{ row }">
        <span class="text-sm">{{ row.original.firmwareVersion || 'N/A' }}</span>
      </template>

      <template #actions-cell="{ row }">
        <UButton
          icon="i-lucide-rotate-cw"
          size="xs"
          color="warning"
          variant="soft"
          :loading="rebooting.has(row.original.deviceId)"
          @click="rebootDevice(row.original.deviceId)"
        >
          Reboot
        </UButton>
      </template>
    </UTable>
  </div>
</template>
