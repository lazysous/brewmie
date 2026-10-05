// Characterisation suite for the espresso dial-in algorithm in BrewScreen.tsx.
// These functions are module-private; vitest.config.ts's exposePrivatesForTests
// plugin appends an export list to the file at test time only (see smoke.test.ts).
//
// This is characterisation, not a spec: every expected number below was either
// hand-derived from the source (comments inline) or cross-checked against an
// independent re-implementation of the same formulas run outside the test
// harness. Where the code's own behaviour looked wrong against its own stated
// intent, the test still asserts the INTENDED behaviour and is left to fail,
// with a FINDING comment explaining the gap. See the two FINDING blocks below
// (personalTimeWindow recency, and dose reason-key vs net dose mismatch).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  computeScore,
  computeAdjustments,
  personalTimeWindow,
  beanAge,
  sameBagShots,
  median,
  defaultTargets,
  ROAST_TIME_OFFSET,
  ROAST_STARTING_POINT,
} from '../src/screens/BrewScreen'
import type { ShotEntry, BrewmieState, BeanConfig } from '../src/types'
import type { AlgoParams } from '../src/lib/supabase'

// ─── Fixture helpers (fill every field) ──────────────────────────────────────

let seq = 0
function makeShot(overrides: Partial<ShotEntry> = {}): ShotEntry {
  seq += 1
  return {
    id: `shot-${seq}`,
    timestamp: '2026-09-28T00:00:00.000Z',
    inputGrind: 15,
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
    beanAge: 0,
    roastLevel: 'medium',
    temp: null,
    humidity: null,
    ...overrides,
  }
}

function makeState(overrides: Partial<BrewmieState> = {}): BrewmieState {
  return {
    units: 'metric',
    machine: null,
    grinder: null,
    tamp: null,
    beans: null,
    currentGrind: null,
    shots: [],
    maintenance: {
      lastBackflush: null,
      lastDescale: null,
      lastGrinderClean: null,
      shotsSinceBackflush: 0,
      shotsSinceDescale: 0,
    },
    autoApplyAdjustments: false,
    userId: null,
    displayName: null,
    tier: 'free',
    ...overrides,
  }
}

function makeBeans(overrides: Partial<BeanConfig> = {}): BeanConfig {
  return {
    brand: 'Acme',
    type: 'Single Origin',
    roastDate: null,
    roastLevel: 'medium',
    beanAge: null,
    ...overrides,
  }
}

function makeAlgoParams(overrides: Partial<AlgoParams> = {}): AlgoParams {
  return {
    n: 0,
    time_window: 3,
    hum_hi: null,
    hum_lo: null,
    tmp_hi: null,
    tmp_lo: null,
    age_fresh: null,
    age_stale: null,
    ...overrides,
  }
}

// Named-argument wrapper around the 17-positional-parameter computeAdjustments,
// defaulted to a perfect-shot baseline (27s / 36ml / 18g dose / grind 15 /
// grinder range 0-30) so each test only states what it's varying.
type RecentAdjustment = { grindAdjust: number | null; doseAdjust: number | null }
interface AdjustArgs {
  actualTime: number
  actualVolume: number
  targetTime?: number
  targetVolume?: number
  inputDose?: number
  inputGrind?: number
  weather?: { temp: number; humidity: number } | null
  beanAgeDays?: number | null
  roastLevel?: string | null
  tasteFlavor?: 'sour' | 'balanced' | 'bitter' | null
  tasteStrength?: 'weak' | 'perfect' | 'strong' | null
  grinderMin?: number
  grinderMax?: number
  algoParams?: AlgoParams | null
  timeWindowOverride?: number | null
  recentAdjustments?: RecentAdjustment[]
  crema?: 'thin' | 'normal' | 'thick' | null
}
function adjust(a: AdjustArgs) {
  return computeAdjustments(
    a.actualTime,
    a.actualVolume,
    a.targetTime ?? 27,
    a.targetVolume ?? 36,
    a.inputDose ?? 18,
    a.inputGrind ?? 15,
    a.weather ?? null,
    a.beanAgeDays ?? null,
    a.roastLevel ?? null,
    a.tasteFlavor ?? null,
    a.tasteStrength ?? null,
    a.grinderMin ?? 0,
    a.grinderMax ?? 30,
    a.algoParams,
    a.timeWindowOverride,
    a.recentAdjustments,
    a.crema ?? null,
  )
}

// ─── computeScore ─────────────────────────────────────────────────────────────
// score = round(timeScore*0.4 + ratioScore*0.6), clamped to [0,100].
// timeScore: delta<=2 -> 100 | delta<=5 -> 100-(delta-2)*8 | else 70-(delta-5)*5
// ratioScore: same shape at thresholds 0.1 / 0.3, slopes 150 / 100.

describe('computeScore', () => {
  it('perfect shot (0 time delta, 0 ratio delta) scores exactly 100', () => {
    expect(computeScore(27, 36, 27, 36, 18)).toBe(100)
  })

  it.each([
    // actualTime, timeDelta, expected score (ratio held perfect at 36/18)
    [29, 2, 100],   // time band 1 boundary: delta<=2 -> timeScore 100
    [30, 3, 97],    // time band 2 interior: timeScore 92  -> 0.4*92+0.6*100=96.8 -> 97
    [32, 5, 90],    // time band 2 boundary: timeScore 76  -> 90.4 -> 90
    [33, 6, 86],    // time band 3: timeScore 65 -> 86
    [37, 10, 78],   // time band 3 far: timeScore 45 -> 78
  ])('time delta %i (%is over) -> score %i', (actualTime, _delta, expected) => {
    expect(computeScore(actualTime, 36, 27, 36, 18)).toBe(expected)
  })

  it.each([
    // dose=10, targetVolume=20 (targetRatio 2.0); actualVolume varies the ratio delta
    [20.0, 0.0, 100],  // exactly on ratio
    [22.0, 0.2, 91],   // ratio band interior: ratioScore 85 -> 91
    [23.0, 0.3, 82],   // ratio band boundary: ratioScore 70 -> 82
    [24.0, 0.4, 76],   // ratio band far: ratioScore 60 -> 76
  ])('ratio delta %p -> score %i', (actualVolume, _delta, expected) => {
    expect(computeScore(27, actualVolume, 27, 20, 10)).toBe(expected)
  })

  it('rounds a .5 weighted score up (Math.round half-away-from-zero for positives)', () => {
    // timeScore=100 (delta=1), ratioScore=92.5 (ratioDelta=0.15 on dose=10) -> weighted 95.5 -> 96
    expect(computeScore(28, 21.5, 27, 20, 10)).toBe(96)
  })

  it('clamps a wildly-off shot to 0, not a negative number', () => {
    // timeScore=-155, ratioScore=-100 -> weighted -122, clamped to 0
    expect(computeScore(77, 0, 27, 20, 10)).toBe(0)
  })

  it('inputDose=0 no longer produces NaN: the dose is floored to 1 like computeAdjustments does (fixed 2026-10-05)', () => {
    expect(computeScore(27, 36, 27, 36, 0)).toBe(100)
    expect(computeScore(27, 0, 27, 0, 0)).toBe(100)
    const off = computeScore(27, 40, 27, 36, 0)
    expect(Number.isFinite(off)).toBe(true)
    expect(off).toBeGreaterThanOrEqual(0)
    expect(off).toBeLessThanOrEqual(100)
  })
})

// ─── computeAdjustments ───────────────────────────────────────────────────────

describe('computeAdjustments: channelling and gusher guards', () => {
  it('channelling (long time + low yield) skips grind entirely: tamp +1, reasonChannelling', () => {
    const r = adjust({ actualTime: 35, actualVolume: 28 }) // timeDelta=8>3, volumeDelta=-8<-5
    expect(r.grindAdjust).toBe(0)
    expect(r.doseAdjust).toBe(0)
    expect(r.tampAdjust).toBe(1)
    expect(r.reasonKey).toBe('brew.reasonChannelling')
    expect(r.doseReasonKey).toBe('')
  })

  it('gusher (short time + high yield) also reads as reasonChannelling, not a separate key', () => {
    const r = adjust({ actualTime: 20, actualVolume: 44 }) // timeDelta=-7<-3, volumeDelta=8>5
    expect(r.grindAdjust).toBe(0)
    expect(r.doseAdjust).toBe(0)
    expect(r.tampAdjust).toBe(1)
    expect(r.reasonKey).toBe('brew.reasonChannelling')
  })
})

describe('computeAdjustments: quiet shot (driver stays none)', () => {
  it('no taste feedback -> grindAdjust 0, reasonOnTarget', () => {
    const r = adjust({ actualTime: 27, actualVolume: 36 })
    expect(r.grindAdjust).toBe(0)
    expect(r.tampAdjust).toBe(0)
    expect(r.reasonKey).toBe('brew.reasonOnTarget')
  })

  it("balanced taste feedback -> reasonBalanced (still grindAdjust 0)", () => {
    const r = adjust({ actualTime: 27, actualVolume: 36, tasteFlavor: 'balanced' })
    expect(r.grindAdjust).toBe(0)
    expect(r.reasonKey).toBe('brew.reasonBalanced')
  })
})

describe('computeAdjustments: flow driver (time + yield weighted speed signal)', () => {
  it('both time and yield strong, ran fast -> finer, reasonRanFastBoth {seconds, ml}', () => {
    // timeDelta=-5 (timeFrac -0.185, |.|>0.1), volumeDelta=+5 (yieldFrac 0.139, |.|>0.1, not >5 so no gusher)
    const r = adjust({ actualTime: 22, actualVolume: 41 })
    expect(r.grindAdjust).toBe(-0.5)
    expect(r.reasonKey).toBe('brew.reasonRanFastBoth')
    expect(r.reasonParams).toEqual({ seconds: 5, ml: 5 })
  })

  it('yield strong only, ran fast -> finer, reasonYieldOverFast {ml}', () => {
    const r = adjust({ actualTime: 27, actualVolume: 46 }) // timeDelta=0, volumeDelta=+10
    expect(r.grindAdjust).toBe(-0.5)
    expect(r.reasonKey).toBe('brew.reasonYieldOverFast')
    expect(r.reasonParams).toEqual({ ml: 10 })
  })

  it('time strong only, ran short -> finer, reasonRanShort {seconds}', () => {
    const r = adjust({ actualTime: 22, actualVolume: 36 }) // timeDelta=-5, volumeDelta=0
    expect(r.grindAdjust).toBe(-0.5)
    expect(r.reasonKey).toBe('brew.reasonRanShort')
    expect(r.reasonParams).toEqual({ seconds: 5 })
  })

  it('time-only ran short with a dark roast offset -> reasonRanShortRoast {seconds, roast}', () => {
    // roastOffset for dark is +4.0; actualTime 22 vs target 27 -> raw -5, timeDelta=-5-4=-9
    const r = adjust({ actualTime: 22, actualVolume: 36, roastLevel: 'dark' })
    expect(r.grindAdjust).toBe(-0.5)
    expect(r.reasonKey).toBe('brew.reasonRanShortRoast')
    expect(r.reasonParams).toEqual({ seconds: 9, roast: 'dark' })
  })

  it('time-only ran long with a light roast offset -> coarser, reasonRanLongRoast {seconds, roast}', () => {
    // roastOffset for light is -1.5; actualTime 35 vs target 27 -> raw +8, timeDelta=8-(-1.5)=9.5
    const r = adjust({ actualTime: 35, actualVolume: 36, roastLevel: 'light' })
    expect(r.grindAdjust).toBe(0.5)
    expect(r.reasonKey).toBe('brew.reasonRanLongRoast')
    expect(r.reasonParams).toEqual({ seconds: 10, roast: 'light' })
  })
})

describe('computeAdjustments: ROAST_TIME_OFFSET normalises timeDelta', () => {
  it('a dark roast running 4s long reads as exactly on target (offset cancels the delta)', () => {
    const r = adjust({ actualTime: 31, actualVolume: 36, roastLevel: 'dark' })
    expect(r.grindAdjust).toBe(0)
    expect(r.reasonKey).toBe('brew.reasonOnTarget')
  })

  it('ROAST_TIME_OFFSET table is pinned', () => {
    expect(ROAST_TIME_OFFSET).toEqual({
      light: -1.5, 'medium-light': -0.5, medium: 1.0, 'medium-dark': 0.0, dark: 4.0,
    })
  })
})

describe('computeAdjustments: taste as sole driver when flow is quiet', () => {
  it('sour -> -2% of range finer, bitter -> +2% of range coarser (range 30)', () => {
    const sour = adjust({ actualTime: 27, actualVolume: 36, tasteFlavor: 'sour' })
    expect(sour.grindAdjust).toBe(-0.5) // snap(30*-2/100) = snap(-0.6) = -0.5
    expect(sour.reasonKey).toBe('brew.reasonSour')

    const bitter = adjust({ actualTime: 27, actualVolume: 36, tasteFlavor: 'bitter' })
    expect(bitter.grindAdjust).toBe(0.5) // snap(30*2/100) = snap(0.6) = 0.5
    expect(bitter.reasonKey).toBe('brew.reasonBitter')
  })

  it('on a 50-range grinder, sour is exactly -1.0 and bitter is exactly +1.0', () => {
    const sour = adjust({ actualTime: 27, actualVolume: 36, tasteFlavor: 'sour', grinderMax: 50 })
    expect(sour.grindAdjust).toBe(-1.0)

    const bitter = adjust({ actualTime: 27, actualVolume: 36, tasteFlavor: 'bitter', grinderMax: 50 })
    expect(bitter.grindAdjust).toBe(1.0)
  })
})

describe('computeAdjustments: taste as a bias when flow already drives', () => {
  it('a sour bias (-0.5%) stacks onto an active flow signal and visibly changes the snapped step', () => {
    const baseline = adjust({ actualTime: 27, actualVolume: 59 }) // yieldFrac strong, no taste
    expect(baseline.grindAdjust).toBe(-0.5)
    expect(baseline.reasonKey).toBe('brew.reasonYieldOverFast')

    const withSourBias = adjust({ actualTime: 27, actualVolume: 59, tasteFlavor: 'sour' })
    expect(withSourBias.grindAdjust).toBe(-1.0) // bias pushes the raw % past the next 0.5 snap boundary
    expect(withSourBias.reasonKey).toBe('brew.reasonYieldOverFast') // reason key unaffected by the bias
    expect(withSourBias.reasonParams).toEqual({ ml: 23 })
  })
})

describe('computeAdjustments: bean age modifier (only applies when driver != none)', () => {
  // Driver forced via sour taste (-2%), range=100 so 1 unit == 1% for clean arithmetic.
  it.each([
    [1, -1.0],   // <=3 days: +1.0% -> -2+1=-1
    [5, -1.5],   // <=7 days: +0.5% -> -2+0.5=-1.5
    [45, -3.0],  // >=40 days: -1.0% -> -2-1=-3
    [25, -2.5],  // >=22 days: -0.5% -> -2-0.5=-2.5
    [15, -2.0],  // 8-21 days: no band matches, 0% contribution
  ])('beanAgeDays=%i -> grindAdjust %p', (beanAgeDays, expected) => {
    const r = adjust({ actualTime: 27, actualVolume: 36, tasteFlavor: 'sour', beanAgeDays, grinderMax: 100 })
    expect(r.grindAdjust).toBe(expected)
  })
})

describe('computeAdjustments: weather modifier (only applies when driver != none)', () => {
  it.each([
    [80, 20, -1.5],  // humidity>70: +0.5% -> -2+0.5=-1.5
    [30, 20, -2.5],  // humidity<40: -0.5% -> -2-0.5=-2.5
    [50, 30, -2.5],  // temp>28: -0.5%
    [50, 10, -1.5],  // temp<15: +0.5%
    [80, 30, -2.0],  // humidity>70 (+0.5) and temp>28 (-0.5) cancel -> net 0%
  ])('humidity=%i temp=%i -> grindAdjust %p', (humidity, temp, expected) => {
    const r = adjust({
      actualTime: 27, actualVolume: 36, tasteFlavor: 'sour',
      weather: { humidity, temp }, grinderMax: 100,
    })
    expect(r.grindAdjust).toBe(expected)
  })
})

describe('computeAdjustments: crema modifier (only applies when driver != none)', () => {
  it.each([
    ['thin', -2.5],   // -0.3% -> -2-0.3=-2.3 -> snap(-2.3)=-2.5
    ['thick', -1.5],  // +0.3% -> -2+0.3=-1.7 -> snap(-1.7)=-1.5
  ] as const)('crema=%s -> grindAdjust %p', (crema, expected) => {
    const r = adjust({ actualTime: 27, actualVolume: 36, tasteFlavor: 'sour', crema, grinderMax: 100 })
    expect(r.grindAdjust).toBe(expected)
  })

  it('modifiers contribute nothing while driver stays none, however extreme', () => {
    // Quiet flow, no taste signal: age/weather/crema here would be worth +1.7% if the
    // taste/flow driver were active, but modPct is forced to 0 when driver==='none'.
    const r = adjust({
      actualTime: 27, actualVolume: 36,
      beanAgeDays: 1, weather: { humidity: 80, temp: 10 }, crema: 'thin',
    })
    expect(r.grindAdjust).toBe(0)
    expect(r.reasonKey).toBe('brew.reasonOnTarget')
  })
})

describe('computeAdjustments: total percent clamp to +-5%', () => {
  it('a huge "ran fast" signal clamps to -5% -> reasonCapped, and suppresses tamp despite a huge ratio delta', () => {
    const r = adjust({ actualTime: 27, actualVolume: 112 }) // raw primaryGrindPct ~= -7.0
    expect(r.grindAdjust).toBe(-1.5) // snap(30*-5/100) = -1.5
    expect(r.reasonKey).toBe('brew.reasonCapped')
    expect(r.reasonParams).toEqual({ ml: 76, primaryKey: 'brew.reasonYieldOverFast' })
    expect(r.tampAdjust).toBe(0) // |grindAdjust|=1.5 > 0.5, tamp guard never fires
  })

  it('a huge "ran slow" signal clamps to +5% -> reasonCapped', () => {
    const r = adjust({ actualTime: 27, actualVolume: -40 })
    expect(r.grindAdjust).toBe(1.5)
    expect(r.reasonKey).toBe('brew.reasonCapped')
    expect(r.reasonParams).toEqual({ ml: 76, primaryKey: 'brew.reasonYieldUnderSlow' })
  })
})

describe('computeAdjustments: edge detection against grinder range', () => {
  it('proposed grind below grinderMin -> clamp to floor, dose +0.5, reasonGrindAtMin/doseGrindAtMin', () => {
    const r = adjust({ actualTime: 27, actualVolume: 36, tasteFlavor: 'sour', grinderMin: 14.7, grinderMax: 30 })
    expect(r.grindAdjust).toBe(-0.5) // snap(grinderMin - inputGrind) = snap(14.7-15) = snap(-0.3) = -0.5
    expect(r.doseAdjust).toBe(0.5)
    expect(r.reasonKey).toBe('brew.reasonGrindAtMin')
    expect(r.reasonParams).toEqual({ primaryKey: 'brew.reasonSour' })
    expect(r.doseReasonKey).toBe('brew.doseGrindAtMin')
  })

  it('proposed grind above grinderMax -> clamp to ceiling, dose -0.5, reasonGrindAtMax/doseGrindAtMax', () => {
    const r = adjust({ actualTime: 27, actualVolume: 36, tasteFlavor: 'bitter', grinderMin: 0, grinderMax: 15.3 })
    expect(r.grindAdjust).toBe(0.5) // snap(grinderMax - inputGrind) = snap(15.3-15) = snap(0.3) = 0.5
    expect(r.doseAdjust).toBe(-0.5)
    expect(r.reasonKey).toBe('brew.reasonGrindAtMax')
    expect(r.reasonParams).toEqual({ primaryKey: 'brew.reasonBitter' })
    expect(r.doseReasonKey).toBe('brew.doseGrindAtMax')
  })
})

describe('computeAdjustments: trend awareness', () => {
  it('two prior same-direction (finer) grind moves -> dose +0.5, doseTrendUp', () => {
    const r = adjust({
      actualTime: 27, actualVolume: 46,
      recentAdjustments: [{ grindAdjust: -1, doseAdjust: null }, { grindAdjust: -0.5, doseAdjust: null }],
    })
    expect(r.grindAdjust).toBe(-0.5)
    expect(r.doseAdjust).toBe(0.5)
    expect(r.doseReasonKey).toBe('brew.doseTrendUp')
  })

  it('two prior same-direction (coarser) grind moves -> dose -0.5, doseTrendDown', () => {
    const r = adjust({
      actualTime: 32, actualVolume: 36,
      recentAdjustments: [{ grindAdjust: 1, doseAdjust: null }, { grindAdjust: 0.5, doseAdjust: null }],
    })
    expect(r.grindAdjust).toBe(0.5)
    expect(r.doseAdjust).toBe(-0.5)
    expect(r.doseReasonKey).toBe('brew.doseTrendDown')
  })

  it('does not apply when this shot is already clamped at a grinder edge', () => {
    const withTrend = adjust({
      actualTime: 27, actualVolume: 36, tasteFlavor: 'sour', grinderMin: 14.7, grinderMax: 30,
      recentAdjustments: [{ grindAdjust: -1, doseAdjust: null }, { grindAdjust: -1, doseAdjust: null }],
    })
    // Identical to the edge-min test with no recentAdjustments at all: trend is skipped entirely.
    expect(withTrend.doseAdjust).toBe(0.5)
    expect(withTrend.doseReasonKey).toBe('brew.doseGrindAtMin')
  })

  it.each([
    ['only one recent adjustment', [{ grindAdjust: -1, doseAdjust: null }]],
    ['recent directions differ', [{ grindAdjust: -1, doseAdjust: null }, { grindAdjust: 1, doseAdjust: null }]],
    ['first recent grindAdjust is 0', [{ grindAdjust: 0, doseAdjust: null }, { grindAdjust: -1, doseAdjust: null }]],
    ['first recent grindAdjust is null', [{ grindAdjust: null, doseAdjust: null }, { grindAdjust: -1, doseAdjust: null }]],
  ] as [string, RecentAdjustment[]][])('does not apply when %s', (_label, recentAdjustments) => {
    const r = adjust({ actualTime: 27, actualVolume: 46, recentAdjustments })
    expect(r.doseAdjust).toBe(0)
    expect(r.doseReasonKey).toBe('')
  })
})

describe('computeAdjustments: reason wrap (cancelled / flipped)', () => {
  it('reasonCancelled when modifiers cancel primaryGrindPct to exactly 0 snapped units', () => {
    // sour (-2%) + age<=3 (+1.0%) + humidity>70,temp<15 (+0.5+0.5=+1.0%) = 0% exactly.
    const r = adjust({
      actualTime: 27, actualVolume: 36, tasteFlavor: 'sour',
      beanAgeDays: 1, weather: { humidity: 80, temp: 10 },
    })
    expect(r.grindAdjust).toBe(0)
    expect(r.reasonKey).toBe('brew.reasonCancelled')
    expect(r.reasonParams).toEqual({ primaryKey: 'brew.reasonSour' })
  })

  it('reasonFlipFiner when modifiers flip a positive (bitter) primary negative', () => {
    // bitter (+2%) + age>=40 (-1.0%) + humidity<40,temp>28 (-0.5-0.5=-1.0%) + crema thin (-0.3%) = -0.3% -> -0.5 units
    const r = adjust({
      actualTime: 27, actualVolume: 36, tasteFlavor: 'bitter',
      beanAgeDays: 45, weather: { humidity: 30, temp: 30 }, crema: 'thin', grinderMax: 100,
    })
    expect(r.grindAdjust).toBe(-0.5)
    expect(r.reasonKey).toBe('brew.reasonFlipFiner')
    expect(r.reasonParams).toEqual({ primaryKey: 'brew.reasonBitter' })
  })

  it('reasonFlipCoarser when modifiers flip a negative (sour) primary positive', () => {
    // sour (-2%) + age<=3 (+1.0%) + humidity>70,temp<15 (+1.0%) + crema thick (+0.3%) = +0.3% -> +0.5 units
    const r = adjust({
      actualTime: 27, actualVolume: 36, tasteFlavor: 'sour',
      beanAgeDays: 2, weather: { humidity: 80, temp: 10 }, crema: 'thick', grinderMax: 100,
    })
    expect(r.grindAdjust).toBe(0.5)
    expect(r.reasonKey).toBe('brew.reasonFlipCoarser')
    expect(r.reasonParams).toEqual({ primaryKey: 'brew.reasonSour' })
  })
})

describe('computeAdjustments: dose from taste strength', () => {
  it("weak alone -> dose +0.5 'doseWeak'; strong alone -> dose -0.5 'doseStrong'", () => {
    const weak = adjust({ actualTime: 27, actualVolume: 36, tasteStrength: 'weak' })
    expect(weak.doseAdjust).toBe(0.5)
    expect(weak.doseReasonKey).toBe('brew.doseWeak')

    const strong = adjust({ actualTime: 27, actualVolume: 36, tasteStrength: 'strong' })
    expect(strong.doseAdjust).toBe(-0.5)
    expect(strong.doseReasonKey).toBe('brew.doseStrong')
  })

  it('a cancelling taste-strength dose reports no dose reason (fixed 2026-10-05)', () => {
    const weakStacksEdge = adjust({
      actualTime: 27, actualVolume: 36, tasteFlavor: 'sour', tasteStrength: 'weak',
      grinderMin: 14.7, grinderMax: 30,
    })
    // Amount genuinely stacks: edge +0.5 and weak +0.5 add to 1.0.
    expect(weakStacksEdge.doseAdjust).toBe(1.0)
    expect(weakStacksEdge.doseReasonKey).toBe('brew.doseGrindAtMin')

    const strongCancelsEdge = adjust({
      actualTime: 27, actualVolume: 36, tasteFlavor: 'sour', tasteStrength: 'strong',
      grinderMin: 14.7, grinderMax: 30,
    })
    // Edge +0.5 and strong -0.5 cancel to a net dose change of 0 ...
    expect(strongCancelsEdge.doseAdjust).toBe(0)
    // ... and the reason now agrees with the number (fixed 2026-10-05). It used to
    // keep the edge reason, telling the user the dose was bumped because the grind
    // hit the floor while the dose field showed 0.
    expect(strongCancelsEdge.doseReasonKey).toBe('')
  })

  it('stacks with a trend dose in the same direction (both push dose up)', () => {
    const r = adjust({
      actualTime: 27, actualVolume: 46, tasteStrength: 'weak',
      recentAdjustments: [{ grindAdjust: -1, doseAdjust: null }, { grindAdjust: -0.5, doseAdjust: null }],
    })
    expect(r.doseAdjust).toBe(1.0) // trend +0.5 + weak +0.5
    expect(r.doseReasonKey).toBe('brew.doseTrendUp') // trend's key wins (set first)
  })
})

describe('computeAdjustments: tamp', () => {
  it('ratio far over target with a small grind nudge -> tampAdjust +1; far under -> -1', () => {
    // Both cases cancel the flow speedSignal via matched time/yield fractions so the
    // sour taste signal alone drives grind (-0.5), isolating the tamp condition.
    const over = adjust({ actualTime: 32, actualVolume: 46, tasteFlavor: 'sour' })
    expect(over.grindAdjust).toBe(-0.5)
    expect(over.tampAdjust).toBe(1)

    const under = adjust({ actualTime: 22, actualVolume: 26, tasteFlavor: 'sour' })
    expect(under.grindAdjust).toBe(-0.5)
    expect(under.tampAdjust).toBe(-1)
  })
})

describe('computeAdjustments: algoParams gating and timeWindowOverride', () => {
  it('n<30 is ignored (prior time_window=3); n>=30 uses the real time_window; an explicit override beats both', () => {
    // Fixed inputs: timeDelta=4 (just above the default window of 3), volumeDelta=-6.
    const ignoredLowN = adjust({
      actualTime: 31, actualVolume: 30,
      algoParams: makeAlgoParams({ n: 29, time_window: 10 }),
    })
    // n=29 < MIN_SHOTS_TO_LEARN(30): time_window=10 is ignored, falls back to 3.
    // timeDelta(4) > 3 and volumeDelta(-6) < -5 -> channelling guard fires.
    expect(ignoredLowN.reasonKey).toBe('brew.reasonChannelling')

    const usedHighN = adjust({
      actualTime: 31, actualVolume: 30,
      algoParams: makeAlgoParams({ n: 30, time_window: 10 }),
    })
    // n=30 >= 30: time_window=10 is used. timeDelta(4) is not > 10, so no channelling;
    // the wider window also raises speedNoise enough that the flow driver stays quiet.
    expect(usedHighN.reasonKey).toBe('brew.reasonOnTarget')
    expect(usedHighN.grindAdjust).toBe(0)

    const overridden = adjust({
      actualTime: 31, actualVolume: 30,
      algoParams: makeAlgoParams({ n: 30, time_window: 10 }),
      timeWindowOverride: 3,
    })
    // Even with n=30's time_window=10 available, an explicit override of 3 wins,
    // reproducing the channelling result from the n=29 case.
    expect(overridden.reasonKey).toBe('brew.reasonChannelling')
  })
})

describe('computeAdjustments: grinder range of 0 or negative is treated as 1', () => {
  it.each([
    ['grinderMin === grinderMax (range 0)', 10, 10],
    ['grinderMin > grinderMax (range negative)', 10, 5],
  ])('%s -> Math.max(1, ...) floors the range, so -2%% of range snaps to (negative) 0 units', (_label, grinderMin, grinderMax) => {
    const r = adjust({ actualTime: 27, actualVolume: 36, tasteFlavor: 'sour', grinderMin, grinderMax })
    // snap(1 * -2/100) = snap(-0.02) = -0 units (Math.round(-0.04) preserves sign) ->
    // primaryGrindPct(-2) != 0 but grindAdjust === -0, which is still === 0 for the
    // reasonCancelled check (uses === , and -0 === 0 is true) but toBe/Object.is tells them apart.
    expect(r.grindAdjust).toBe(-0)
    expect(Object.is(r.grindAdjust, -0)).toBe(true)
    expect(r.reasonKey).toBe('brew.reasonCancelled')
    expect(r.reasonParams).toEqual({ primaryKey: 'brew.reasonSour' })
  })
})

// ─── personalTimeWindow ───────────────────────────────────────────────────────
// Bayesian blend: result = wUser*max(1,personalStd) + (1-wUser)*populationWindow,
// wUser = n/(n+8), over up to 20 usable (actualTime & targetTime both non-null) deltas.

describe('personalTimeWindow', () => {
  it('fewer than 3 usable deltas returns the population window untouched', () => {
    expect(personalTimeWindow([], 3)).toBe(3)
    const twoShots = [makeShot({ actualTime: 30, targetTime: 27 }), makeShot({ actualTime: 28, targetTime: 27 })]
    expect(personalTimeWindow(twoShots, 3)).toBe(3)
  })

  it('null actualTime/targetTime entries are skipped and do not count toward the 3-delta floor', () => {
    // 5 array entries, only 3 have both fields non-null -> n=3, real computation (not fallback).
    const shots = [
      makeShot({ actualTime: null, targetTime: 27 }),
      makeShot({ actualTime: 28, targetTime: 27 }),       // delta 1
      makeShot({ actualTime: null, targetTime: null }),
      makeShot({ actualTime: 29, targetTime: 27 }),       // delta 2
      makeShot({ actualTime: 30, targetTime: 27 }),       // delta 3
    ]
    // deltas collected oldest-to-scan-start as [3,2,1], mean=2, variance=2/3, std floor not hit.
    const expected = (3 / 11) * Math.max(1, Math.sqrt(2 / 3)) + (8 / 11) * 4
    expect(personalTimeWindow(shots, 4)).toBeCloseTo(expected, 10)
  })

  it('computes the exact n/(n+8) blend with the std floor of 1 when variance is 0', () => {
    const shots = [
      makeShot({ actualTime: 28, targetTime: 27 }),
      makeShot({ actualTime: 28, targetTime: 27 }),
      makeShot({ actualTime: 28, targetTime: 27 }),
    ]
    // n=3, mean=1, variance=0, personalStd=max(1,0)=1, wUser=3/11
    expect(personalTimeWindow(shots, 5)).toBeCloseTo((3 / 11) * 1 + (8 / 11) * 5, 10)
  })

  it('computes the exact blend with a real (non-floored) standard deviation', () => {
    const shots = [
      makeShot({ actualTime: 25, targetTime: 27 }),
      makeShot({ actualTime: 27, targetTime: 27 }),
      makeShot({ actualTime: 29, targetTime: 27 }),
    ]
    // deltas [2,0,-2] (scan order), mean=0, variance=8/3, std=sqrt(8/3), wUser=3/11
    const expected = (3 / 11) * Math.sqrt(8 / 3) + (8 / 11) * 3
    expect(personalTimeWindow(shots, 3)).toBeCloseTo(expected, 10)
  })

  it('the n/(n+8) weight shifts toward the personal signal as n grows (n=5, wUser=5/13)', () => {
    const shots = Array.from({ length: 5 }, () => makeShot({ actualTime: 27, targetTime: 27 }))
    expect(personalTimeWindow(shots, 10)).toBeCloseTo((5 / 13) * 1 + (8 / 13) * 10, 10)
  })

  it('with more than 20 usable shots it uses the NEWEST 20 (fixed 2026-10-05)', () => {
    // shots[0] is the most recent (ADD_SHOT prepends: `[action.payload, ...state.shots]`),
    // shots[length-1] is the oldest. The scan loop runs `for (i = shots.length-1; i>=0; i--)`,
    // i.e. it starts at the OLDEST shot and walks toward the newest, stopping once it has
    // collected 20 deltas. With 25 shots this consumes indices 24..5 (the oldest 20) and
    // never reaches indices 4..0 (the 5 most recent). That inverts the stated intent of a
    // "personal" time window, which should weight RECENT variability, not stale shots.
    const wildRecentDeltas = [999, -999, 500, -500, 777] // indices 0-4: the 5 most recent
    const shots = [
      ...wildRecentDeltas.map((d) => makeShot({ actualTime: 27 + d, targetTime: 27 })),
      ...Array.from({ length: 20 }, () => makeShot({ actualTime: 34, targetTime: 27 })), // indices 5-24: oldest 20, delta=7 each
    ]
    // Intended (newest-recency) behaviour: the 5 wild recent deltas should dominate the
    // variance and pull the result far from a population window of 3 (it would be ~280).
    // Actual behaviour: those 5 are never scanned; only the constant-7 oldest 20 are used,
    // giving variance 0, personalStd floored to 1, wUser=20/28=5/7, and a small, boring result.
    // Fixed 2026-10-05: the scan now starts at shots[0]. The five wild recent
    // deltas plus fifteen of the constant ones form the window, so the result
    // is far above the population window of 3.
    const actual = personalTimeWindow(shots, 3)
    expect(actual).toBeGreaterThan(100)
    // And an all-constant recent window still blends toward the floor of 1.
    const calm = Array.from({ length: 25 }, () => makeShot({ actualTime: 34, targetTime: 27 }))
    expect(personalTimeWindow(calm, 3)).toBeCloseTo((20 / 28) * 1 + (8 / 28) * 3, 10)
  })

  it('with exactly 20 usable shots there is no ambiguity: all 20 are used', () => {
    const shots = Array.from({ length: 20 }, (_, i) => makeShot({ actualTime: 27 + i, targetTime: 27 }))
    // deltas 0..19 (20 consecutive integers): mean=9.5, variance=(20^2-1)/12=33.25
    const expected = (20 / 28) * Math.sqrt(33.25) + (8 / 28) * 3
    expect(personalTimeWindow(shots, 3)).toBeCloseTo(expected, 10)
  })
})

// ─── beanAge ──────────────────────────────────────────────────────────────────

describe('beanAge', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('an explicit override always wins, including 0 (not treated as falsy/absent)', () => {
    expect(beanAge('2026-01-01', 5)).toBe(5)
    expect(beanAge('2026-01-01', 0)).toBe(0)
    expect(beanAge(null, 0)).toBe(0)
  })

  it('null roastDate with no override returns null', () => {
    expect(beanAge(null, null)).toBeNull()
  })

  it('a roast exactly 10 days ago returns 10', () => {
    vi.setSystemTime(new Date('2026-10-05T00:00:00.000Z'))
    expect(beanAge('2026-09-25T00:00:00.000Z', null)).toBe(10)
  })

  it('floors toward zero on fractional days in either direction (truncates, never rounds)', () => {
    vi.setSystemTime(new Date('2026-10-05T12:00:00.000Z'))
    expect(beanAge('2026-09-25T00:00:00.000Z', null)).toBe(10) // 10.5 days -> 10
    vi.setSystemTime(new Date('2026-10-05T00:00:00.000Z'))
    expect(beanAge('2026-09-25T12:00:00.000Z', null)).toBe(9) // 9.5 days -> 9
  })
})

// ─── median ───────────────────────────────────────────────────────────────────

describe('median', () => {
  it('empty array returns NaN', () => {
    expect(median([])).toBeNaN()
  })

  it('single-element array returns that element', () => {
    expect(median([5])).toBe(5)
  })

  it('odd-length array returns the sorted middle element', () => {
    expect(median([3, 1, 2])).toBe(2)
  })

  it('even-length array returns the average of the two sorted middle elements', () => {
    expect(median([4, 1, 3, 2])).toBe(2.5)
  })

  it('does not mutate the input array (sorts a copy)', () => {
    const arr = [5, 3, 1, 4, 2]
    median(arr)
    expect(arr).toEqual([5, 3, 1, 4, 2])
  })
})

// ─── sameBagShots ─────────────────────────────────────────────────────────────

describe('sameBagShots', () => {
  it('returns [] when there is no bean config, or beans has no brand', () => {
    expect(sameBagShots([makeShot()], null)).toEqual([])
    expect(sameBagShots([makeShot()], makeBeans({ brand: '' }))).toEqual([])
  })

  it('includes a shot matching roastLevel and within the 2-day roastDate window', () => {
    const beans = makeBeans({ roastLevel: 'medium', roastDate: '2026-09-28T00:00:00.000Z' })
    // shot taken 3 days after roast, with beanAge=3 -> shotRoast reconstructs to exactly bagRoast
    const shot = makeShot({ roastLevel: 'medium', timestamp: '2026-10-01T00:00:00.000Z', beanAge: 3 })
    expect(sameBagShots([shot], beans)).toEqual([shot])
  })

  it('excludes a shot with a different roastLevel even if the date would match', () => {
    const beans = makeBeans({ roastLevel: 'medium', roastDate: '2026-09-28T00:00:00.000Z' })
    const shot = makeShot({ roastLevel: 'dark', timestamp: '2026-09-28T00:00:00.000Z', beanAge: 0 })
    expect(sameBagShots([shot], beans)).toEqual([])
  })

  it('excludes a same-roastLevel shot whose reconstructed roast date is more than 2 days off', () => {
    const beans = makeBeans({ roastLevel: 'medium', roastDate: '2026-09-28T00:00:00.000Z' })
    // beanAge=3 days off from what the timestamp would need to land within the window
    const shot = makeShot({ roastLevel: 'medium', timestamp: '2026-09-28T00:00:00.000Z', beanAge: -3 })
    expect(sameBagShots([shot], beans)).toEqual([])
  })

  it('a null roastDate on the bag skips the date-proximity check entirely', () => {
    const beans = makeBeans({ roastLevel: 'medium', roastDate: null })
    const shot = makeShot({ roastLevel: 'medium', beanAge: 999 }) // would fail any proximity check
    expect(sameBagShots([shot], beans)).toEqual([shot])
  })
})

// ─── defaultTargets ───────────────────────────────────────────────────────────

describe('defaultTargets', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('with no equipment configured: grind 15, dose 18, volume 36.0, time 27, tamp 50', () => {
    expect(defaultTargets(makeState())).toEqual({ grind: 15, dose: 18, volume: 36, time: 27, tamp: 50 })
  })

  it.each([
    ['light', 34.2, 30],
    ['medium-light', 35.1, 28],
    ['medium', 36.0, 27],
    ['medium-dark', 36.9, 26],
    ['dark', 37.8, 25],
  ] as const)('roast level %s seeds volume %p and time %i (dose 18 fallback)', (roastLevel, volume, time) => {
    const r = defaultTargets(makeState({ beans: makeBeans({ roastLevel }) }))
    expect(r.volume).toBe(volume)
    expect(r.time).toBe(time)
  })

  it('state.currentGrind wins outright over the grinder-range estimate', () => {
    const r = defaultTargets(makeState({
      currentGrind: 20,
      grinder: { type: 'conical-burr', brand: 'x', model: 'y', minSetting: 0, maxSetting: 30 },
    }))
    expect(r.grind).toBe(20)
  })

  it('without currentGrind, falls back to min + (max-min)*grindPct rounded to the nearest 0.5', () => {
    const r = defaultTargets(makeState({
      grinder: { type: 'conical-burr', brand: 'x', model: 'y', minSetting: 5, maxSetting: 36 },
      beans: makeBeans({ roastLevel: 'dark' }), // grindPct 0.60
    }))
    // raw = 5 + 31*0.60 = 23.6 -> round(23.6*2)/2 = 23.5
    expect(r.grind).toBe(23.5)
  })

  it('machine.basketSize sets dose and scales volume; tamp.level passes through untouched', () => {
    const r1 = defaultTargets(makeState({ machine: { brand: 'Other', model: 'x', basketSize: 20, basketType: 'VST', shotTemp: 93 } }))
    expect(r1.dose).toBe(20)
    expect(r1.volume).toBe(40.0) // 20 * 2.0 ratio

    const r2 = defaultTargets(makeState({
      tamp: { type: 'manual', level: 75, springPressure: null, springMin: null, springMax: null, autoPressure: null, autoMin: null, autoMax: null },
    }))
    expect(r2.tamp).toBe(75)
  })

  it('2+ rated same-bag shots seed grind/volume/time from the median of the best-scoring half', () => {
    // "now" within 6h of the shots' timestamps so the cold-machine +1s does not contaminate this.
    vi.setSystemTime(new Date('2026-09-28T02:00:00.000Z'))
    const beans = makeBeans({ roastLevel: 'medium', roastDate: '2026-09-28T00:00:00.000Z' })
    const shotFixed = { roastLevel: 'medium' as const, timestamp: '2026-09-28T00:00:00.000Z', beanAge: 0 }
    const shots = [
      makeShot({ ...shotFixed, score: 95, inputGrind: 18, actualVolume: 40, actualTime: 24 }),
      makeShot({ ...shotFixed, score: 85, inputGrind: 16, actualVolume: 38, actualTime: 22 }),
      // Bottom half (lower scores) must NOT influence the median:
      makeShot({ ...shotFixed, score: 50, inputGrind: 5, actualVolume: 10, actualTime: 5 }),
      makeShot({ ...shotFixed, score: 40, inputGrind: 5, actualVolume: 10, actualTime: 5 }),
    ]
    const r = defaultTargets(makeState({ beans, shots }))
    // top 2 by score: inputGrind [18,16]->median 17, actualVolume [40,38]->median 39, actualTime [24,22]->median 23
    expect(r.grind).toBe(17)
    expect(r.volume).toBe(39.0)
    expect(r.time).toBe(23.0)
  })

  it('fewer than 2 rated same-bag shots does not seed anything (roast-table defaults stand)', () => {
    vi.setSystemTime(new Date('2026-09-28T02:00:00.000Z'))
    const beans = makeBeans({ roastLevel: 'medium', roastDate: '2026-09-28T00:00:00.000Z' })
    const shots = [makeShot({ roastLevel: 'medium', timestamp: '2026-09-28T00:00:00.000Z', beanAge: 0, score: 95, inputGrind: 18, actualVolume: 40, actualTime: 24 })]
    const r = defaultTargets(makeState({ beans, shots }))
    expect(r).toEqual({ grind: 15, dose: 18, volume: 36, time: 27, tamp: 50 })
  })

  it('a cold machine (last shot >6h ago) adds 1s to time; exactly 6h does not (strict >)', () => {
    const now = new Date('2026-10-05T12:00:00.000Z')
    vi.setSystemTime(now)
    const cold = defaultTargets(makeState({ shots: [makeShot({ timestamp: '2026-10-05T05:00:00.000Z' })] })) // 7h gap
    expect(cold.time).toBe(28.0)
    const notCold = defaultTargets(makeState({ shots: [makeShot({ timestamp: '2026-10-05T06:00:00.000Z' })] })) // exactly 6h
    expect(notCold.time).toBe(27.0)
  })

  it('ROAST_STARTING_POINT table is pinned', () => {
    expect(ROAST_STARTING_POINT).toEqual({
      light: { grindPct: 0.40, ratio: 1.9, time: 30 },
      'medium-light': { grindPct: 0.45, ratio: 1.95, time: 28 },
      medium: { grindPct: 0.50, ratio: 2.0, time: 27 },
      'medium-dark': { grindPct: 0.55, ratio: 2.05, time: 26 },
      dark: { grindPct: 0.60, ratio: 2.1, time: 25 },
    })
  })
})
