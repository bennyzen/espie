<script setup lang="ts">
interface SessionMessage {
  id: string
  session_id: string
  role: 'user' | 'assistant' | 'tool_result' | 'system'
  content: string
  tool_calls: string | null
  created_at: number
}

interface SessionDetail {
  session: {
    id: string
    device_id: string
    client_id: string
    started_at: number
    ended_at: number | null
    type: string
    summary: string | null
  }
  messages: SessionMessage[]
}

const route = useRoute()
const { data, status: fetchStatus } = useFetch<SessionDetail>(`/api/sessions/${route.params.id}`)

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

function formatTime(ts: number): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
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

function parseToolCalls(toolCallsStr: string | null): any[] {
  if (!toolCallsStr) return []
  try {
    const parsed = JSON.parse(toolCallsStr)
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return []
  }
}

function roleLabel(role: string): string {
  switch (role) {
    case 'user': return 'You'
    case 'assistant': return 'Assistant'
    case 'tool_result': return 'Tool'
    case 'system': return 'System'
    default: return role
  }
}
</script>

<template>
  <div class="max-w-3xl p-6 space-y-4">
    <!-- Back button + header -->
    <div class="flex items-center gap-3">
      <UButton
        icon="i-lucide-arrow-left"
        variant="ghost"
        color="neutral"
        size="sm"
        @click="navigateTo('/sessions')"
      />
      <h2 class="text-lg font-semibold">Session Transcript</h2>
    </div>

    <!-- Loading state -->
    <div v-if="fetchStatus === 'pending'" class="flex justify-center py-12">
      <UIcon name="i-lucide-loader" class="size-6 animate-spin text-neutral-400" />
    </div>

    <!-- Not found -->
    <div v-else-if="!data?.session" class="flex flex-col items-center justify-center py-16 text-neutral-400 gap-3">
      <UIcon name="i-lucide-file-x" class="size-12" />
      <p class="text-lg">Session not found</p>
      <UButton label="Back to sessions" variant="soft" @click="navigateTo('/sessions')" />
    </div>

    <!-- Session content -->
    <template v-else>
      <!-- Session metadata header -->
      <div class="flex flex-wrap items-center gap-3 p-4 bg-neutral-50 dark:bg-neutral-900 rounded-lg">
        <UBadge
          :color="data.session.type === 'voice' ? 'purple' : 'green'"
          variant="subtle"
        >
          <UIcon :name="data.session.type === 'voice' ? 'i-lucide-mic' : 'i-lucide-globe'" class="size-3 mr-1" />
          {{ data.session.type || 'web' }}
        </UBadge>
        <span class="text-sm text-neutral-500">{{ formatDate(data.session.started_at) }}</span>
        <span class="text-sm text-neutral-500">
          Duration: {{ formatDuration(data.session.started_at, data.session.ended_at) }}
        </span>
        <span class="text-sm text-neutral-500">
          Device: {{ data.session.device_id }}
        </span>
        <span class="text-sm text-neutral-500">
          {{ data.messages.length }} messages
        </span>
      </div>

      <!-- Summary -->
      <div v-if="data.session.summary" class="p-3 bg-primary-50 dark:bg-primary-900/20 rounded-lg text-sm">
        <strong>Summary:</strong> {{ data.session.summary }}
      </div>

      <!-- Messages -->
      <div v-if="data.messages.length === 0" class="text-center py-8 text-neutral-400">
        No messages in this session.
      </div>

      <div v-else class="space-y-3 max-w-3xl mx-auto">
        <div
          v-for="msg in data.messages"
          :key="msg.id"
          class="flex"
          :class="{
            'justify-end': msg.role === 'user',
            'justify-start': msg.role === 'assistant' || msg.role === 'tool_result',
            'justify-center': msg.role === 'system',
          }"
        >
          <!-- System messages -->
          <div v-if="msg.role === 'system'" class="max-w-lg text-center">
            <p class="text-xs text-neutral-400 italic">{{ msg.content }}</p>
          </div>

          <!-- User messages -->
          <div v-else-if="msg.role === 'user'" class="max-w-[75%]">
            <div class="px-4 py-2 rounded-2xl rounded-br-md bg-primary-500 text-white">
              <p class="text-sm whitespace-pre-wrap">{{ msg.content }}</p>
            </div>
            <p class="text-[10px] text-neutral-400 text-right mt-1">{{ formatTime(msg.created_at) }}</p>
          </div>

          <!-- Assistant messages -->
          <div v-else-if="msg.role === 'assistant'" class="max-w-[75%]">
            <div class="px-4 py-2 rounded-2xl rounded-bl-md bg-neutral-100 dark:bg-neutral-800">
              <p class="text-sm whitespace-pre-wrap">{{ msg.content }}</p>

              <!-- Tool calls (if any) -->
              <div v-for="(tool, idx) in parseToolCalls(msg.tool_calls)" :key="idx" class="mt-2">
                <details class="text-xs">
                  <summary class="cursor-pointer font-mono text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300">
                    Tool: {{ tool.name || tool.toolName || 'unknown' }}
                  </summary>
                  <pre v-if="tool.input || tool.args" class="mt-1 p-2 bg-neutral-200 dark:bg-neutral-700 rounded overflow-x-auto">{{ JSON.stringify(tool.input || tool.args, null, 2) }}</pre>
                  <pre v-if="tool.output || tool.result" class="mt-1 p-2 bg-neutral-200 dark:bg-neutral-700 rounded overflow-x-auto">{{ JSON.stringify(tool.output || tool.result, null, 2) }}</pre>
                </details>
              </div>
            </div>
            <p class="text-[10px] text-neutral-400 mt-1">{{ formatTime(msg.created_at) }}</p>
          </div>

          <!-- Tool result messages -->
          <div v-else-if="msg.role === 'tool_result'" class="max-w-[75%]">
            <div class="px-4 py-2 rounded-lg bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700">
              <p class="text-xs font-mono text-neutral-500 mb-1">{{ roleLabel(msg.role) }}</p>
              <pre class="text-xs overflow-x-auto whitespace-pre-wrap">{{ msg.content }}</pre>
            </div>
            <p class="text-[10px] text-neutral-400 mt-1">{{ formatTime(msg.created_at) }}</p>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
