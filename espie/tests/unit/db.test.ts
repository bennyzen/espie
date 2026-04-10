import { describe, test, expect, beforeEach, afterEach, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { useDatabase, closeDatabase } from '../../server/utils/db'

// Track temp dirs for cleanup
const tempDirs: string[] = []

function createTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'espie-test-'))
  tempDirs.push(dir)
  return path.join(dir, 'test.db')
}

beforeEach(() => {
  process.env.DATABASE_PATH = createTempDbPath()
})

afterEach(() => {
  closeDatabase()
})

afterAll(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('useDatabase', () => {
  test('returns a Database instance (not null)', () => {
    const db = useDatabase()
    expect(db).not.toBeNull()
    expect(db).toBeDefined()
  })

  test('called twice returns the same instance (singleton)', () => {
    const db1 = useDatabase()
    const db2 = useDatabase()
    expect(db1).toBe(db2)
  })

  test('database has WAL journal mode', () => {
    const db = useDatabase()
    const result = db.pragma('journal_mode') as Array<{ journal_mode: string }>
    expect(result[0].journal_mode).toBe('wal')
  })

  test('database has foreign_keys enabled', () => {
    const db = useDatabase()
    const result = db.pragma('foreign_keys') as Array<{ foreign_keys: number }>
    expect(result[0].foreign_keys).toBe(1)
  })
})

describe('schema tables', () => {
  test('sessions table exists with correct columns', () => {
    const db = useDatabase()
    const cols = db.prepare("PRAGMA table_info('sessions')").all() as Array<{ name: string }>
    const colNames = cols.map((c) => c.name)
    expect(colNames).toContain('id')
    expect(colNames).toContain('device_id')
    expect(colNames).toContain('client_id')
    expect(colNames).toContain('started_at')
    expect(colNames).toContain('ended_at')
    expect(colNames).toContain('summary')
    expect(colNames).toContain('type')
  })

  test('messages table exists with correct columns', () => {
    const db = useDatabase()
    const cols = db.prepare("PRAGMA table_info('messages')").all() as Array<{ name: string }>
    const colNames = cols.map((c) => c.name)
    expect(colNames).toContain('id')
    expect(colNames).toContain('session_id')
    expect(colNames).toContain('role')
    expect(colNames).toContain('content')
    expect(colNames).toContain('tool_calls')
    expect(colNames).toContain('parent_id')
    expect(colNames).toContain('created_at')
  })

  test('config table exists with composite PK (namespace, key)', () => {
    const db = useDatabase()
    const cols = db.prepare("PRAGMA table_info('config')").all() as Array<{ name: string; pk: number }>
    const pkCols = cols.filter((c) => c.pk > 0).map((c) => c.name)
    expect(pkCols).toContain('namespace')
    expect(pkCols).toContain('key')
  })

  test('memory_facts table exists with correct columns', () => {
    const db = useDatabase()
    const cols = db.prepare("PRAGMA table_info('memory_facts')").all() as Array<{ name: string }>
    const colNames = cols.map((c) => c.name)
    expect(colNames).toContain('id')
    expect(colNames).toContain('content')
    expect(colNames).toContain('embedding')
    expect(colNames).toContain('created_at')
  })

  test('plugin_state table exists with composite PK (plugin_name, key)', () => {
    const db = useDatabase()
    const cols = db.prepare("PRAGMA table_info('plugin_state')").all() as Array<{ name: string; pk: number }>
    const pkCols = cols.filter((c) => c.pk > 0).map((c) => c.name)
    expect(pkCols).toContain('plugin_name')
    expect(pkCols).toContain('key')
  })

  test('schedules table exists with correct columns', () => {
    const db = useDatabase()
    const cols = db.prepare("PRAGMA table_info('schedules')").all() as Array<{ name: string }>
    const colNames = cols.map((c) => c.name)
    expect(colNames).toContain('id')
    expect(colNames).toContain('name')
    expect(colNames).toContain('cron')
    expect(colNames).toContain('prompt')
    expect(colNames).toContain('enabled')
    expect(colNames).toContain('timezone')
    expect(colNames).toContain('last_run_at')
    expect(colNames).toContain('created_at')
    expect(colNames).toContain('updated_at')
  })

  test('schema_version table exists and contains latest version', () => {
    const db = useDatabase()
    const row = db.prepare('SELECT MAX(version) as version FROM schema_version').get() as { version: number }
    expect(row.version).toBe(4)
  })
})

describe('sqlite-vec', () => {
  test('loads successfully (vec_version returns a string)', () => {
    const db = useDatabase()
    const row = db.prepare('SELECT vec_version() as v').get() as { v: string }
    expect(typeof row.v).toBe('string')
    expect(row.v.length).toBeGreaterThan(0)
  })

  test('memory_vec virtual table exists', () => {
    const db = useDatabase()
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_vec'").all() as Array<{ name: string }>
    expect(tables.length).toBe(1)
    expect(tables[0].name).toBe('memory_vec')
  })
})

describe('data operations', () => {
  test('inserting and querying a session works (roundtrip)', () => {
    const db = useDatabase()
    const id = 'test-session-001'
    const now = Date.now()

    db.prepare('INSERT INTO sessions (id, device_id, client_id, started_at) VALUES (?, ?, ?, ?)')
      .run(id, 'device-1', 'client-1', now)

    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as {
      id: string
      device_id: string
      client_id: string
      started_at: number
    }
    expect(row.id).toBe(id)
    expect(row.device_id).toBe('device-1')
    expect(row.client_id).toBe('client-1')
    expect(row.started_at).toBe(now)
  })

  test('messages table enforces role CHECK constraint', () => {
    const db = useDatabase()
    // First create a session for the FK
    db.prepare('INSERT INTO sessions (id, device_id, client_id, started_at) VALUES (?, ?, ?, ?)')
      .run('session-for-check', 'dev', 'cli', Date.now())

    expect(() => {
      db.prepare('INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)')
        .run('msg-1', 'session-for-check', 'invalid', 'test', Date.now())
    }).toThrow()
  })
})
