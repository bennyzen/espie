// WebSocket endpoint for browser-based text chat.
// Creates an AgentSession per connection (same agent as voice, text-only transport).
// Streams text deltas, tool calls, and turn completion events to the browser client.
// Path: /api/chat

import { AgentSession } from '../../agent/agent-session'
import { basename } from 'node:path'
import { loadConfig, createApiKeyResolver } from '../../utils/config'
import { buildSystemPrompt } from '../../utils/prompt'
import { createLLM, createEmbeddings } from '../../providers/registry'
import { createSessionTools } from '../../tools/registry'
import { useDatabase } from '../../utils/db'
import { messageBus } from '../../utils/message-bus'
import crypto from 'crypto'

export default defineWebSocketHandler({
  open(peer) {
    const sessionId = crypto.randomUUID()
    const config = loadConfig()
    const model = createLLM(config.llm)

    const session = new AgentSession({
      systemPrompt: buildSystemPrompt({ transport: 'web' }),
      model,
      getApiKey: createApiKeyResolver(),
      label: 'web-chat',
    })

    // Subscribe to agent events and forward as JSON to browser
    session.subscribe((event) => {
      try {
        switch (event.type) {
          case 'text_delta':
            peer.send(JSON.stringify({ type: 'text_delta', delta: event.delta }))
            break
          case 'text_done':
            peer.send(JSON.stringify({ type: 'text_done', fullText: event.fullText }))
            break
          case 'tool_start':
            peer.send(JSON.stringify({ type: 'tool_start', toolName: event.toolName, toolInput: event.toolInput }))
            break
          case 'tool_end': {
            const payload: Record<string, unknown> = { type: 'tool_end', toolName: event.toolName, toolOutput: event.toolOutput }
            // Include playable music URL for browser playback
            if (event.toolName === 'play_music' && (event.toolOutput as any)?.details?.path) {
              payload.musicUrl = `/api/music/${encodeURIComponent(basename((event.toolOutput as any).details.path))}`
            }
            peer.send(JSON.stringify(payload))
            break
          }
          case 'turn_end':
            peer.send(JSON.stringify({ type: 'turn_end' }))
            break
          case 'error':
            peer.send(JSON.stringify({ type: 'error', message: event.error.message }))
            break
        }
      } catch {
        // Peer may have disconnected
      }
    })

    ;(peer as any)._session = session
    ;(peer as any)._sessionId = sessionId

    // Create DB session record
    try {
      const db = useDatabase()
      db.prepare('INSERT INTO sessions (id, device_id, client_id, started_at, type) VALUES (?, ?, ?, ?, ?)').run(
        sessionId,
        'web',
        'browser',
        Date.now(),
        'web',
      )
    } catch (err) {
      console.error('[web-chat] Failed to create session record:', err)
    }

    // Load all tools (HA, memory, ytmusic) and attach to session
    const toolsPromise = createSessionTools({
      db: useDatabase(),
      embeddings: createEmbeddings(),
    }).then((result) => {
      session.setTools(result.tools)
      ;(peer as any)._toolsCleanup = result.cleanup
      console.log(`[web-chat] Loaded ${result.tools.length} tools for session ${sessionId}`)
    }).catch((err) => {
      console.warn('[web-chat] Failed to load tools:', err)
    })

    ;(peer as any)._toolsPromise = toolsPromise

    // Subscribe to message bus — forward voice/scheduler messages to browser in real time
    const unsubBus = messageBus.subscribe((msg) => {
      // Don't echo back messages from this web chat session
      if (msg.sessionId === sessionId) return
      try {
        peer.send(JSON.stringify({
          type: 'broadcast',
          id: msg.id,
          role: msg.role,
          content: msg.content,
          sessionType: msg.sessionType,
          createdAt: msg.createdAt,
        }))
      } catch {}
    })
    ;(peer as any)._unsubBus = unsubBus

    // Send ready signal to client
    try { peer.send(JSON.stringify({ type: 'ready', sessionId })) } catch {}
    console.log(`[web-chat] Session opened: ${sessionId}`)
  },

  async message(peer, message) {
    const session = (peer as any)._session as AgentSession
    const sessionId = (peer as any)._sessionId as string
    if (!session) return

    // Wait for tools to be loaded before processing first prompt
    if ((peer as any)._toolsPromise) {
      await (peer as any)._toolsPromise
      ;(peer as any)._toolsPromise = null
    }

    try {
      const msg = JSON.parse(message.text())

      if (msg.type === 'prompt' && typeof msg.text === 'string') {
        // Save user message to DB
        try {
          const db = useDatabase()
          db.prepare('INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)').run(
            crypto.randomUUID(),
            sessionId,
            'user',
            msg.text,
            Date.now(),
          )
        } catch {
          // Non-critical -- continue with prompt
        }

        // Send prompt to agent — it uses recall_memory tool when it needs context
        const fullResponse = await session.prompt(msg.text)

        // Save assistant response to DB
        try {
          const db = useDatabase()
          db.prepare(
            'INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)',
          ).run(crypto.randomUUID(), sessionId, 'assistant', fullResponse, Date.now())
        } catch {
          // Non-critical
        }
      } else if (msg.type === 'interrupt') {
        session.interrupt()
      }
    } catch (err) {
      console.error(`[web-chat] Message handling error in session ${sessionId}:`, err)
      try {
        peer.send(JSON.stringify({ type: 'error', message: 'Failed to process message' }))
      } catch {
        // Peer disconnected
      }
    }
  },

  close(peer) {
    const session = (peer as any)._session as AgentSession | undefined
    const sessionId = (peer as any)._sessionId as string | undefined
    const toolsCleanup = (peer as any)._toolsCleanup as (() => Promise<void>) | undefined
    const unsubBus = (peer as any)._unsubBus as (() => void) | undefined

    unsubBus?.()

    if (session) {
      session.destroy()
    }

    toolsCleanup?.().catch(() => {})

    // End DB session
    if (sessionId) {
      try {
        const db = useDatabase()
        db.prepare('UPDATE sessions SET ended_at = ? WHERE id = ?').run(Date.now(), sessionId)
      } catch {
        // Non-critical
      }
    }

    console.log(`[web-chat] Session closed: ${sessionId || 'unknown'}`)
  },

  error(peer, error) {
    const sessionId = (peer as any)?._sessionId as string | undefined
    console.error(`[web-chat] Error in session ${sessionId || 'unknown'}: ${error.message}`)
  },
})
