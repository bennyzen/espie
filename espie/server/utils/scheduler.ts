// Minute-tick scheduler — queries DB every minute for enabled schedules
// whose cron expression matches the current time, and executes them.
// No individual cron task management — the DB is the single source of truth.

import cron from 'node-cron'
import type { ScheduledTask } from 'node-cron'
import { deviceRegistry } from './device-registry'
import { AgentSession } from '../agent/agent-session'
import { createLLM, createEmbeddings } from '../providers/registry'
import { loadConfig, createApiKeyResolver } from './config'
import { buildSystemPrompt } from './prompt'
import { createSessionTools } from '../tools/registry'
import { useDatabase } from './db'
import { getEnabledSchedules, updateLastRunAt, type Schedule } from './schedules'
import { cronMatchesDate } from './cron-matcher'

export class EspieScheduler {
  private tick: ScheduledTask | null = null
  private executing = new Set<string>()

  start(): void {
    if (this.tick) return
    this.tick = cron.schedule('* * * * *', () => this.onTick())
    console.log('[scheduler] Started minute-tick')
  }

  stop(): void {
    if (this.tick) {
      this.tick.stop()
      this.tick = null
      console.log('[scheduler] Stopped minute-tick')
    }
  }

  private onTick(): void {
    const db = useDatabase()
    const now = new Date()
    const config = loadConfig()
    const globalTimezone = config.timezone

    const schedules = getEnabledSchedules(db)
    for (const schedule of schedules) {
      const tz = schedule.timezone || globalTimezone
      if (!cronMatchesDate(schedule.cron, now, tz)) continue

      if (this.executing.has(schedule.id)) {
        console.log(`[scheduler] Skipping "${schedule.name}": still executing from previous tick`)
        continue
      }

      // Fire and forget — don't block the tick loop
      this.executeSchedule(schedule)
    }
  }

  private async executeSchedule(schedule: Schedule): Promise<void> {
    this.executing.add(schedule.id)

    try {
      console.log(`[scheduler] Executing "${schedule.name}"`)

      // Grab transport if a device is online — say tool decides whether to speak
      const device = deviceRegistry.getAll()[0]
      const transport = device?.transport ?? null

      const db = useDatabase()
      updateLastRunAt(db, schedule.id)

      const config = loadConfig()
      const model = createLLM(config.llm)

      const toolsResult = await createSessionTools({
        db,
        embeddings: createEmbeddings(),
        transport,
        source: 'schedule',
      })

      const session = new AgentSession({
        systemPrompt: buildSystemPrompt({ scheduler: true }),
        model,
        tools: toolsResult.tools,
        getApiKey: createApiKeyResolver(),
        label: 'scheduler',
      })

      try {
        await session.prompt(schedule.prompt)
        console.log(`[scheduler] "${schedule.name}" completed`)
      } finally {
        session.destroy()
        await toolsResult.cleanup()
      }
    } catch (error) {
      console.error(`[scheduler] Error in "${schedule.name}":`, error)
    } finally {
      this.executing.delete(schedule.id)
    }
  }
}
