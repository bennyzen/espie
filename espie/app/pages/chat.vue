<script setup lang="ts">
const { messages, messageMeta, input, status, isConnected, historyLoaded, submit, interrupt, clearMessages, stopMusic } = useChat()

const isStreaming = computed(() => status.value === 'streaming' || status.value === 'submitted')
const scrollContainer = ref<HTMLElement | null>(null)

// Auto-scroll when messages change (covers broadcasts, history load, and live chat)
watch(messages, () => {
  nextTick(() => {
    if (scrollContainer.value) {
      scrollContainer.value.scrollTop = scrollContainer.value.scrollHeight
    }
  })
}, { deep: true })

function getSessionType(message: any): string | null {
  return messageMeta.value.get(message.id)?.sessionType ?? null
}

function formatTime(message: any): string | null {
  const ts = messageMeta.value.get(message.id)?.createdAt
  if (!ts) return null
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- Connection status bar -->
    <div v-if="!isConnected" class="px-4 py-2 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 text-sm text-center flex items-center justify-center gap-2">
      <UIcon name="i-lucide-wifi-off" class="size-4" />
      Connecting to assistant...
    </div>

    <!-- Chat messages area -->
    <div ref="scrollContainer" class="flex-1 overflow-y-auto">
      <div v-if="historyLoaded && messages.length === 0" class="flex flex-col items-center justify-center h-full text-neutral-400 dark:text-neutral-500 gap-3">
        <UIcon name="i-lucide-message-circle" class="size-12" />
        <p class="text-lg">Start a conversation</p>
        <p class="text-sm">Type a message below to chat with the assistant.</p>
      </div>

      <UChatMessages
        v-else
        :messages="messages"
        :status="status"
        :should-auto-scroll="true"
        :user="{ side: 'right', variant: 'soft' }"
        :assistant="{ side: 'left', variant: 'soft', color: 'neutral' }"
      >
        <template #content="{ message }">
          <!-- Session type + timestamp badge for history messages -->
          <div v-if="getSessionType(message)" class="flex items-center gap-1.5 mb-1">
            <UBadge
              v-if="getSessionType(message) === 'scheduler'"
              size="xs"
              color="info"
              variant="subtle"
            >
              <UIcon name="i-lucide-clock" class="size-3 mr-0.5" />
              scheduled
            </UBadge>
            <UBadge
              v-else-if="getSessionType(message) === 'voice'"
              size="xs"
              color="success"
              variant="subtle"
            >
              <UIcon name="i-lucide-mic" class="size-3 mr-0.5" />
              voice
            </UBadge>
            <UBadge
              v-else-if="getSessionType(message) === 'web'"
              size="xs"
              color="neutral"
              variant="subtle"
            >
              <UIcon name="i-lucide-globe" class="size-3 mr-0.5" />
              web
            </UBadge>
            <span class="text-[10px] text-neutral-400">{{ formatTime(message) }}</span>
          </div>

          <template v-for="(part, index) in message.parts" :key="`${message.id}-${part.type}-${index}`">
            <!-- Assistant text rendered as markdown -->
            <MDC v-if="part.type === 'text' && part.text && message.role === 'assistant'" :value="part.text" :cache-key="`${message.id}-${index}`" class="prose prose-sm dark:prose-invert *:first:mt-0 *:last:mb-0" />
            <!-- User text rendered as plain text -->
            <p v-else-if="part.type === 'text' && part.text" class="whitespace-pre-wrap">{{ part.text }}</p>

            <!-- Music player for play_music tool -->
            <div
              v-else-if="part.type === 'dynamic-tool' && part.toolName === 'play_music' && (part as any).musicUrl"
              class="flex items-center gap-3 p-3 rounded-lg bg-neutral-100 dark:bg-neutral-800"
            >
              <UIcon name="i-lucide-music" class="size-5 text-primary shrink-0" />
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium truncate">{{ (part as any).output?.content?.[0]?.text || 'Playing music' }}</p>
                <audio :src="(part as any).musicUrl" controls class="w-full mt-1" />
              </div>
              <UButton icon="i-lucide-square" size="xs" color="neutral" variant="ghost" @click="stopMusic" />
            </div>

            <!-- Generic tool call parts rendered as collapsible blocks -->
            <UChatTool
              v-else-if="part.type === 'dynamic-tool'"
              :text="`${part.toolName}`"
              :suffix="part.state === 'output-available' ? 'Done' : 'Running...'"
              :loading="part.state !== 'output-available'"
              :icon="part.state === 'output-available' ? 'i-lucide-check-circle' : 'i-lucide-loader'"
            >
              <div class="space-y-2 text-xs">
                <div v-if="part.input">
                  <p class="font-semibold text-neutral-500 mb-1">Input:</p>
                  <pre class="p-2 bg-neutral-100 dark:bg-neutral-800 rounded overflow-x-auto">{{ JSON.stringify(part.input, null, 2) }}</pre>
                </div>
                <div v-if="part.output">
                  <p class="font-semibold text-neutral-500 mb-1">Output:</p>
                  <pre class="p-2 bg-neutral-100 dark:bg-neutral-800 rounded overflow-x-auto">{{ JSON.stringify(part.output, null, 2) }}</pre>
                </div>
              </div>
            </UChatTool>
          </template>
        </template>
      </UChatMessages>
    </div>

    <!-- Chat prompt area -->
    <div class="border-t border-neutral-200 dark:border-neutral-800 p-2">
      <div class="flex items-end gap-2">
        <div class="flex-1">
          <UChatPrompt
            v-model="input"
            :disabled="!isConnected"
            placeholder="Type a message..."
            autofocus
            @submit="submit"
          >
            <template #footer>
              <div class="flex items-center justify-between px-2 py-1">
                <div class="flex items-center gap-2 text-xs text-neutral-400">
                  <span v-if="isStreaming" class="flex items-center gap-1">
                    <UIcon name="i-lucide-loader" class="size-3 animate-spin" />
                    Responding...
                  </span>
                </div>
                <div class="flex items-center gap-1">
                  <UButton
                    v-if="isStreaming"
                    icon="i-lucide-square"
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    label="Stop"
                    @click="interrupt"
                  />
                  <UButton
                    v-if="messages.length > 0"
                    icon="i-lucide-trash-2"
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    label="Clear"
                    @click="clearMessages"
                  />
                </div>
              </div>
            </template>
          </UChatPrompt>
        </div>
      </div>
    </div>
  </div>
</template>
