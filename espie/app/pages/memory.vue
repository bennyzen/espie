<script setup lang="ts">
interface MemoryFact {
  id: string
  content: string
  source_message_id: string | null
  created_at: number
  last_accessed_at: number | null
  access_count: number
}

interface MemoryResponse {
  facts: MemoryFact[]
  total: number
  page: number
  limit: number
}

const page = ref(1)
const limit = 50
const search = ref('')
const debouncedSearch = ref('')

// Debounce search input
let searchTimeout: ReturnType<typeof setTimeout> | null = null
watch(search, (val) => {
  if (searchTimeout) clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => {
    debouncedSearch.value = val
    page.value = 1
  }, 300)
})

const { data, status: fetchStatus } = useFetch<MemoryResponse>('/api/memory', {
  query: { page, limit, q: debouncedSearch },
  watch: [page, debouncedSearch],
})

const totalPages = computed(() => {
  if (!data.value) return 1
  return Math.ceil(data.value.total / limit) || 1
})

function formatDate(ts: number | null): string {
  if (!ts) return 'Never'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(ts))
}

const editingId = ref<string | null>(null)
const editContent = ref('')

function startEdit(fact: MemoryFact) {
  editingId.value = fact.id
  editContent.value = fact.content
}

function cancelEdit() {
  editingId.value = null
  editContent.value = ''
}

async function saveEdit(id: string) {
  if (!editContent.value.trim()) return
  await $fetch(`/api/memory/${id}`, { method: 'PUT', body: { content: editContent.value.trim() } })
  editingId.value = null
  editContent.value = ''
  refreshNuxtData()
}

async function deleteMemory(id: string) {
  await $fetch(`/api/memory/${id}`, { method: 'DELETE' })
  refreshNuxtData()
}

const columns = [
  { id: 'content', accessorKey: 'content', header: 'Memory' },
  { id: 'created_at', accessorKey: 'created_at', header: 'Created' },
  { id: 'last_accessed_at', accessorKey: 'last_accessed_at', header: 'Last Accessed' },
  { id: 'access_count', accessorKey: 'access_count', header: 'Accesses' },
  { id: 'actions', header: '' },
]
</script>

<template>
  <div class="max-w-3xl p-6 space-y-4">
    <!-- Search bar -->
    <div class="flex items-center gap-3">
      <UInput
        v-model="search"
        icon="i-lucide-search"
        placeholder="Search memories..."
        class="w-80"
      />
      <span v-if="data" class="text-sm text-neutral-400">
        {{ data.total }} {{ data.total === 1 ? 'memory' : 'memories' }}
      </span>
    </div>

    <!-- Loading state -->
    <div v-if="fetchStatus === 'pending'" class="flex justify-center py-12">
      <UIcon name="i-lucide-loader" class="size-6 animate-spin text-neutral-400" />
    </div>

    <!-- Empty state -->
    <div v-else-if="!data?.facts?.length" class="flex flex-col items-center justify-center py-16 text-neutral-400 dark:text-neutral-500 gap-4">
      <UIcon name="i-lucide-brain" class="size-16" />
      <p class="text-lg font-medium">No memories stored yet</p>
      <p class="text-sm text-center max-w-md">
        The assistant will begin storing memories in a future update. Facts learned during conversations will appear here.
      </p>
    </div>

    <!-- Memory table -->
    <div v-else class="space-y-4">
      <UTable :data="data.facts" :columns="columns" class="w-full">
        <template #content-cell="{ row }">
          <div v-if="editingId === row.original.id" class="flex items-center gap-2 max-w-xl">
            <UTextarea v-model="editContent" autoresize class="flex-1" size="sm" @keydown.enter.meta="saveEdit(row.original.id)" @keydown.escape="cancelEdit" />
            <UButton icon="i-lucide-check" color="primary" variant="ghost" size="xs" @click="saveEdit(row.original.id)" />
            <UButton icon="i-lucide-x" color="neutral" variant="ghost" size="xs" @click="cancelEdit" />
          </div>
          <p v-else class="text-sm whitespace-pre-wrap max-w-xl cursor-pointer hover:text-primary" @click="startEdit(row.original)">{{ row.original.content }}</p>
        </template>

        <template #created_at-cell="{ row }">
          <span class="text-sm text-neutral-500 whitespace-nowrap">{{ formatDate(row.original.created_at) }}</span>
        </template>

        <template #last_accessed_at-cell="{ row }">
          <span class="text-sm text-neutral-500 whitespace-nowrap">{{ formatDate(row.original.last_accessed_at) }}</span>
        </template>

        <template #access_count-cell="{ row }">
          <span class="text-sm">{{ row.original.access_count }}</span>
        </template>

        <template #actions-cell="{ row }">
          <UButton icon="i-lucide-trash-2" color="error" variant="ghost" size="xs" @click="deleteMemory(row.original.id)" />
        </template>
      </UTable>

      <!-- Pagination -->
      <div v-if="totalPages > 1" class="flex justify-center">
        <UPagination v-model="page" :total="data?.total || 0" :items-per-page="limit" />
      </div>
    </div>
  </div>
</template>
