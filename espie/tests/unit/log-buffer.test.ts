import { describe, it, expect, vi } from 'vitest'
import { LogBuffer } from '../../server/utils/log-buffer'
import type { LogEntry } from '../../server/utils/log-buffer'

describe('LogBuffer', () => {
  function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
    return {
      timestamp: Date.now(),
      level: 'info',
      message: 'test message',
      ...overrides,
    }
  }

  it('push() adds entry, getRecent() returns it', () => {
    const buffer = new LogBuffer()
    const entry = makeEntry()

    buffer.push(entry)

    const recent = buffer.getRecent()
    expect(recent).toHaveLength(1)
    expect(recent[0].message).toBe('test message')
  })

  it('ring buffer: push 1001 entries, getRecent() returns 1000', () => {
    const buffer = new LogBuffer()

    for (let i = 0; i < 1001; i++) {
      buffer.push(makeEntry({ message: `msg-${i}` }))
    }

    const recent = buffer.getRecent()
    expect(recent).toHaveLength(1000)
    // First entry should be msg-1 (msg-0 was evicted)
    expect(recent[0].message).toBe('msg-1')
    expect(recent[999].message).toBe('msg-1000')
  })

  it('subscribe() receives new entries', () => {
    const buffer = new LogBuffer()
    const listener = vi.fn()

    buffer.subscribe(listener)
    const entry = makeEntry()
    buffer.push(entry)

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(entry)
  })

  it('unsubscribe stops receiving', () => {
    const buffer = new LogBuffer()
    const listener = vi.fn()

    const unsub = buffer.subscribe(listener)
    unsub()
    buffer.push(makeEntry())

    expect(listener).not.toHaveBeenCalled()
  })

  it('getRecent(10) returns last 10 entries', () => {
    const buffer = new LogBuffer()

    for (let i = 0; i < 25; i++) {
      buffer.push(makeEntry({ message: `msg-${i}` }))
    }

    const recent = buffer.getRecent(10)
    expect(recent).toHaveLength(10)
    expect(recent[0].message).toBe('msg-15')
    expect(recent[9].message).toBe('msg-24')
  })

  it('entries have timestamp, level, message fields', () => {
    const buffer = new LogBuffer()
    const now = Date.now()

    buffer.push({ timestamp: now, level: 'error', message: 'bad things' })

    const recent = buffer.getRecent()
    expect(recent[0]).toEqual({
      timestamp: now,
      level: 'error',
      message: 'bad things',
    })
  })
})
