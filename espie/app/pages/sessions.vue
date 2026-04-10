<script setup lang="ts">
interface Session {
  id: string
  device_id: string
  client_id: string
  started_at: number
  ended_at: number | null
  summary: string | null
  type: string
  message_count: number
  first_message: string | null
}

interface SessionsResponse {
  sessions: Session[]
  total: number
  page: number
  limit: number
}

const page = ref(1)
const limit = 20
const typeFilter = ref<string | undefined>(undefined)
const searchQuery = ref('')

const { data, status: fetchStatus } = useFetch<SessionsResponse>('/api/sessions', {
  query: { page, limit, type: typeFilter },
  watch: [page, typeFilter],
})

const filteredSessions = computed(() => {
  if (!data.value?.sessions) return []
  if (!searchQuery.value.trim()) return data.value.sessions

  const q = searchQuery.value.toLowerCase()
  return data.value.sessions.filter((s) => {
    const preview = s.first_message || s.summary || ''
    return preview.toLowerCase().includes(q)
  })
})

const totalPages = computed(() => {
  if (!data.value) return 1
  return Math.ceil(data.value.total / limit) || 1
})

function setTypeFilter(type: string | undefined) {
  typeFilter.value = type
  page.value = 1
}

function formatDate(ts: number): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(ts))
}

function formatDuration(startedAt: number, endedAt: number | null): string {
  if (!endedAt) return 'Active'
  const seconds = Math.floor((endedAt - startedAt) / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return `${hours}h ${remainingMinutes}m`
}

function truncate(text: string | null, maxLen: number): string {
  if (!text) return ''
  return text.length > maxLen ? text.slice(0, maxLen) + '...' : text
}

function goToSession(session: Session) {
  navigateTo(`/sessions/${session.id}`)
}

const columns = [
  { id: 'started_at', accessorKey: 'started_at', header: 'Date' },
  { id: 'type', accessorKey: 'type', header: 'Type' },
  { id: 'duration', accessorKey: 'started_at', header: 'Duration' },
  { id: 'message_count', accessorKey: 'message_count', header: 'Messages' },
  { id: 'first_message', accessorKey: 'first_message', header: 'Preview' },
]
</script>

<template>
  <div class="max-w-3xl p-6 space-y-4">
    <!-- Header controls -->
    <div class="flex flex-wrap items-center gap-3">
      <UInput
        v-model="searchQuery"
        icon="i-lucide-search"
        placeholder="Search sessions..."
        class="w-64"
      />

      <div class="flex items-center gap-1">
        <UButton
          :variant="typeFilter === undefined ? 'solid' : 'ghost'"
          :color="typeFilter === undefined ? 'primary' : 'neutral'"
          size="sm"
          label="All"
          @click="setTypeFilter(undefined)"
        />
        <UButton
          :variant="typeFilter === 'voice' ? 'solid' : 'ghost'"
          :color="typeFilter === 'voice' ? 'primary' : 'neutral'"
          size="sm"
          label="Voice"
          icon="i-lucide-mic"
          @click="setTypeFilter('voice')"
        />
        <UButton
          :variant="typeFilter === 'web' ? 'solid' : 'ghost'"
          :color="typeFilter === 'web' ? 'primary' : 'neutral'"
          size="sm"
          label="Web"
          icon="i-lucide-globe"
          @click="setTypeFilter('web')"
        />
      </div>
    </div>

    <!-- Loading state -->
    <div v-if="fetchStatus === 'pending'" class="flex justify-center py-12">
      <UIcon name="i-lucide-loader" class="size-6 animate-spin text-neutral-400" />
    </div>

    <!-- Empty state -->
    <div v-else-if="filteredSessions.length === 0" class="flex flex-col items-center justify-center py-16 text-neutral-400 dark:text-neutral-500 gap-3">
      <UIcon name="i-lucide-history" class="size-12" />
      <p class="text-lg">No sessions found</p>
      <p class="text-sm">Conversations will appear here once you start chatting.</p>
    </div>

    <!-- Session table -->
    <div v-else class="space-y-4">
      <UTable :data="filteredSessions" :columns="columns" class="w-full">
        <template #started_at-cell="{ row }">
          <span class="text-sm whitespace-nowrap">{{ formatDate(row.original.started_at) }}</span>
        </template>

        <template #type-cell="{ row }">
          <UBadge
            :color="row.original.type === 'voice' ? 'purple' : 'green'"
            variant="subtle"
            size="sm"
          >
            <UIcon :name="row.original.type === 'voice' ? 'i-lucide-mic' : 'i-lucide-globe'" class="size-3 mr-1" />
            {{ row.original.type || 'web' }}
          </UBadge>
        </template>

        <template #duration-cell="{ row }">
          <span class="text-sm text-neutral-500">
            {{ formatDuration(row.original.started_at, row.original.ended_at) }}
          </span>
        </template>

        <template #message_count-cell="{ row }">
          <span class="text-sm">{{ row.original.message_count }}</span>
        </template>

        <template #first_message-cell="{ row }">
          <button
            class="text-sm text-left text-neutral-600 dark:text-neutral-300 hover:text-primary-500 dark:hover:text-primary-400 cursor-pointer truncate max-w-xs"
            @click="goToSession(row.original)"
          >
            {{ truncate(row.original.first_message, 60) || 'No messages' }}
          </button>
        </template>
      </UTable>

      <!-- Pagination -->
      <div v-if="totalPages > 1" class="flex justify-center">
        <UPagination v-model="page" :total="data?.total || 0" :items-per-page="limit" />
      </div>
    </div>
  </div>
</template>
