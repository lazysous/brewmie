// Local-date helpers (audit brewmie-30). Built from local components so the assertions hold
// in any zone; the last test shows the old UTC slice disagrees whenever the zone is not UTC.
import { describe, it, expect } from 'vitest'
import { localDateKey, todayKey, parseLocalDate } from '../src/lib/dates'

describe('localDateKey', () => {
  it('formats the LOCAL calendar day of a Date, with zero padding', () => {
    expect(localDateKey(new Date(2026, 0, 5, 0, 30))).toBe('2026-01-05')
    expect(localDateKey(new Date(2026, 9, 21, 23, 59))).toBe('2026-10-21')
  })
  it('passes a date-only string through unchanged and parses ISO timestamps locally', () => {
    expect(localDateKey('2026-10-21')).toBe('2026-10-21')
    const d = new Date(2026, 9, 21, 0, 30)
    expect(localDateKey(d.toISOString())).toBe('2026-10-21')
    expect(localDateKey(d.getTime())).toBe('2026-10-21')
  })
  it('returns an empty string for garbage', () => {
    expect(localDateKey('nope')).toBe('')
  })
  it('differs from the old UTC slice around local midnight whenever the zone is not UTC', () => {
    const d = new Date(2026, 9, 21, 0, 30)
    const utcSlice = d.toISOString().slice(0, 10)
    if (d.getTimezoneOffset() !== 0) expect(utcSlice).not.toBe(localDateKey(d))
    else expect(utcSlice).toBe(localDateKey(d))
  })
})

describe('todayKey', () => {
  it('is the local day of the given instant', () => {
    expect(todayKey(new Date(2026, 1, 28, 1, 0))).toBe('2026-02-28')
  })
})

describe('parseLocalDate', () => {
  it('treats a date-only string as LOCAL midnight of that day', () => {
    const d = parseLocalDate('2026-10-21')!
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 9, 21, 0])
  })
  it('parses a full ISO timestamp as usual and rejects empty or invalid input', () => {
    expect(parseLocalDate('2026-10-21T10:00:00.000Z')!.getTime()).toBe(Date.parse('2026-10-21T10:00:00.000Z'))
    expect(parseLocalDate(null)).toBeNull()
    expect(parseLocalDate('')).toBeNull()
    expect(parseLocalDate('nope')).toBeNull()
  })
})
