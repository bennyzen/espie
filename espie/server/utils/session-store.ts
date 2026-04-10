// Session Store — in-memory store for session reconnection.
// Saves conversation context on disconnect and restores within 5 minutes for the same device-id.

export interface SavedSession {
  deviceId: string
  messages: Array<{ role: string; content: string }>
  savedAt: number
}

export class SessionStore {
  private sessions: Map<string, SavedSession> = new Map()
  private readonly TTL = 5 * 60 * 1000 // 5 minutes in ms

  /**
   * Save conversation messages for a device. Overwrites any previous entry.
   */
  save(deviceId: string, messages: Array<{ role: string; content: string }>): void {
    this.sessions.set(deviceId, {
      deviceId,
      messages,
      savedAt: Date.now(),
    })
  }

  /**
   * Restore conversation messages for a device if saved within TTL.
   * One-time restore: the entry is deleted after retrieval.
   * Returns null if no entry exists or the entry has expired.
   */
  restore(deviceId: string): Array<{ role: string; content: string }> | null {
    const saved = this.sessions.get(deviceId)
    if (!saved) return null

    this.sessions.delete(deviceId)

    if (Date.now() - saved.savedAt >= this.TTL) {
      return null
    }

    return saved.messages
  }

  /**
   * Remove all expired entries from the store.
   */
  cleanup(): void {
    const now = Date.now()
    for (const [deviceId, session] of this.sessions) {
      if (now - session.savedAt >= this.TTL) {
        this.sessions.delete(deviceId)
      }
    }
  }
}

/** Singleton session store — cached on globalThis to survive Nitro code-splitting. */
export const sessionStore: SessionStore =
  (globalThis as any).__espie_session_store ||
  ((globalThis as any).__espie_session_store = new SessionStore())
