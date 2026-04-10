// Ring buffer log capture — intercepts console output for the dashboard log viewer.
// Maintains a fixed-size buffer (1000 entries) with subscriber notification.

export interface LogEntry {
  timestamp: number
  level: 'info' | 'warn' | 'error'
  message: string
}

export class LogBuffer {
  private entries: LogEntry[] = []
  private maxSize = 1000
  private listeners = new Set<(entry: LogEntry) => void>()

  /**
   * Push a new log entry. Evicts oldest entry when buffer is full.
   * Notifies all subscribers with the new entry.
   */
  push(entry: LogEntry): void {
    this.entries.push(entry)
    if (this.entries.length > this.maxSize) {
      this.entries.shift()
    }
    for (const fn of this.listeners) {
      fn(entry)
    }
  }

  /**
   * Get recent log entries. Returns the last `count` entries, or all entries if count is omitted.
   */
  getRecent(count?: number): LogEntry[] {
    if (count === undefined) {
      return [...this.entries]
    }
    return this.entries.slice(-count)
  }

  /**
   * Subscribe to new log entries. Returns an unsubscribe function.
   */
  subscribe(fn: (entry: LogEntry) => void): () => void {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }
}

/** Singleton log buffer — cached on globalThis to survive Nitro code-splitting. */
export const logBuffer: LogBuffer =
  (globalThis as any).__espie_log_buffer ||
  ((globalThis as any).__espie_log_buffer = new LogBuffer())

// Console intercept — capture all server console output into the ring buffer.
// Stores original functions to call them first (preserving normal output).
const origLog = console.log
const origWarn = console.warn
const origError = console.error

console.log = (...args: unknown[]) => {
  origLog(...args)
  logBuffer.push({
    timestamp: Date.now(),
    level: 'info',
    message: args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' '),
  })
}

console.warn = (...args: unknown[]) => {
  origWarn(...args)
  logBuffer.push({
    timestamp: Date.now(),
    level: 'warn',
    message: args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' '),
  })
}

console.error = (...args: unknown[]) => {
  origError(...args)
  logBuffer.push({
    timestamp: Date.now(),
    level: 'error',
    message: args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' '),
  })
}
