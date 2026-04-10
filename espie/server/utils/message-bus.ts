// Message bus — notifies subscribers when new chat messages are persisted.
// Used to push voice/scheduler messages to the web UI in real time.

import { EventEmitter } from 'events'

export interface ChatMessage {
  id: string
  sessionId: string
  role: string
  content: string
  sessionType: string
  createdAt: number
}

class MessageBus extends EventEmitter {
  publish(msg: ChatMessage): void {
    this.emit('message', msg)
  }

  subscribe(fn: (msg: ChatMessage) => void): () => void {
    this.on('message', fn)
    return () => this.off('message', fn)
  }
}

export const messageBus: MessageBus =
  (globalThis as any).__espie_message_bus ||
  ((globalThis as any).__espie_message_bus = new MessageBus())
