// WebSocket route handler for ESP32 device connections.
// Path: /xiaozhi/v1 -- matches the firmware's expected WebSocket endpoint.
// Delegates protocol handling to ws-handler.ts for hello/session management.
// Audio processing delegated to VoicePipeline for VAD->ASR->Agent->TTS flow.
// Wires all providers, tools, and plugins together via config-driven dependency injection.

import { parseProtocolMessage } from '../../utils/protocol'
import { handleProtocolMessage, createSession, endSession } from '../../utils/ws-handler'
import type { SessionContext } from '../../utils/ws-handler'
import { VoicePipeline } from '../../utils/voice-pipeline'
import { sessionStore } from '../../utils/session-store'
import { useDatabase } from '../../utils/db'
import { loadConfig } from '../../utils/config'
import { createLLM, createASR, createTTS, createEmbeddings } from '../../providers/registry'
import { createSessionTools, createSyncTools } from '../../tools/registry'
import { PluginLoader } from '../../utils/plugin-loader'
import { deviceRegistry } from '../../utils/device-registry'
import crypto from 'crypto'

// Track active peers by device ID so we can close stale connections
// when the same device reconnects (e.g. after reboot or network loss).
// Without this, the old peer's TCP socket emits ECONNRESET asynchronously.
const activePeers = new Map<string, any>()

export default defineWebSocketHandler({
  open(peer) {
    const headers = peer.request?.headers
    const deviceId = headers?.get('device-id') || 'unknown'
    const clientId = headers?.get('client-id') || 'unknown'
    const sessionId = crypto.randomUUID()

    // Close stale connection from same device
    const oldPeer = activePeers.get(deviceId)
    if (oldPeer && oldPeer !== peer) {
      console.log(`[ws] Superseding stale connection for ${deviceId}`)
      // Mark superseded so close handler skips device unregistration
      ;(oldPeer as any)._superseded = true
      try { oldPeer.close() } catch {}
    }
    activePeers.set(deviceId, peer)

    const ctx: SessionContext = {
      deviceId,
      clientId,
      sessionId,
      state: 'connected',
    }

    // Register device in the dashboard device registry
    deviceRegistry.register({
      deviceId,
      clientId,
      sessionId,
      connectedAt: Date.now(),
      state: 'connected',
    })

    // Load config and create providers
    const config = loadConfig()
    const model = createLLM(config.llm)
    const asr = createASR(config.asr)
    const tts = createTTS(config.tts)

    // Create transport object shared between pipeline and device registry.
    // Wrapped in try/catch — peer.send() throws ECONNRESET if the device
    // disconnects mid-send (e.g. during TTS streaming or OTA reboot).
    const transport = {
      sendText: (data: string) => { try { peer.send(data) } catch {} },
      sendBinary: (data: Buffer | Uint8Array) => { try { peer.send(data) } catch {} },
    }

    // Store transport on device registry so scheduler can send TTS audio
    deviceRegistry.update(deviceId, { transport })

    // Create sync tools immediately (memory, ytmusic, say) so pipeline starts with tools
    const db = useDatabase()
    const embeddings = createEmbeddings()
    const { tools: syncTools, memoryService } = createSyncTools({ db, embeddings, transport })

    // Restore previous conversation if same device reconnects within 5 minutes
    const previousMessages = sessionStore.restore(deviceId)
    if (previousMessages) {
      console.log(`[ws] Restored ${previousMessages.length} messages for ${deviceId}`)
    }

    ;(peer as any)._ctx = ctx
    ;(peer as any)._memoryService = memoryService

    // Create pipeline (async due to opus codec init) and load full tools concurrently
    const pluginLoader = new PluginLoader()
    ;(peer as any)._pluginLoader = pluginLoader

    const initPromise = VoicePipeline.create({
      sessionId,
      transport,
      previousMessages: previousMessages ?? undefined,
      model,
      asr,
      tts,
      tools: syncTools,
      // systemPrompt built by VoicePipeline via buildSystemPrompt() — includes date/time/location
      memoryService,
    }).then(async (pipeline) => {
      ;(peer as any)._pipeline = pipeline

      // Load async tools (HA) and plugins in parallel with VAD init
      const [, toolsResult] = await Promise.all([
        pipeline.init(),
        createSessionTools({ db, embeddings, transport, memoryService }).catch((err) => {
          console.warn(`[ws] Failed to load session tools for ${deviceId}:`, err)
          return null
        }),
        pluginLoader.startWatching(config.plugins.dir, (pluginTools) => {
          // Hot-reload: merge current full tools + new plugins
          const base = (peer as any)._fullTools || syncTools
          pipeline.updateTools([...base, ...pluginTools])
          console.log(`[ws] Plugin hot-reload: ${base.length + pluginTools.length} total tools for ${deviceId}`)
        }),
      ])

      // Merge all tools: registry tools + plugins
      if (toolsResult) {
        const allTools = [...toolsResult.tools, ...pluginLoader.getTools()]
        ;(peer as any)._fullTools = toolsResult.tools
        ;(peer as any)._toolsCleanup = toolsResult.cleanup
        pipeline.updateTools(allTools)
        console.log(`[ws] Loaded ${allTools.length} tools for ${deviceId}`)
      }

      return pipeline
    }).catch((err) => {
      console.error(`[ws] Pipeline/tools init failed for ${deviceId}:`, err)
    })

    ;(peer as any)._initPromise = initPromise

    try {
      createSession(useDatabase(), deviceId, clientId, sessionId)
    } catch (err) {
      console.error('[ws] Failed to create session:', err)
    }

    console.log(`[ws] Device connected: ${deviceId} (session: ${sessionId})`)
  },

  async message(peer, message) {
    const ctx = (peer as any)._ctx as SessionContext
    const raw = message.rawData

    // CrossWS delivers ALL messages (text + binary) as Buffer.
    // Distinguish by checking if the buffer content is JSON (starts with '{').
    let textData: string | null = null
    if (typeof raw === 'string') {
      textData = raw
    } else {
      const bytes = Buffer.isBuffer(raw) ? raw
        : raw instanceof Uint8Array ? Buffer.from(raw)
        : raw instanceof ArrayBuffer ? Buffer.from(raw)
        : null
      if (bytes && bytes.length > 0 && bytes[0] === 0x7b) { // 0x7b = '{'
        textData = bytes.toString('utf8')
      }
    }

    if (textData) {
      // Text message -- JSON protocol message
      // Hello/session management is handled immediately (no pipeline needed)
      const parsed = parseProtocolMessage(textData)
      if (!parsed) return
      if (parsed.type !== 'hello' && parsed.type !== 'ping') {
        console.log(`[ws] ${ctx.deviceId}: ${parsed.type}${(parsed as any).state ? '/' + (parsed as any).state : ''}`)
      }

      const response = handleProtocolMessage(ctx, parsed)
      if (response) {
        try { peer.send(JSON.stringify(response)) } catch {}
      }

      // Update device state in registry for dashboard display
      deviceRegistry.update(ctx.deviceId, { state: ctx.state })

      // Pipeline-dependent messages (listen/abort) — wait for pipeline if needed
      const ptype = parsed.type
      if (ptype === 'listen' || ptype === 'abort') {
        if (!(peer as any)._pipeline) {
          await (peer as any)._initPromise
        }
        const pipeline = (peer as any)._pipeline as VoicePipeline
        if (!pipeline) return
        pipeline.handleProtocolMessage(parsed).catch((err) => {
          console.error(`[ws] Pipeline protocol error from ${ctx.deviceId}:`, err)
        })
      }
    } else {
      // Binary message -- Opus audio frame. Wait for pipeline if needed.
      if (!(peer as any)._pipeline) {
        await (peer as any)._initPromise
      }
      const pipeline = (peer as any)._pipeline as VoicePipeline
      if (!pipeline) return
      const frame = Buffer.from(message.uint8Array())
      pipeline.handleAudioFrame(frame).catch((err) => {
        console.error(`[ws] Pipeline audio error from ${ctx.deviceId}:`, err)
      })
    }
  },

  close(peer, _event) {
    const ctx = (peer as any)._ctx as SessionContext
    const pipeline = (peer as any)._pipeline as VoicePipeline
    const pluginLoader = (peer as any)._pluginLoader as PluginLoader | undefined
    const toolsCleanup = (peer as any)._toolsCleanup as (() => Promise<void>) | undefined
    if (!ctx) return

    const superseded = !!(peer as any)._superseded

    // Only touch shared resources if this peer wasn't superseded by a new connection
    if (!superseded) {
      if (activePeers.get(ctx.deviceId) === peer) {
        activePeers.delete(ctx.deviceId)
      }
      deviceRegistry.unregister(ctx.deviceId)
    }

    // Save conversation to in-memory store for reconnects (DB persistence is real-time now)
    if (pipeline) {
      const messages = pipeline.getConversationMessages()
      if (messages.length > 0) {
        sessionStore.save(ctx.deviceId, messages)
        console.log(`[ws] Saved ${messages.length} messages for ${ctx.deviceId} reconnect`)
      }
      pipeline.destroy()
    }

    // Clean up plugin loader and tool resources
    pluginLoader?.stop().catch(() => {})
    toolsCleanup?.().catch(() => {})

    try {
      endSession(useDatabase(), ctx.sessionId)
    } catch (err) {
      console.error('[ws] Failed to end session:', err)
    }

    console.log(`[ws] Device disconnected: ${ctx.deviceId} (session: ${ctx.sessionId})${superseded ? ' [superseded]' : ''}`)
  },

  error(peer, error) {
    const ctx = (peer as any)?._ctx as SessionContext | undefined
    console.error(`[ws] Error from ${ctx?.deviceId || 'unknown'}: ${error.message}`)
  },
})
