import { describe, it, expect } from 'vitest'
import { cronMatchesDate } from '../../server/utils/cron-matcher'

describe('cronMatchesDate', () => {
  // Wednesday, March 18, 2026 at 07:30
  const date = new Date(2026, 2, 18, 7, 30, 0) // getDay() = 3 (Wednesday)

  it('matches wildcard (* * * * *)', () => {
    expect(cronMatchesDate('* * * * *', date)).toBe(true)
  })

  it('matches exact minute and hour', () => {
    expect(cronMatchesDate('30 7 * * *', date)).toBe(true)
    expect(cronMatchesDate('0 7 * * *', date)).toBe(false)
    expect(cronMatchesDate('30 8 * * *', date)).toBe(false)
  })

  it('matches day-of-week (Wednesday = 3)', () => {
    expect(cronMatchesDate('30 7 * * 3', date)).toBe(true)
    expect(cronMatchesDate('30 7 * * 1', date)).toBe(false)
  })

  it('matches weekday range (1-5)', () => {
    expect(cronMatchesDate('30 7 * * 1-5', date)).toBe(true)
  })

  it('matches weekend list (0,6)', () => {
    expect(cronMatchesDate('30 7 * * 0,6', date)).toBe(false) // Wednesday
    // Saturday March 14, 2026 (getDay() = 6)
    const saturday = new Date(2026, 2, 14, 7, 30, 0)
    expect(cronMatchesDate('30 7 * * 0,6', saturday)).toBe(true)
  })

  it('matches step expressions (*/15)', () => {
    expect(cronMatchesDate('*/15 * * * *', date)).toBe(true) // 30 % 15 = 0
    expect(cronMatchesDate('*/10 * * * *', date)).toBe(true) // 30 % 10 = 0
    expect(cronMatchesDate('*/7 * * * *', date)).toBe(false) // 30 % 7 != 0
  })

  it('matches day-of-month', () => {
    expect(cronMatchesDate('30 7 18 * *', date)).toBe(true)
    expect(cronMatchesDate('30 7 19 * *', date)).toBe(false)
  })

  it('matches month', () => {
    expect(cronMatchesDate('30 7 * 3 *', date)).toBe(true) // March
    expect(cronMatchesDate('30 7 * 4 *', date)).toBe(false) // April
  })

  it('rejects invalid expressions', () => {
    expect(cronMatchesDate('bad expression', date)).toBe(false)
    expect(cronMatchesDate('* * *', date)).toBe(false)
  })

  it('handles timezone parameter', () => {
    // March 18, 2026 at 12:30 UTC
    const utcDate = new Date('2026-03-18T12:30:00Z')
    // In America/New_York (UTC-4 during DST), this is 8:30
    expect(cronMatchesDate('30 8 * * *', utcDate, 'America/New_York')).toBe(true)
    expect(cronMatchesDate('30 12 * * *', utcDate, 'America/New_York')).toBe(false)
    // In UTC, this is 12:30
    expect(cronMatchesDate('30 12 * * *', utcDate, 'UTC')).toBe(true)
  })
})
