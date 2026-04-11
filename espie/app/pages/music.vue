<script setup lang="ts">
interface MusicFile {
  filename: string
  title: string
  artist: string
  videoId: string | null
  size: number
  createdAt: number
}

const toast = useToast()
const { data: files, refresh } = await useFetch<MusicFile[]>('/api/music')

const playing = ref<string | null>(null)
const currentTime = ref(0)
const duration = ref(0)
let audioEl: HTMLAudioElement | null = null

function bindAudio(audio: HTMLAudioElement) {
  audio.addEventListener('timeupdate', () => { currentTime.value = audio.currentTime })
  audio.addEventListener('loadedmetadata', () => { duration.value = audio.duration })
  audio.addEventListener('ended', () => { playing.value = null; currentTime.value = 0; duration.value = 0 })
}

function play(filename: string) {
  if (audioEl) {
    audioEl.pause()
    audioEl = null
  }
  if (playing.value === filename) {
    playing.value = null
    currentTime.value = 0
    duration.value = 0
    return
  }
  playing.value = filename
  currentTime.value = 0
  duration.value = 0
  audioEl = new Audio(`/api/music/${encodeURIComponent(filename)}`)
  bindAudio(audioEl)
  audioEl.play().catch(() => {})
}

function seek(event: MouseEvent) {
  if (!audioEl || !duration.value) return
  const bar = event.currentTarget as HTMLElement
  const ratio = event.offsetX / bar.clientWidth
  audioEl.currentTime = ratio * duration.value
}

function stop() {
  if (audioEl) {
    audioEl.pause()
    audioEl = null
  }
  playing.value = null
  currentTime.value = 0
  duration.value = 0
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

const progress = computed(() => duration.value ? (currentTime.value / duration.value) * 100 : 0)

const deleteTarget = ref<MusicFile | null>(null)
const deleteOpen = computed({
  get: () => deleteTarget.value !== null,
  set: (v) => { if (!v) deleteTarget.value = null },
})

async function confirmDelete() {
  const file = deleteTarget.value
  if (!file) return
  if (playing.value === file.filename) stop()
  try {
    await $fetch(`/api/music/${encodeURIComponent(file.filename)}`, { method: 'DELETE' })
    toast.add({ title: 'Deleted', color: 'success' })
    refresh()
  } catch (err) {
    toast.add({ title: 'Failed to delete', color: 'error', description: String(err) })
  }
  deleteTarget.value = null
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

const totalSize = computed(() => (files.value || []).reduce((sum, f) => sum + f.size, 0))

onUnmounted(() => stop())
</script>

<template>
  <div class="max-w-3xl p-6 space-y-4">
    <div class="flex items-center justify-between">
      <p class="text-sm text-neutral-400">
        {{ files?.length || 0 }} songs &middot; {{ formatSize(totalSize) }}
      </p>
      <UButton v-if="playing" icon="i-lucide-square" size="xs" color="neutral" variant="ghost" label="Stop" @click="stop" />
    </div>

    <div v-if="!files?.length" class="text-center py-12 text-neutral-500">
      <UIcon name="i-lucide-music" class="size-12 mx-auto mb-3" />
      <p>No downloaded music yet.</p>
      <p class="text-sm">Ask Espie to play a song in the chat.</p>
    </div>

    <div v-else class="space-y-1">
      <div
        v-for="file in files"
        :key="file.filename"
        class="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition group"
      >
        <UButton
          :icon="playing === file.filename ? 'i-lucide-pause' : 'i-lucide-play'"
          size="xs"
          color="primary"
          variant="soft"
          @click="play(file.filename)"
        />
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium truncate">{{ file.title }}</p>
          <p v-if="playing !== file.filename" class="text-xs text-neutral-400 truncate">{{ file.artist }}</p>
          <div v-else class="flex items-center gap-2 mt-1">
            <div class="flex-1 h-1 rounded-full bg-neutral-200 dark:bg-neutral-700 cursor-pointer" @click="seek">
              <div class="h-full rounded-full bg-primary transition-all" :style="{ width: `${progress}%` }" />
            </div>
            <span class="text-xs text-neutral-400 tabular-nums shrink-0">{{ formatTime(currentTime) }} / {{ formatTime(duration) }}</span>
          </div>
        </div>
        <span class="text-xs text-neutral-400 shrink-0">{{ formatSize(file.size) }}</span>
        <span class="text-xs text-neutral-400 shrink-0 hidden sm:inline">{{ formatDate(file.createdAt) }}</span>
        <a
          :href="`/api/music/${encodeURIComponent(file.filename)}`"
          :download="file.filename"
          class="opacity-0 group-hover:opacity-100 transition"
        >
          <UButton
            icon="i-lucide-download"
            size="xs"
            color="neutral"
            variant="ghost"
            tabindex="-1"
          />
        </a>
        <UButton
          icon="i-lucide-trash-2"
          size="xs"
          color="error"
          variant="ghost"
          class="opacity-0 group-hover:opacity-100 transition"
          @click="deleteTarget = file"
        />
      </div>
    </div>

    <UModal v-model:open="deleteOpen" :ui="{ width: 'sm:max-w-sm' }">
      <template #content>
        <div class="p-6 space-y-4">
          <p class="text-sm">Delete <strong>{{ deleteTarget?.title }}</strong> by {{ deleteTarget?.artist }}?</p>
          <div class="flex justify-end gap-2">
            <UButton label="Cancel" color="neutral" variant="ghost" @click="deleteTarget = null" />
            <UButton label="Delete" color="error" @click="confirmDelete" />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
