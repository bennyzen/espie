// Minimal 5-field cron expression matcher with timezone support.
// Supports: *, ranges (1-5), lists (1,3,5), steps (*/15, 1-5/2).
// Does NOT support seconds or special strings (@daily etc).
// Used by the minute-tick scheduler to check which schedules fire at a given time.

export function cronMatchesDate(cronExpr: string, date: Date, timezone?: string): boolean {
  const parts = timezone ? getTimezoneParts(date, timezone) : getLocalParts(date)
  const fields = cronExpr.trim().split(/\s+/)
  if (fields.length !== 5) return false

  const [minute, hour, dom, month, dow] = fields as [string, string, string, string, string]
  return (
    fieldMatches(minute, parts.minute, 0, 59) &&
    fieldMatches(hour, parts.hour, 0, 23) &&
    fieldMatches(dom, parts.dom, 1, 31) &&
    fieldMatches(month, parts.month, 1, 12) &&
    fieldMatches(dow, parts.dow, 0, 7) // 0 and 7 both = Sunday
  )
}

interface DateParts {
  minute: number
  hour: number
  dom: number
  month: number
  dow: number
}

function getLocalParts(date: Date): DateParts {
  return {
    minute: date.getMinutes(),
    hour: date.getHours(),
    dom: date.getDate(),
    month: date.getMonth() + 1,
    dow: date.getDay(),
  }
}

function getTimezoneParts(date: Date, timezone: string): DateParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: 'numeric',
    day: 'numeric',
    month: 'numeric',
    weekday: 'short',
    hour12: false,
  })
  const p: Record<string, string> = {}
  for (const part of fmt.formatToParts(date)) {
    p[part.type] = part.value
  }
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return {
    minute: parseInt(p['minute'] || '0'),
    hour: parseInt(p['hour'] || '0') % 24,
    dom: parseInt(p['day'] || '1'),
    month: parseInt(p['month'] || '1'),
    dow: dowMap[p['weekday'] || 'Sun'] ?? 0,
  }
}

function fieldMatches(field: string, value: number, min: number, max: number): boolean {
  return field.split(',').some(part => partMatches(part.trim(), value, min, max))
}

function partMatches(part: string, value: number, min: number, max: number): boolean {
  const slashIdx = part.indexOf('/')
  const rangePart = slashIdx >= 0 ? part.slice(0, slashIdx) : part
  const step = slashIdx >= 0 ? parseInt(part.slice(slashIdx + 1)) : 1

  if (rangePart === '*') {
    return (value - min) % step === 0
  }

  if (rangePart.includes('-')) {
    const dashIdx = rangePart.indexOf('-')
    const lo = parseInt(rangePart.slice(0, dashIdx))
    const hi = parseInt(rangePart.slice(dashIdx + 1))
    if (value < lo || value > hi) return false
    return (value - lo) % step === 0
  }

  // Day-of-week: treat 7 as 0 (Sunday)
  const num = parseInt(rangePart)
  const normalizedValue = max === 7 && value === 7 ? 0 : value
  const normalizedNum = max === 7 && num === 7 ? 0 : num
  return normalizedNum === normalizedValue
}
