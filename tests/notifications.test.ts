// Characterisation suite for src/lib/notifications.ts.
// Mocks native (so schedule/cancel calls are recorded, not actually fired)
// and i18n's loadTranslations (so the no-t() path has a deterministic dict).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const TYPES = [
  'maintBackflush',
  'maintDescale',
  'maintGrinder',
  'dailyPing',
  'rateReminder',
  'beansPeak',
  'beansStale',
] as const

function buildDict() {
  const notifications: Record<string, Record<string, string>> = {}
  for (const type of TYPES) {
    const entry: Record<string, string> = {}
    for (let n = 1; n <= 3; n++) {
      entry[`title${n}`] = `${type} title ${n}`
      entry[`body${n}`] = `${type} body ${n}`
    }
    notifications[type] = entry
  }
  return { notifications }
}
const TEST_DICT = buildDict()

vi.mock('../src/lib/native', () => ({
  scheduleLocalNotification: vi.fn(async () => true),
  cancelLocalNotification: vi.fn(async () => {}),
}))

vi.mock('../src/lib/i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/i18n')>()
  return {
    ...actual,
    loadTranslations: vi.fn(async (locale: string) => (locale === 'en' ? TEST_DICT : null)),
  }
})

import { scheduleLocalNotification, cancelLocalNotification } from '../src/lib/native'
import {
  NOTIFICATION_IDS,
  pickVariant,
  scheduleMaintReminder,
  scheduleDailyPing,
  scheduleBeanReminders,
  rescheduleAllReminders,
} from '../src/lib/notifications'

const scheduleMock = scheduleLocalNotification as unknown as ReturnType<typeof vi.fn>
const cancelMock = cancelLocalNotification as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  scheduleMock.mockClear()
  cancelMock.mockClear()
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('NOTIFICATION_IDS', () => {
  it('has stable values', () => {
    expect(NOTIFICATION_IDS).toEqual({
      maintBackflush: 1001,
      maintDescale: 1002,
      maintGrinder: 1003,
      dailyPing: 1004,
      rateReminder: 1005,
      beansPeak: 1006,
      beansStale: 1007,
    })
  })
})

describe('pickVariant', () => {
  it('picks n in 1..3 from Math.random and passes the exact keys to t()', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0) // floor(0*3)+1 = 1
    const t = vi.fn((k: string) => `T:${k}`)
    const r1 = pickVariant('dailyPing', t)
    expect(r1).toEqual({ title: 'T:notifications.dailyPing.title1', body: 'T:notifications.dailyPing.body1' })
    expect(t).toHaveBeenCalledWith('notifications.dailyPing.title1')
    expect(t).toHaveBeenCalledWith('notifications.dailyPing.body1')

    vi.spyOn(Math, 'random').mockReturnValue(0.99) // floor(2.97)+1 = 3
    const r3 = pickVariant('beansPeak', t)
    expect(r3.title).toBe('T:notifications.beansPeak.title3')
    expect(r3.body).toBe('T:notifications.beansPeak.body3')

    vi.spyOn(Math, 'random').mockReturnValue(0.5) // floor(1.5)+1 = 2
    const r2 = pickVariant('maintGrinder', t)
    expect(r2.title).toBe('T:notifications.maintGrinder.title2')
    expect(r2.body).toBe('T:notifications.maintGrinder.body2')
  })

  it('with a t(), the translator receives the dotted key, never raw copy', () => {
    const t = vi.fn((k: string) => `translated(${k})`)
    const { title } = pickVariant('rateReminder', t)
    expect(title).toMatch(/^translated\(notifications\.rateReminder\.title[123]\)$/)
  })

  it('without t() and nothing cached yet, returns the raw key', async () => {
    // Fresh module instance so the module-private `cachedEn` has not been
    // warmed by any other test's call into getEnDict().
    vi.resetModules()
    const fresh = await import('../src/lib/notifications')
    vi.spyOn(Math, 'random').mockReturnValue(0) // n = 1
    const result = fresh.pickVariant('dailyPing')
    expect(result).toEqual({
      title: 'notifications.dailyPing.title1',
      body: 'notifications.dailyPing.body1',
    })
  })
})

describe('scheduleMaintReminder', () => {
  it('fires at 09:00 on the due day when the due day is still ahead and before 09:00', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-05T06:00:00'))
    const due = new Date('2026-10-05T15:00:00') // due later today
    await scheduleMaintReminder('maintBackflush', due, (k) => k)
    expect(scheduleMock).toHaveBeenCalledTimes(1)
    const call = scheduleMock.mock.calls[0][0]
    expect(call.id).toBe(1001)
    expect(call.at).toEqual(new Date('2026-10-05T09:00:00'))
  })

  it('bumps to 09:00 tomorrow when 09:00 today has already passed', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-05T10:00:00'))
    const due = new Date('2026-10-05T15:00:00') // due day is today, still ahead of "now"
    await scheduleMaintReminder('maintDescale', due)
    const call = scheduleMock.mock.calls[0][0]
    expect(call.id).toBe(1002)
    expect(call.at).toEqual(new Date('2026-10-06T09:00:00'))
  })

  it('bumps to 09:00 tomorrow when the due day itself is already past and it is also past 09:00', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-05T14:00:00'))
    const due = new Date('2026-10-03T00:00:00') // two days overdue
    await scheduleMaintReminder('maintGrinder', due)
    const call = scheduleMock.mock.calls[0][0]
    expect(call.id).toBe(1003)
    expect(call.at).toEqual(new Date('2026-10-06T09:00:00'))
  })

  // DEFECT per the function's own doc comment: "If the due day is already in
  // the past, fires at 09:00 the next morning." But the recovery branch only
  // re-anchors to a Date for *today*, then applies the same "already past
  // 09:00 today" bump check. When it's currently BEFORE 09:00 today, that
  // check doesn't trigger, so an overdue reminder actually fires TODAY at
  // 09:00, not "the next morning" as documented.
  // This test encodes the DOCUMENTED/intended behaviour and is expected to
  // FAIL against the current implementation -- see FINDINGS in the report.
  it('an overdue due day before 09:00 fires at 09:00 TODAY (the next nine o\'clock); the doc comment was corrected to say so', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-05T06:00:00')) // before 9am
    const due = new Date('2026-10-03T00:00:00') // overdue
    await scheduleMaintReminder('maintBackflush', due)
    const call = scheduleMock.mock.calls[0][0]
    expect(call.at).toEqual(new Date('2026-10-05T09:00:00'))
  })
})

describe('scheduleDailyPing', () => {
  it('schedules now + 24h under the stable dailyPing id', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-05T06:00:00.000Z'))
    await scheduleDailyPing((k) => k)
    expect(scheduleMock).toHaveBeenCalledTimes(1)
    const call = scheduleMock.mock.calls[0][0]
    expect(call.id).toBe(1004)
    expect(call.at).toEqual(new Date('2026-10-06T06:00:00.000Z'))
  })
})

describe('scheduleBeanReminders', () => {
  it('schedules peak (+7d) and stale (+30d) at 09:00 when both are in the future', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-05T06:00:00'))
    const roastDate = new Date('2026-10-01T00:00:00') // peak = Oct 8, stale = Oct 31
    await scheduleBeanReminders(roastDate, (k) => k)
    expect(scheduleMock).toHaveBeenCalledTimes(2)
    const peakCall = scheduleMock.mock.calls.find((c: any) => c[0].id === 1006)?.[0]
    const staleCall = scheduleMock.mock.calls.find((c: any) => c[0].id === 1007)?.[0]
    expect(peakCall.at).toEqual(new Date('2026-10-08T09:00:00'))
    expect(staleCall.at).toEqual(new Date('2026-10-31T09:00:00'))
  })

  it('skips a reminder whose computed date has already passed', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-05T06:00:00'))
    const roastDate = new Date('2026-09-20T00:00:00') // peak = Sep 27 (past), stale = Oct 20 (future)
    await scheduleBeanReminders(roastDate, (k) => k)
    expect(scheduleMock).toHaveBeenCalledTimes(1)
    expect(scheduleMock.mock.calls[0][0].id).toBe(1007)
  })
})

describe('rescheduleAllReminders', () => {
  it('cancels the five date-driven ids and reschedules from maintenance/roast dates, skipping nulls and invalid ISO', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-05T06:00:00'))
    const state: any = {
      maintenance: {
        lastBackflush: '2026-09-30T00:00:00.000Z', // +14d = Oct 14 (future) -> scheduled
        lastDescale: null, // skipped
        lastGrinderClean: 'not-a-real-date', // invalid ISO -> skipped
        shotsSinceBackflush: 0,
        shotsSinceDescale: 0,
      },
      beans: {
        brand: 'x',
        type: 'x',
        roastDate: '2026-10-03T00:00:00.000Z', // +7d = Oct 10, +30d = Nov 2 (both future)
        roastLevel: 'medium',
        beanAge: null,
      },
    }

    await rescheduleAllReminders(state, (k) => k)

    expect(cancelMock).toHaveBeenCalledTimes(5)
    expect(cancelMock.mock.calls.map((c: any) => c[0])).toEqual([1001, 1002, 1003, 1006, 1007])

    const scheduledIds = scheduleMock.mock.calls.map((c: any) => c[0].id).sort((a: number, b: number) => a - b)
    expect(scheduledIds).toEqual([1001, 1006, 1007]) // descale (null) and grinder (invalid) skipped
  })
})
