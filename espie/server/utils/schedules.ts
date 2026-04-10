// Schedule data access layer — CRUD operations for the schedules table.

import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'

export interface Schedule {
  id: string
  name: string
  cron: string
  prompt: string
  enabled: boolean
  timezone: string | null
  last_run_at: number | null
  created_at: number
  updated_at: number
}

interface ScheduleRow {
  id: string
  name: string
  cron: string
  prompt: string
  enabled: number
  timezone: string | null
  last_run_at: number | null
  created_at: number
  updated_at: number
}

function rowToSchedule(row: ScheduleRow): Schedule {
  return { ...row, enabled: row.enabled === 1 }
}

export function listSchedules(db: Database.Database): Schedule[] {
  const rows = db.prepare('SELECT * FROM schedules ORDER BY created_at ASC').all() as ScheduleRow[]
  return rows.map(rowToSchedule)
}

export function getSchedule(db: Database.Database, id: string): Schedule | null {
  const row = db.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as ScheduleRow | undefined
  return row ? rowToSchedule(row) : null
}

export function getEnabledSchedules(db: Database.Database): Schedule[] {
  const rows = db.prepare('SELECT * FROM schedules WHERE enabled = 1').all() as ScheduleRow[]
  return rows.map(rowToSchedule)
}

export function createSchedule(
  db: Database.Database,
  data: { name: string; cron: string; prompt: string; timezone?: string; enabled?: boolean },
): Schedule {
  const id = randomUUID()
  const now = Math.floor(Date.now() / 1000)
  const enabled = data.enabled !== false ? 1 : 0
  db.prepare(
    'INSERT INTO schedules (id, name, cron, prompt, enabled, timezone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(id, data.name, data.cron, data.prompt, enabled, data.timezone || null, now, now)
  return getSchedule(db, id)!
}

export function updateSchedule(
  db: Database.Database,
  id: string,
  data: Partial<{ name: string; cron: string; prompt: string; timezone: string | null; enabled: boolean }>,
): Schedule | null {
  const existing = getSchedule(db, id)
  if (!existing) return null

  const now = Math.floor(Date.now() / 1000)
  const fields: string[] = ['updated_at = ?']
  const values: unknown[] = [now]

  if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name) }
  if (data.cron !== undefined) { fields.push('cron = ?'); values.push(data.cron) }
  if (data.prompt !== undefined) { fields.push('prompt = ?'); values.push(data.prompt) }
  if (data.timezone !== undefined) { fields.push('timezone = ?'); values.push(data.timezone) }
  if (data.enabled !== undefined) { fields.push('enabled = ?'); values.push(data.enabled ? 1 : 0) }

  values.push(id)
  db.prepare(`UPDATE schedules SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  return getSchedule(db, id)!
}

export function deleteSchedule(db: Database.Database, id: string): boolean {
  const result = db.prepare('DELETE FROM schedules WHERE id = ?').run(id)
  return result.changes > 0
}

export function updateLastRunAt(db: Database.Database, id: string): void {
  const now = Math.floor(Date.now() / 1000)
  db.prepare('UPDATE schedules SET last_run_at = ? WHERE id = ?').run(now, id)
}
