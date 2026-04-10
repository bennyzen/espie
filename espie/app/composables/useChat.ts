import type { UIMessage, ChatStatus } from 'ai'

interface ServerMessage {
  type: 'ready' | 'text_delta' | 'text_done' | 'tool_start' | 'tool_end' | 'turn_end' | 'error' | 'broadcast'
  sessionId?: string
  delta?: string
  fullText?: string
  toolName?: string
  toolInput?: unknown
  toolOutput?: unknown
  musicUrl?: string
  message?: string
  // Broadcast fields (real-time messages from voice/scheduler)
  id?: string
  role?: string
  content?: string
  sessionType?: string
  createdAt?: number
}

interface HistoryMessage {
  id: string
  session_id: string
  role: string
  content: string
  created_at: number
  session_type: string
  device_id: string
}

export interface MessageMeta {
  sessionType: string
  createdAt: number
}

export function useChat() {
  const messages = ref<UIMessage[]>([])
  const messageMeta = ref<Map<string, MessageMeta>>(new Map())
  const input = ref('')
  const status = ref<ChatStatus>('ready')
  const isConnected = ref(false)
  const sessionId = ref<string | null>(null)
  const historyLoaded = ref(false)

  // Build WebSocket URL (relative path, auto-resolves protocol)
  const wsUrl = computed(() => {
    if (import.meta.server) return ''
    const loc = window.location
    const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${loc.host}/api/chat`
  })

  let ws: WebSocket | null = null
  let reconnectAttempts = 0
  const maxReconnectAttempts = 3
  const reconnectDelay = 1000
  let audioEl: HTMLAudioElement | null = null

  function playMusic(url: string) {
    if (audioEl) {
      audioEl.pause()
      audioEl = null
    }
    audioEl = new Audio(url)
    audioEl.play().catch(() => {})
  }

  function stopMusic() {
    if (audioEl) {
      audioEl.pause()
      audioEl = null
    }
  }

  /** Load chat history from DB on mount */
  async function loadHistory() {
    try {
      const rows = await $fetch<HistoryMessage[]>('/api/chat/history', {
        params: { limit: 100 },
      })
      if (rows.length === 0) return

      const historyMessages: UIMessage[] = rows.map((row) => {
        messageMeta.value.set(row.id, {
          sessionType: row.session_type,
          createdAt: row.created_at,
        })
        return {
          id: row.id,
          role: row.role === 'user' ? 'user' as const : 'assistant' as const,
          parts: [{ type: 'text' as const, text: row.content }],
        }
      })

      // Prepend history before any live messages
      messages.value = [...historyMessages, ...messages.value]
    } catch (err) {
      console.warn('[chat] Failed to load history:', err)
    } finally {
      historyLoaded.value = true
    }
  }

  function connect() {
    if (import.meta.server || !wsUrl.value) return

    ws = new WebSocket(wsUrl.value)

    ws.onopen = () => {
      isConnected.value = true
      reconnectAttempts = 0
    }

    ws.onclose = () => {
      isConnected.value = false
      status.value = 'ready'
      ws = null

      // Auto-reconnect
      if (reconnectAttempts < maxReconnectAttempts) {
        reconnectAttempts++
        setTimeout(connect, reconnectDelay * reconnectAttempts)
      }
    }

    ws.onerror = () => {
      // onclose will fire after onerror
    }

    ws.onmessage = (event) => {
      try {
        const msg: ServerMessage = JSON.parse(event.data)
        handleServerMessage(msg)
      } catch {
        // Ignore non-JSON messages
      }
    }
  }

  function handleServerMessage(msg: ServerMessage) {
    switch (msg.type) {
      case 'ready':
        sessionId.value = msg.sessionId ?? null
        break

      case 'text_delta': {
        const last = messages.value[messages.value.length - 1]
        if (last?.role === 'assistant') {
          const textPart = last.parts.find((p) => p.type === 'text')
          if (textPart && 'text' in textPart) {
            ;(textPart as { type: 'text'; text: string }).text += msg.delta
          }
        }
        status.value = 'streaming'
        // Force reactivity
        messages.value = [...messages.value]
        break
      }

      case 'text_done':
        // Mark text parts as done
        status.value = 'ready'
        break

      case 'tool_start': {
        const last = messages.value[messages.value.length - 1]
        if (last?.role === 'assistant') {
          last.parts.push({
            type: 'dynamic-tool',
            toolCallId: crypto.randomUUID(),
            toolName: msg.toolName ?? 'unknown',
            input: msg.toolInput,
            state: 'input-available',
          } as any)
          messages.value = [...messages.value]
        }
        break
      }

      case 'tool_end': {
        const last = messages.value[messages.value.length - 1]
        if (last?.role === 'assistant') {
          // Find the most recent tool part matching this tool name
          const toolPart = [...last.parts].reverse().find(
            (p: any) => p.type === 'dynamic-tool' && p.toolName === msg.toolName
          ) as any
          if (toolPart) {
            toolPart.state = 'output-available'
            toolPart.output = msg.toolOutput
            if (msg.musicUrl) toolPart.musicUrl = msg.musicUrl
            messages.value = [...messages.value]
          }
        }
        // Play music in browser when play_music tool completes
        if (msg.musicUrl) {
          playMusic(msg.musicUrl)
        }
        break
      }

      case 'turn_end':
        status.value = 'ready'
        break

      case 'broadcast': {
        // Real-time message from voice pipeline or scheduler
        if (msg.id && msg.content) {
          if (msg.sessionType && msg.createdAt) {
            messageMeta.value.set(msg.id, { sessionType: msg.sessionType, createdAt: msg.createdAt })
          }
          messages.value.push({
            id: msg.id,
            role: msg.role === 'user' ? 'user' as const : 'assistant' as const,
            parts: [{ type: 'text' as const, text: msg.content }],
          })
          messages.value = [...messages.value]
        }
        break
      }

      case 'error':
        status.value = 'error'
        break
    }
  }

  function submit() {
    const text = input.value.trim()
    if (!text || !isConnected.value || !ws) return

    // Add user message
    messages.value.push({
      id: crypto.randomUUID(),
      role: 'user',
      parts: [{ type: 'text', text }],
    })

    // Add empty assistant message for streaming into
    messages.value.push({
      id: crypto.randomUUID(),
      role: 'assistant',
      parts: [{ type: 'text', text: '' }],
    })

    status.value = 'submitted'
    ws.send(JSON.stringify({ type: 'prompt', text }))
    input.value = ''
  }

  function interrupt() {
    if (ws && isConnected.value) {
      ws.send(JSON.stringify({ type: 'interrupt' }))
    }
  }

  function clearMessages() {
    messages.value = []
  }

  // Connect on mount (client-side only)
  onMounted(() => {
    loadHistory()
    connect()
  })

  // Disconnect on unmount
  onUnmounted(() => {
    if (ws) {
      ws.close()
      ws = null
    }
    stopMusic()
  })

  return {
    messages,
    messageMeta,
    input,
    status,
    isConnected,
    sessionId,
    historyLoaded,
    submit,
    interrupt,
    clearMessages,
    stopMusic,
  }
}
