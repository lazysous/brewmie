// Characterisation suite for the pure stat helpers in InsightsScreen.tsx.
// These are module-private; vitest.config.ts's exposePrivatesForTests plugin
// appends an export list to the file at test time only (see tests/smoke.test.ts).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  groupShotsByDate,
  getFirstShots,
  avgScore,
  optimalGrind,
  stdDev,
  consistencyKey,
  dialInDays,
  adjustmentLabel,
} from '../src/screens/InsightsScreen'
import type { ShotEntry } from '../src/types'

let seq = 0
function makeShot(overrides: Partial<ShotEntry> = {}): ShotEntry {
  seq += 1
  return {
    id: `shot-${seq}`,
    timestamp: '2026-10-01T08:00:00.000Z',
    inputGrind: 5,
    inputDose: 18,
    inputTamp: 50,
    targetVolume: 36,
    targetTime: 27,
    actualVolume: 36,
    actualTime: 27,
    score: null,
    grindAdjust: null,
    doseAdjust: null,
    volumeAdjust: null,
    timeAdjust: null,
    tampAdjust: null,
    crema: null,
    tasteFlavor: null,
    tasteStrength: null,
    beanAge: null,
    roastLevel: null,
    temp: null,
    humidity: null,
    ...overrides,
  }
}

describe('groupShotsByDate', () => {
  it('groups by the first 10 characters of the timestamp', () => {
    const a = makeShot({ timestamp: '2026-10-01T08:00:00.000Z' })
    const b = makeShot({ timestamp: '2026-10-01T20:30:00.000Z' })
    const c = makeShot({ timestamp: '2026-10-02T09:00:00.000Z' })
    const map = groupShotsByDate([a, b, c])
    expect(map.size).toBe(2)
    expect(map.get('2026-10-01')).toEqual([a, b])
    expect(map.get('2026-10-02')).toEqual([c])
  })
})

describe('getFirstShots', () => {
  it('returns the earliest shot per day even though shots are stored newest-first', () => {
    const early = makeShot({ timestamp: '2026-10-01T07:00:00.000Z' })
    const late = makeShot({ timestamp: '2026-10-01T19:00:00.000Z' })
    // Stored newest-first, matching how the real app appends shots.
    expect(getFirstShots([late, early])).toEqual([early])
  })

  it('returns one shot per distinct day', () => {
    const day1early = makeShot({ timestamp: '2026-10-01T07:00:00.000Z' })
    const day1late = makeShot({ timestamp: '2026-10-01T19:00:00.000Z' })
    const day2only = makeShot({ timestamp: '2026-10-02T12:00:00.000Z' })
    const result = getFirstShots([day2only, day1late, day1early])
    expect(result).toHaveLength(2)
    expect(result).toEqual(expect.arrayContaining([day1early, day2only]))
  })
})

describe('avgScore', () => {
  it('ignores null scores', () => {
    const shots = [makeShot({ score: 80 }), makeShot({ score: null }), makeShot({ score: 90 })]
    expect(avgScore(shots)).toBe(85)
  })

  it('returns null when there are no rated shots', () => {
    expect(avgScore([])).toBeNull()
    expect(avgScore([makeShot({ score: null }), makeShot({ score: null })])).toBeNull()
  })
})

describe('optimalGrind', () => {
  it('returns null when no shot scores >= 85', () => {
    const shots = [makeShot({ score: 84, inputGrind: 5 }), makeShot({ score: null, inputGrind: 5 })]
    expect(optimalGrind(shots)).toBeNull()
  })

  it('returns the mode grind (rounded to 0.1) among score >= 85 shots only', () => {
    const shots = [
      makeShot({ score: 90, inputGrind: 5.03 }), // rounds to 5.0
      makeShot({ score: 95, inputGrind: 5.04 }), // rounds to 5.0
      makeShot({ score: 88, inputGrind: 6.0 }),
      makeShot({ score: 70, inputGrind: 9.0 }), // below threshold, excluded entirely
    ]
    expect(optimalGrind(shots)).toBe(5)
  })

  it('breaks a tie by averaging ALL high-scoring shots, rounded to 0.1', () => {
    const shots = [makeShot({ score: 90, inputGrind: 5.0 }), makeShot({ score: 95, inputGrind: 6.0 })]
    // freq(5.0)=1, freq(6.0)=1 -> tie -> average of 5.0 and 6.0 = 5.5
    expect(optimalGrind(shots)).toBe(5.5)
  })
})

describe('stdDev', () => {
  it('computes the population standard deviation', () => {
    expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBe(2)
  })

  it('returns 0 for an empty array', () => {
    expect(stdDev([])).toBe(0)
  })
})

describe('consistencyKey', () => {
  it('returns NoData with fewer than 2 rated shots', () => {
    expect(consistencyKey([])).toBe('insights.consistencyNoData')
    expect(consistencyKey([makeShot({ score: 90 }), makeShot({ score: null })])).toBe(
      'insights.consistencyNoData'
    )
  })

  it('returns High when sd <= 3', () => {
    const shots = [makeShot({ score: 90 }), makeShot({ score: 90 })] // sd = 0
    expect(consistencyKey(shots)).toBe('insights.consistencyHigh')
  })

  it('returns Medium when 3 < sd <= 6', () => {
    const shots = [makeShot({ score: 90 }), makeShot({ score: 80 })] // sd = 5
    expect(consistencyKey(shots)).toBe('insights.consistencyMedium')
  })

  it('returns Low when sd > 6', () => {
    const shots = [makeShot({ score: 100 }), makeShot({ score: 50 })] // sd = 25
    expect(consistencyKey(shots)).toBe('insights.consistencyLow')
  })
})

describe('dialInDays', () => {
  it('returns null with fewer than 2 shots', () => {
    expect(dialInDays([])).toBeNull()
    expect(dialInDays([makeShot()])).toBeNull()
  })

  it('returns null when the span rounds to 0 days (same day)', () => {
    const shots = [
      makeShot({ timestamp: '2026-10-01T08:00:00.000Z' }),
      makeShot({ timestamp: '2026-10-01T10:00:00.000Z' }),
    ]
    expect(dialInDays(shots)).toBeNull()
  })

  it('rounds the day span between the earliest and latest shot', () => {
    const roundDown = [
      makeShot({ timestamp: '2026-10-01T00:00:00.000Z' }),
      makeShot({ timestamp: '2026-10-03T10:00:00.000Z' }), // 2.4167 days -> 2
    ]
    expect(dialInDays(roundDown)).toBe(2)

    const roundUp = [
      makeShot({ timestamp: '2026-10-01T00:00:00.000Z' }),
      makeShot({ timestamp: '2026-10-03T14:00:00.000Z' }), // 2.5833 days -> 3
    ]
    expect(dialInDays(roundUp)).toBe(3)
  })
})

describe('adjustmentLabel', () => {
  it('null grindAdjust -> onTarget / neutral', () => {
    expect(adjustmentLabel(makeShot({ grindAdjust: null }))).toEqual({
      textKey: 'insights.adjOnTarget',
      positive: false,
      neutral: true,
    })
  })

  it('negative grindAdjust -> grindDown', () => {
    expect(adjustmentLabel(makeShot({ grindAdjust: -1 }))).toEqual({
      textKey: 'insights.adjGrindDown',
      positive: false,
      neutral: false,
    })
  })

  it('positive grindAdjust -> grindUp', () => {
    expect(adjustmentLabel(makeShot({ grindAdjust: 1 }))).toEqual({
      textKey: 'insights.adjGrindUp',
      positive: true,
      neutral: false,
    })
  })

  it('zero grindAdjust -> onTarget / neutral, same as null', () => {
    expect(adjustmentLabel(makeShot({ grindAdjust: 0 }))).toEqual({
      textKey: 'insights.adjOnTarget',
      positive: false,
      neutral: true,
    })
  })
})

describe('free-tier 30-day window (InsightsScreen.tsx lines 274-282, replicated)', () => {
  // Exact replica of the component's filter expression.
  function visibleFor(allShots: ShotEntry[], isFree: boolean): ShotEntry[] {
    const cutoffMs = Date.now() - 30 * 24 * 60 * 60 * 1000
    return isFree ? allShots.filter((s) => new Date(s.timestamp).getTime() >= cutoffMs) : allShots
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-05T12:00:00.000Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('hides a 31-day-old shot and shows a 29-day-old shot for a free user', () => {
    const old31 = makeShot({ timestamp: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString() })
    const old29 = makeShot({ timestamp: new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString() })
    expect(visibleFor([old31, old29], true)).toEqual([old29])
  })

  it('hides nothing for a premium user', () => {
    const old31 = makeShot({ timestamp: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString() })
    const old29 = makeShot({ timestamp: new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString() })
    expect(visibleFor([old31, old29], false)).toEqual([old31, old29])
  })
})
