// SQLite database singleton with schema migration
// Uses WAL mode, foreign keys, sqlite-vec for vector search

import Database from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'
import fs from 'fs'
import path from 'path'

/**
 * Get or create the SQLite database singleton.
 * Cached on globalThis to survive Nitro code-splitting and HMR.
 * Initializes WAL mode, foreign keys, sqlite-vec, and runs migrations.
 */
export function useDatabase(): Database.Database {
  const cached = (globalThis as any).__espie_db as Database.Database | undefined
  if (cached) return cached

  const dbPath = process.env.DATABASE_PATH || './data/db/espie.db'
  const dir = path.dirname(dbPath)
  fs.mkdirSync(dir, { recursive: true })

  const db = new Database(dbPath)

  // Set pragmas for performance and correctness
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 5000')
  db.pragma('foreign_keys = ON')

  // Load sqlite-vec extension for vector search
  sqliteVec.load(db)

  // Run schema migrations
  migrate(db)

  ;(globalThis as any).__espie_db = db
  return db
}

/**
 * Close the database connection and reset the singleton.
 * Used in tests and for clean shutdown.
 */
export function closeDatabase(): void {
  const db = (globalThis as any).__espie_db as Database.Database | undefined
  if (db) {
    db.close()
    ;(globalThis as any).__espie_db = null
  }
}

/**
 * Run schema migrations. Creates schema_version table and applies
 * any pending migrations in order.
 */
function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `)

  const row = db.prepare('SELECT MAX(version) as version FROM schema_version').get() as { version: number | null }
  const currentVersion = row.version ?? 0

  if (currentVersion < 1) {
    applyV1(db)
  }

  if (currentVersion < 2) {
    applyV2(db)
  }

  if (currentVersion < 3) {
    applyV3(db)
  }

  if (currentVersion < 4) {
    applyV4(db)
  }
}

/**
 * Schema version 1: Core tables for sessions, messages, config, memory, and plugins.
 */
function applyV1(db: Database.Database): void {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        device_id TEXT,
        client_id TEXT,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        summary TEXT
      )
    `)

    db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'tool_result', 'system')),
        content TEXT NOT NULL,
        tool_calls TEXT,
        parent_id TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      )
    `)

    db.exec(`
      CREATE TABLE IF NOT EXISTS config (
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (namespace, key)
      )
    `)

    db.exec(`
      CREATE TABLE IF NOT EXISTS memory_facts (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        source_message_id TEXT,
        embedding BLOB,
        created_at INTEGER NOT NULL,
        last_accessed_at INTEGER,
        access_count INTEGER DEFAULT 0
      )
    `)

    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_vec USING vec0(
        id TEXT PRIMARY KEY,
        embedding float[384]
      )
    `)

    db.exec(`
      CREATE TABLE IF NOT EXISTS plugin_state (
        plugin_name TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (plugin_name, key)
      )
    `)

    db.exec(`INSERT INTO schema_version (version, applied_at) VALUES (1, unixepoch())`)
  })()
}

/**
 * Schema version 2: Add session type column to distinguish voice vs web chat sessions.
 */
function applyV2(db: Database.Database): void {
  db.transaction(() => {
    db.exec(`ALTER TABLE sessions ADD COLUMN type TEXT DEFAULT 'voice'`)
    db.exec(`INSERT INTO schema_version (version, applied_at) VALUES (2, unixepoch())`)
  })()
}

/**
 * Schema version 3: Recreate memory_vec with cosine distance metric.
 * The original table used sqlite-vec's default L2 distance, which is wrong
 * for semantic text similarity. Cosine distance is length-invariant and standard.
 * Safe to DROP because memory population starts in Phase 5 (no data to migrate).
 */
function applyV3(db: Database.Database): void {
  db.transaction(() => {
    db.exec('DROP TABLE IF EXISTS memory_vec')
    db.exec(
      `CREATE VIRTUAL TABLE memory_vec USING vec0(
        id TEXT PRIMARY KEY,
        embedding float[384] distance_metric=cosine
      )`,
    )
    db.exec("INSERT INTO schema_version (version, applied_at) VALUES (3, unixepoch())")
  })()
}

/**
 * Schema version 4: Add schedules table for DB-backed cron scheduling.
 * Replaces the YAML-based scheduler config with runtime-modifiable schedules.
 */
function applyV4(db: Database.Database): void {
  db.transaction(() => {
    db.prepare(`
      CREATE TABLE IF NOT EXISTS schedules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        cron TEXT NOT NULL,
        prompt TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        timezone TEXT,
        last_run_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `).run()
    db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (4, unixepoch())").run()
  })()
}
