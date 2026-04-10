// Agent tools for managing scheduled tasks.
// Gives the assistant CRUD access to her own cron schedules at runtime.

import { Type } from '@sinclair/typebox'
import nodeCron from 'node-cron'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type Database from 'better-sqlite3'
import {
  listSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
} from '../utils/schedules'

export function createListSchedulesTool(db: Database.Database): AgentTool<any> {
  return {
    name: 'list_schedules',
    label: 'List Schedules',
    description:
      'List all scheduled tasks with their name, cron expression, prompt, enabled status, and last run time.',
    parameters: Type.Object({}),
    execute: async () => {
      const schedules = listSchedules(db)
      if (schedules.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No scheduled tasks configured.' }] }
      }
      const lines = schedules.map(s =>
        `- [${s.id}] "${s.name}" (${s.enabled ? 'enabled' : 'disabled'}) — ${s.cron}${s.last_run_at ? ` (last run: ${new Date(s.last_run_at * 1000).toISOString()})` : ''}\n  Prompt: ${s.prompt}`,
      )
      return { content: [{ type: 'text' as const, text: `Scheduled tasks:\n${lines.join('\n')}` }] }
    },
  }
}

export function createCreateScheduleTool(db: Database.Database): AgentTool<any> {
  return {
    name: 'create_schedule',
    label: 'Create Schedule',
    description:
      'Create a new scheduled task. Requires a name, cron expression (5-field: minute hour day month weekday), and a prompt for what the agent should do when it fires. Examples: "0 7 * * *" = daily at 7am, "0 9 * * 1-5" = weekdays at 9am, "*/30 * * * *" = every 30 minutes.',
    parameters: Type.Object({
      name: Type.String({ description: 'Human-readable name, e.g. "Morning briefing"' }),
      cron: Type.String({ description: '5-field cron: minute hour day-of-month month day-of-week' }),
      prompt: Type.String({ description: 'What the agent should do when this fires' }),
    }),
    execute: async (_id: string, params: { name: string; cron: string; prompt: string }) => {
      if (!nodeCron.validate(params.cron)) {
        return { content: [{ type: 'text' as const, text: `Invalid cron expression: "${params.cron}"` }] }
      }
      const schedule = createSchedule(db, params)
      return {
        content: [{ type: 'text' as const, text: `Created schedule "${schedule.name}" [${schedule.id}] with cron: ${schedule.cron}. It will take effect within the next minute.` }],
      }
    },
  }
}

export function createUpdateScheduleTool(db: Database.Database): AgentTool<any> {
  return {
    name: 'update_schedule',
    label: 'Update Schedule',
    description:
      'Update an existing scheduled task by ID. Can change any combination of name, cron, prompt, or enabled status. Use list_schedules first to get IDs.',
    parameters: Type.Object({
      id: Type.String({ description: 'The schedule ID to update' }),
      name: Type.Optional(Type.String({ description: 'New name' })),
      cron: Type.Optional(Type.String({ description: 'New cron expression (5 fields)' })),
      prompt: Type.Optional(Type.String({ description: 'New prompt' })),
      enabled: Type.Optional(Type.Boolean({ description: 'Enable or disable the schedule' })),
    }),
    execute: async (_id: string, params: { id: string; name?: string; cron?: string; prompt?: string; enabled?: boolean }) => {
      if (params.cron && !nodeCron.validate(params.cron)) {
        return { content: [{ type: 'text' as const, text: `Invalid cron expression: "${params.cron}"` }] }
      }
      const { id, ...updates } = params
      const schedule = updateSchedule(db, id, updates)
      if (!schedule) {
        return { content: [{ type: 'text' as const, text: `Schedule not found: ${id}` }] }
      }
      return {
        content: [{ type: 'text' as const, text: `Updated schedule "${schedule.name}" [${schedule.id}]` }],
      }
    },
  }
}

export function createDeleteScheduleTool(db: Database.Database): AgentTool<any> {
  return {
    name: 'delete_schedule',
    label: 'Delete Schedule',
    description: 'Delete a scheduled task by ID. Use list_schedules first to get IDs.',
    parameters: Type.Object({
      id: Type.String({ description: 'The schedule ID to delete' }),
    }),
    execute: async (_id: string, params: { id: string }) => {
      const deleted = deleteSchedule(db, params.id)
      if (!deleted) {
        return { content: [{ type: 'text' as const, text: `Schedule not found: ${params.id}` }] }
      }
      return {
        content: [{ type: 'text' as const, text: `Deleted schedule ${params.id}` }],
      }
    },
  }
}
