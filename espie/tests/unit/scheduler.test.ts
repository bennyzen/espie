import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock node-cron before importing scheduler
const mockSchedule = vi.fn()
vi.mock('node-cron', () => ({
  default: {
    schedule: (...args: any[]) => mockSchedule(...args),
  },
  schedule: (...args: any[]) => mockSchedule(...args),
}))

// Mock device-registry
const mockGetAll = vi.fn()
vi.mock('../../server/utils/device-registry', () => ({
  deviceRegistry: {
    getAll: (...args: any[]) => mockGetAll(...args),
    get: vi.fn(),
  },
}))

// Mock agent-session
const mockPrompt = vi.fn()
const mockDestroy = vi.fn()
const mockSubscribe = vi.fn().mockReturnValue(() => {})
vi.mock('../../server/agent/agent-session', () => ({
  AgentSession: class MockAgentSession {
    prompt = mockPrompt
    destroy = mockDestroy
    subscribe = mockSubscribe
    constructor() {}
  },
}))

// Mock providers
vi.mock('../../server/providers/registry', () => ({
  createLLM: vi.fn().mockReturnValue({ model: 'mock-model' }),
  createEmbeddings: vi.fn().mockReturnValue({ embed: vi.fn(), dimensions: 384 }),
}))

// Mock config
vi.mock('../../server/utils/config', () => ({
  loadConfig: vi.fn().mockReturnValue({
    llm: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
    timezone: 'America/New_York',
  }),
  createApiKeyResolver: vi.fn().mockReturnValue(() => undefined),
}))

// Mock db
const mockPrepare = vi.fn().mockReturnValue({ run: vi.fn() })
vi.mock('../../server/utils/db', () => ({
  useDatabase: vi.fn().mockReturnValue({ prepare: (...args: any[]) => mockPrepare(...args) }),
}))

// Mock schedules data access
const mockGetEnabledSchedules = vi.fn()
const mockUpdateLastRunAt = vi.fn()
vi.mock('../../server/utils/schedules', () => ({
  getEnabledSchedules: (...args: any[]) => mockGetEnabledSchedules(...args),
  updateLastRunAt: (...args: any[]) => mockUpdateLastRunAt(...args),
}))

// Mock cron-matcher
const mockCronMatchesDate = vi.fn()
vi.mock('../../server/utils/cron-matcher', () => ({
  cronMatchesDate: (...args: any[]) => mockCronMatchesDate(...args),
}))

// Mock tool registry
const mockToolsCleanup = vi.fn().mockResolvedValue(undefined)
vi.mock('../../server/tools/registry', () => ({
  createSessionTools: vi.fn().mockResolvedValue({
    tools: [
      { name: 'say', label: 'say', description: 'mock say tool', execute: vi.fn() },
    ],
    memoryService: {},
    cleanup: () => mockToolsCleanup(),
  }),
}))

import { EspieScheduler } from '../../server/utils/scheduler'

describe('EspieScheduler', () => {
  let scheduler: EspieScheduler
  let capturedTick: Function

  beforeEach(() => {
    vi.clearAllMocks()
    mockSchedule.mockImplementation((_cron: string, callback: Function) => {
      capturedTick = callback
      return { stop: vi.fn() }
    })
    scheduler = new EspieScheduler()
  })

  afterEach(() => {
    scheduler.stop()
  })

  describe('start()', () => {
    it('registers a single minute-tick cron job', () => {
      scheduler.start()

      expect(mockSchedule).toHaveBeenCalledTimes(1)
      expect(mockSchedule).toHaveBeenCalledWith('* * * * *', expect.any(Function))
    })

    it('does not register twice if called again', () => {
      scheduler.start()
      scheduler.start()

      expect(mockSchedule).toHaveBeenCalledTimes(1)
    })
  })

  describe('stop()', () => {
    it('stops the minute-tick', () => {
      const mockStop = vi.fn()
      mockSchedule.mockReturnValue({ stop: mockStop })

      scheduler.start()
      scheduler.stop()

      expect(mockStop).toHaveBeenCalledTimes(1)
    })
  })

  describe('onTick behavior', () => {
    it('skips schedules that do not match the current time', async () => {
      mockGetEnabledSchedules.mockReturnValue([
        { id: 's1', name: 'morning', cron: '0 7 * * *', prompt: 'Hello', enabled: true, timezone: null },
      ])
      mockCronMatchesDate.mockReturnValue(false)

      scheduler.start()
      await capturedTick()

      expect(mockPrompt).not.toHaveBeenCalled()
    })

    it('executes matching schedules', async () => {
      mockGetEnabledSchedules.mockReturnValue([
        { id: 's1', name: 'morning', cron: '0 7 * * *', prompt: 'Good morning!', enabled: true, timezone: null },
      ])
      mockCronMatchesDate.mockReturnValue(true)
      mockGetAll.mockReturnValue([
        { deviceId: 'dev-1', transport: { sendText: vi.fn(), sendBinary: vi.fn() } },
      ])
      mockPrompt.mockResolvedValue('Good morning!')

      scheduler.start()
      await capturedTick()

      // Give the fire-and-forget promise time to resolve
      await new Promise(r => setTimeout(r, 10))

      expect(mockUpdateLastRunAt).toHaveBeenCalled()
      expect(mockPrompt).toHaveBeenCalledWith('Good morning!')
      expect(mockDestroy).toHaveBeenCalled()
      expect(mockToolsCleanup).toHaveBeenCalled()
    })

    it('skips when no devices connected', async () => {
      mockGetEnabledSchedules.mockReturnValue([
        { id: 's1', name: 'test', cron: '0 7 * * *', prompt: 'Hello', enabled: true, timezone: null },
      ])
      mockCronMatchesDate.mockReturnValue(true)
      mockGetAll.mockReturnValue([])

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      scheduler.start()
      await capturedTick()
      await new Promise(r => setTimeout(r, 10))

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('no device connected'))
      expect(mockPrompt).not.toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('handles errors without crashing', async () => {
      mockGetEnabledSchedules.mockReturnValue([
        { id: 's1', name: 'test', cron: '0 7 * * *', prompt: 'Hello', enabled: true, timezone: null },
      ])
      mockCronMatchesDate.mockReturnValue(true)
      mockGetAll.mockReturnValue([
        { deviceId: 'dev-1', transport: { sendText: vi.fn(), sendBinary: vi.fn() } },
      ])
      mockPrompt.mockRejectedValue(new Error('LLM down'))

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      scheduler.start()
      await capturedTick()
      await new Promise(r => setTimeout(r, 10))

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[scheduler]'),
        expect.any(Error),
      )
      consoleSpy.mockRestore()
    })
  })
})
