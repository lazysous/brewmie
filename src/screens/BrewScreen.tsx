import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import type { BrewmieState, AppAction, ShotEntry } from '../types'
import type { AlgoParams } from '../lib/supabase'
import { useTranslation } from '../hooks/useTranslation'
import { useTier } from '../hooks/useTier'
import { PremiumModal } from '../components/PremiumModal'
import { maybeRequestReview, brewTap, shotSavedHaptic, scheduleLocalNotification } from '../lib/native'
import { track } from '../lib/analytics'
import type { TParams } from '../lib/i18n'

// ─── Types ────────────────────────────────────────────────────────────────────

// idle      — recipe targets card, BREW button armed
// countdown — 3-2-1 before the timer starts
// logging   — timer running OR stopped (time + volume editable inline)
// taste     — rating wizard ONLY (crema · flavour · strength), no results yet
// rated     — score + insights + coaching + apply CTAs
type BrewPhase = 'idle' | 'countdown' | 'brewing' | 'logging' | 'taste' | 'rated'

interface BrewTargets {
  grind: number
  dose: number
  volume: number
  time: number
  tamp: number
}

interface LoggedActuals {
  volume: number
  time: number
}

interface ShotResult {
  score: number
  grindAdjust: number
  doseAdjust: number
  volumeAdjust: number
  timeAdjust: number
  tampAdjust: number
  actuals: LoggedActuals
  reasonKey: string
  reasonParams?: TParams
  doseReasonKey: string
  doseReasonParams?: TParams
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface BrewScreenProps {
  state: BrewmieState
  dispatch: React.Dispatch<AppAction>
  onNavigateToSetup: () => void
  onSignIn: () => void
  weather: { temp: number; humidity: number } | null
  algoParams?: AlgoParams | null
}

// ─── Score count-up component ────────────────────────────────────────────────

function ScoreCountUp({ value }: { value: number }) {
  const [display, setDisplay] = useState(0)
  useEffect(() => {
    setDisplay(0)
    const duration = 620
    const start = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay(Math.round(eased * value))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value])
  return <>{display}</>
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function computeScore(
  actualTime: number,
  actualVolume: number,
  targetTime: number,
  targetVolume: number,
  inputDose: number
): number {
  const timeDelta = Math.abs(actualTime - targetTime)
  let timeScore: number
  if (timeDelta <= 2) {
    timeScore = 100
  } else if (timeDelta <= 5) {
    timeScore = 100 - (timeDelta - 2) * 8
  } else {
    timeScore = 70 - (timeDelta - 5) * 5
  }

  const actualRatio = actualVolume / inputDose
  const targetRatio = targetVolume / inputDose
  const ratioDelta = Math.abs(actualRatio - targetRatio)
  let ratioScore: number
  if (ratioDelta <= 0.1) {
    ratioScore = 100
  } else if (ratioDelta <= 0.3) {
    ratioScore = 100 - (ratioDelta - 0.1) * 150
  } else {
    ratioScore = 70 - (ratioDelta - 0.3) * 100
  }

  return Math.max(0, Math.min(100, Math.round(timeScore * 0.4 + ratioScore * 0.6)))
}

// ─── Data-driven adjustment helpers ──────────────────────────────────────────

// Minimum community shots before we trust algo population params
const MIN_SHOTS_TO_LEARN = 30

// Roast-level time offsets derived from 19,546 Visualizer.coffee community shots.
// Normalises timeDelta so a dark roast running 4s long isn't misread as a grind problem.
const ROAST_TIME_OFFSET: Record<string, number> = {
  'light':        -1.5,  // avg 30.6s — lighter beans less dense, faster flow
  'medium-light': -0.5,
  'medium':        1.0,  // avg 33.1s
  'medium-dark':   0.0,  // avg 32.1s — baseline
  'dark':          4.0,  // avg 36.1s — darker beans more soluble, runs long
}

// Mapping: speed deviation → grind percentage of range.
// Calibrated so a 24% speed deviation (e.g. 8s short on 27s + 6ml over on 36ml)
// produces ~2% of range — one full step on a 50-range Niche.
const GRIND_GAIN = 8.3

// Time and yield both signal flow speed, but time is the more reliable physical
// signal (yield is influenced by puck swelling, beverage absorption, channelling).
const TIME_WEIGHT = 0.6
const YIELD_WEIGHT = 0.4

interface ComputeResult {
  grindAdjust: number   // in actual grinder units (positive = coarser)
  doseAdjust: number    // in grams (positive = more dose)
  volumeAdjust: number
  timeAdjust: number
  tampAdjust: number
  reasonKey: string             // i18n key for grind explanation
  reasonParams?: TParams
  doseReasonKey: string         // i18n key for dose explanation; '' = no dose hint
  doseReasonParams?: TParams
}

interface RecentAdjustment {
  grindAdjust: number | null
  doseAdjust: number | null
}

// Algorithm: proportional, multi-signal recommendation.
//
//   1. Channelling guard — long time + low yield = prep issue, not grind.
//   2. Combined flow signal (time + yield, weighted) drives grind magnitude.
//   3. Taste sour/bitter biases the move; becomes the sole driver if flow is quiet.
//   4. Bean age + weather modify the result.
//   5. If grind would push past grinder range, surplus flows into dose.
//   6. If last 2 shots already moved grind same direction, dose takes over.
//   7. Tamp fires when ratio is materially off and grind only needs a small nudge.
function computeAdjustments(
  actualTime: number,
  actualVolume: number,
  targetTime: number,
  targetVolume: number,
  inputDose: number,
  inputGrind: number,
  weather: { temp: number; humidity: number } | null,
  beanAgeDays: number | null,
  roastLevel: string | null,
  tasteFlavor: 'sour' | 'balanced' | 'bitter' | null,
  tasteStrength: 'weak' | 'perfect' | 'strong' | null,
  grinderMin: number,
  grinderMax: number,
  algoParams?: AlgoParams | null,
  timeWindowOverride?: number | null,
  recentAdjustments?: RecentAdjustment[],
): ComputeResult {
  const range = Math.max(1, grinderMax - grinderMin)
  // Grind snaps to 0.5 (physical dial resolution on most domestic grinders);
  // dose snaps to 0.1g (scale resolution).
  const GRIND_STEP = 0.5
  const DOSE_STEP = 0.1
  const snapGrind = (units: number) => Math.round(units / GRIND_STEP) * GRIND_STEP
  const snapDose = (g: number) => Math.round(g / DOSE_STEP) * DOSE_STEP
  const pctToUnits = (p: number) => snapGrind(range * p / 100)

  const p = (algoParams && algoParams.n >= MIN_SHOTS_TO_LEARN) ? algoParams : null
  const prior = p?.time_window ?? 3
  const timeWindow = (timeWindowOverride !== null && timeWindowOverride !== undefined)
    ? timeWindowOverride
    : prior

  // ── Deviations (absolute and proportional) ────────────────────────────────
  const roastOffset = roastLevel ? (ROAST_TIME_OFFSET[roastLevel] ?? 0) : 0
  const timeDelta = (actualTime - targetTime) - roastOffset
  const volumeDelta = actualVolume - targetVolume
  const safeTime = Math.max(targetTime, 15)
  const safeVol = Math.max(targetVolume, 18)
  const timeFrac = timeDelta / safeTime          // negative = ran short (fast)
  const yieldFrac = volumeDelta / safeVol        // positive = over-yielded (fast)

  // Combined speed signal: positive = ran too fast (want finer / more dose).
  const speedSignal = -TIME_WEIGHT * timeFrac + YIELD_WEIGHT * yieldFrac

  // Noise floor scales with personal time variability — small misses get "hold".
  const speedNoise = Math.max(0.05, (timeWindow / safeTime) * TIME_WEIGHT)

  // ── Channelling guard ─────────────────────────────────────────────────────
  // Long time + low yield together = puck integrity, not grind.
  const channelling = timeDelta > timeWindow && volumeDelta < -5

  if (channelling) {
    return {
      grindAdjust: 0,
      doseAdjust: 0,
      volumeAdjust: 0,
      timeAdjust: 0,
      tampAdjust: 1,                // firmer / more even tamp + redistribute
      reasonKey: 'brew.reasonChannelling',
      doseReasonKey: '',
    }
  }

  // ── Primary grind signal from flow ────────────────────────────────────────
  let primaryGrindPct = 0
  let primaryKey = ''
  let primaryParams: TParams | undefined
  let driver: 'flow' | 'taste' | 'none' = 'none'

  if (Math.abs(speedSignal) > speedNoise) {
    primaryGrindPct = -speedSignal * GRIND_GAIN
    driver = 'flow'

    const tooFast = speedSignal > 0
    const yieldStrong = Math.abs(yieldFrac) > 0.10
    const timeStrong = Math.abs(timeFrac) > 0.10
    const secs = Math.round(Math.abs(timeDelta))
    const ml = Math.round(Math.abs(volumeDelta))

    if (yieldStrong && timeStrong) {
      primaryKey = tooFast ? 'brew.reasonRanFastBoth' : 'brew.reasonRanSlowBoth'
      primaryParams = { seconds: secs, ml }
    } else if (yieldStrong) {
      primaryKey = tooFast ? 'brew.reasonYieldOverFast' : 'brew.reasonYieldUnderSlow'
      primaryParams = { ml }
    } else {
      const usingRoast = roastOffset !== 0 && roastLevel
      if (tooFast) {
        primaryKey = usingRoast ? 'brew.reasonRanShortRoast' : 'brew.reasonRanShort'
        primaryParams = usingRoast ? { seconds: secs, roast: roastLevel } : { seconds: secs }
      } else {
        primaryKey = usingRoast ? 'brew.reasonRanLongRoast' : 'brew.reasonRanLong'
        primaryParams = usingRoast ? { seconds: secs, roast: roastLevel } : { seconds: secs }
      }
    }
  }

  // ── Taste flavour: sole driver if flow is quiet, otherwise a small bias ───
  let tasteBiasPct = 0
  if (tasteFlavor === 'sour') {
    if (driver === 'none') {
      primaryGrindPct = -2     // ~1 step finer on Niche
      driver = 'taste'
      primaryKey = 'brew.reasonSour'
    } else {
      tasteBiasPct = -0.5
    }
  } else if (tasteFlavor === 'bitter') {
    if (driver === 'none') {
      primaryGrindPct = 2
      driver = 'taste'
      primaryKey = 'brew.reasonBitter'
    } else {
      tasteBiasPct = 0.5
    }
  } else if (driver === 'none') {
    primaryKey = tasteFlavor === 'balanced' ? 'brew.reasonBalanced' : 'brew.reasonOnTarget'
  }

  // ── Bean age + weather modifiers (% of range, additive) ───────────────────
  let agePct = 0
  if (beanAgeDays !== null) {
    if (beanAgeDays <= 3)       agePct =  1.0
    else if (beanAgeDays <= 7)  agePct =  0.5
    else if (beanAgeDays >= 40) agePct = -1.0
    else if (beanAgeDays >= 22) agePct = -0.5
  }

  let weatherPct = 0
  if (weather) {
    if (weather.humidity > 70)      weatherPct += 0.5
    else if (weather.humidity < 40) weatherPct -= 0.5
    if (weather.temp > 28)          weatherPct -= 0.5
    else if (weather.temp < 15)     weatherPct += 0.5
  }

  const modPct = (driver === 'none') ? 0 : agePct + weatherPct
  const rawTotalPct = primaryGrindPct + tasteBiasPct + modPct
  const totalPct = Math.max(-5, Math.min(5, rawTotalPct))
  let grindAdjust = pctToUnits(totalPct)

  // ── Edge detection: if grind would exceed range, surplus → dose ──────────
  let flowDoseAdjust = 0
  let edgeKey: 'min' | 'max' | null = null
  if (grindAdjust !== 0) {
    const proposed = inputGrind + grindAdjust
    if (grindAdjust < 0 && proposed < grinderMin) {
      grindAdjust = snapGrind(grinderMin - inputGrind)   // clamp to floor
      flowDoseAdjust = 0.5
      edgeKey = 'min'
    } else if (grindAdjust > 0 && proposed > grinderMax) {
      grindAdjust = snapGrind(grinderMax - inputGrind)
      flowDoseAdjust = -0.5
      edgeKey = 'max'
    }
  }

  // ── Trend awareness: persistent same-direction grind → reach for dose ────
  // If the last 2 shots both moved grind the same way as this one, we've been
  // chasing — supplement with dose instead of yet another grind step.
  if (
    edgeKey === null &&
    driver === 'flow' &&
    grindAdjust !== 0 &&
    recentAdjustments && recentAdjustments.length >= 2
  ) {
    const dir = Math.sign(grindAdjust)
    const sameWay = recentAdjustments.slice(0, 2).every((a) =>
      a.grindAdjust !== null && a.grindAdjust !== 0 && Math.sign(a.grindAdjust) === dir
    )
    if (sameWay && flowDoseAdjust === 0) {
      flowDoseAdjust = (dir < 0) ? 0.5 : -0.5
    }
  }

  // ── Honest reason wrap (cancelled / flipped / capped / edge) ─────────────
  let reasonKey = primaryKey
  let reasonParams: TParams | undefined = primaryParams
  if (driver !== 'none') {
    const wrap = (wrapperKey: string) => {
      reasonKey = wrapperKey
      reasonParams = { ...(primaryParams ?? {}), primaryKey }
    }
    if (edgeKey === 'min') {
      wrap('brew.reasonGrindAtMin')
    } else if (edgeKey === 'max') {
      wrap('brew.reasonGrindAtMax')
    } else if (primaryGrindPct !== 0 && grindAdjust === 0) {
      wrap('brew.reasonCancelled')
    } else if (primaryGrindPct > 0 && grindAdjust < 0) {
      wrap('brew.reasonFlipFiner')
    } else if (primaryGrindPct < 0 && grindAdjust > 0) {
      wrap('brew.reasonFlipCoarser')
    } else if (rawTotalPct !== totalPct) {
      wrap('brew.reasonCapped')
    }
  }

  // ── Dose from taste strength (stacks with flow-driven dose) ──────────────
  let doseAdjust = flowDoseAdjust
  let doseReasonKey = ''
  let doseReasonParams: TParams | undefined
  if (edgeKey === 'min') {
    doseReasonKey = 'brew.doseGrindAtMin'
  } else if (edgeKey === 'max') {
    doseReasonKey = 'brew.doseGrindAtMax'
  } else if (flowDoseAdjust !== 0) {
    doseReasonKey = flowDoseAdjust > 0 ? 'brew.doseTrendUp' : 'brew.doseTrendDown'
  }
  if (tasteStrength === 'weak') {
    doseAdjust += 0.5
    if (!doseReasonKey) doseReasonKey = 'brew.doseWeak'
  } else if (tasteStrength === 'strong') {
    doseAdjust -= 0.5
    if (!doseReasonKey) doseReasonKey = 'brew.doseStrong'
  }
  doseAdjust = snapDose(doseAdjust)

  // ── Tamp: ratio is off and grind only needs a small nudge (≤0.5 step) ────
  const actualRatio = actualVolume / Math.max(inputDose, 1)
  const targetRatio = targetVolume / Math.max(inputDose, 1)
  const ratioDelta = Math.abs(actualRatio - targetRatio)
  const tampAdjust = (Math.abs(grindAdjust) <= 0.5 && ratioDelta > 0.4)
    ? (actualRatio > targetRatio ? 1 : -1)
    : 0

  return {
    grindAdjust,
    doseAdjust,
    volumeAdjust: 0,
    timeAdjust: 0,
    tampAdjust,
    reasonKey,
    reasonParams,
    doseReasonKey,
    doseReasonParams,
  }
}

// Bayesian blend personal time stddev with population time_window.
// weight_user = n/(n+8); requires actualTime + targetTime present.
function personalTimeWindow(shots: ShotEntry[], populationWindow: number): number {
  const deltas: number[] = []
  for (let i = shots.length - 1; i >= 0 && deltas.length < 20; i--) {
    const s = shots[i]
    if (s.actualTime !== null && s.targetTime !== null) {
      deltas.push(s.actualTime - s.targetTime)
    }
  }
  const n = deltas.length
  if (n < 3) return populationWindow
  const mean = deltas.reduce((a, b) => a + b, 0) / n
  const variance = deltas.reduce((a, b) => a + (b - mean) ** 2, 0) / n
  const personalStd = Math.max(1, Math.sqrt(variance))
  const wUser = n / (n + 8)
  return wUser * personalStd + (1 - wUser) * populationWindow
}

function scoreColor(score: number): string {
  if (score >= 95) return 'var(--copper)'
  if (score >= 85) return 'var(--accent-green)'
  if (score >= 70) return '#6B7280'
  return '#8B1A1A'
}

function scoreTierKey(score: number): string {
  if (score >= 95) return 'brew.scorePerfect'
  if (score >= 85) return 'brew.scoreExcellent'
  if (score >= 70) return 'brew.scoreGood'
  return 'brew.scoreNeedsWork'
}

const TAMP_STEPS: { labelKey: string; value: number }[] = [
  { labelKey: 'brew.tampSoft', value: 25 },
  { labelKey: 'brew.tampMid',  value: 50 },
  { labelKey: 'brew.tampFirm', value: 75 },
]

function beanAge(roastDate: string | null, beanAgeOverride: number | null): number | null {
  if (beanAgeOverride !== null) return beanAgeOverride
  if (!roastDate) return null
  const roast = new Date(roastDate)
  const now = new Date()
  return Math.floor((now.getTime() - roast.getTime()) / (1000 * 60 * 60 * 24))
}

function defaultTargets(state: BrewmieState): BrewTargets {
  const grind = state.currentGrind ?? (state.grinder ? Math.round((state.grinder.minSetting + state.grinder.maxSetting) / 2) : 15)
  const dose = state.machine?.basketSize ?? 18
  const volume = dose * 2
  const time = 27
  const tamp = state.tamp?.level ?? 50
  return { grind, dose, volume, time, tamp }
}

// Row config — split into recipe vs targets
type AdjustKey = 'grindAdjust' | 'doseAdjust' | 'volumeAdjust' | 'timeAdjust' | 'tampAdjust'
interface RowConfig {
  key: keyof BrewTargets
  labelKey: string
  unit: string
  step: number        // big stepper ±
  fineStep: number    // small stepper ±
  decimals: number    // display precision
  adjustKey: AdjustKey
  section: 'recipe' | 'targets'
}

const ROWS: RowConfig[] = [
  { key: 'grind',  labelKey: 'brew.labelGrind',  unit: '',   step: 1, fineStep: 0.5, decimals: 1, adjustKey: 'grindAdjust',  section: 'recipe'  },
  { key: 'dose',   labelKey: 'brew.labelDose',   unit: 'g',  step: 1, fineStep: 0.1, decimals: 1, adjustKey: 'doseAdjust',   section: 'recipe'  },
  { key: 'tamp',   labelKey: 'brew.labelTamp',   unit: '',   step: 25, fineStep: 25, decimals: 0, adjustKey: 'tampAdjust',   section: 'recipe'  },
  { key: 'volume', labelKey: 'brew.labelVolume', unit: 'ml', step: 1, fineStep: 0.1, decimals: 1, adjustKey: 'volumeAdjust', section: 'targets' },
  { key: 'time',   labelKey: 'brew.labelTime',   unit: 's',  step: 1, fineStep: 0.1, decimals: 1, adjustKey: 'timeAdjust',   section: 'targets' },
]

const RECIPE_ROWS = ROWS.filter((r) => r.section === 'recipe')
const TARGET_ROWS = ROWS.filter((r) => r.section === 'targets')

// ─── Sub-components ───────────────────────────────────────────────────────────

// ─── Main Component ───────────────────────────────────────────────────────────

export function BrewScreen({ state, dispatch, onNavigateToSetup, onSignIn, weather, algoParams }: BrewScreenProps) {
  const { t } = useTranslation()
  useTier(state)

  const [premiumTrigger, setPremiumTrigger] = useState<'grinder' | 'tamper' | 'beans' | 'history' | 'benchmarks' | null>(null)

  // ── Derived defaults from state. Persisted to localStorage so the user's
  // in-progress recipe survives tab switches (the screen unmounts) and full
  // reloads. Falls back to defaultTargets(state) when storage is empty or
  // contains a different shape.
  const TARGETS_KEY = 'brewmie_active_targets_v1'
  const initTargets = useCallback((): BrewTargets => {
    try {
      const raw = localStorage.getItem(TARGETS_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<BrewTargets>
        const seed = defaultTargets(state)
        return {
          grind:  Number.isFinite(parsed.grind  as number) ? parsed.grind  as number : seed.grind,
          dose:   Number.isFinite(parsed.dose   as number) ? parsed.dose   as number : seed.dose,
          tamp:   Number.isFinite(parsed.tamp   as number) ? parsed.tamp   as number : seed.tamp,
          volume: Number.isFinite(parsed.volume as number) ? parsed.volume as number : seed.volume,
          time:   Number.isFinite(parsed.time   as number) ? parsed.time   as number : seed.time,
        }
      }
    } catch {}
    return defaultTargets(state)
  }, [])
  const [targets, setTargets] = useState<BrewTargets>(initTargets)
  useEffect(() => {
    try { localStorage.setItem(TARGETS_KEY, JSON.stringify(targets)) } catch {}
  }, [targets])

  // ── Phase
  const [phase, setPhase] = useState<BrewPhase>('idle')

  // ── Card display state: 'targets' or 'results'
  const [cardState, setCardState] = useState<'targets' | 'results'>('targets')
  const [cardVisible, setCardVisible] = useState(true)

  // ── Logging (inline timer panel)
  const [manualTime, setManualTime] = useState('')

  // ── Timer
  const [timerRunning, setTimerRunning] = useState(false)
  const [timerSecs, setTimerSecs] = useState(0)
  const [timerStopped, setTimerStopped] = useState(false)
  const [timerVolume, setTimerVolume] = useState('')
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timerStartRef = useRef<number | null>(null)

  // ── Countdown (3-2-1 before the timer starts)
  const [countdown, setCountdown] = useState<number>(0)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Result
  const [result, setResult] = useState<ShotResult | null>(null)

  // ── Saved shot id (for taste update)
  const [savedShotId, setSavedShotId] = useState<string | null>(null)

  // ── Raw actuals stored after save so taste can trigger live recompute
  const [rawActuals, setRawActuals] = useState<{ time: number; volume: number } | null>(null)

  // ── Taste feedback state
  const [crema, setCrema] = useState<'thin' | 'normal' | 'thick' | null>(null)
  const [tasteFlavor, setTasteFlavor] = useState<'sour' | 'balanced' | 'bitter' | null>(null)
  const [tasteStrength, setTasteStrength] = useState<'weak' | 'perfect' | 'strong' | null>(null)

  // ── Validation
  const [brewError, setBrewError] = useState<string | null>(null)

  // ── Brew button timer ref
  const brewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ─── Computed bean info ──────────────────────────────────────────────────────
  const beans = state.beans
  const age = beans ? beanAge(beans.roastDate, beans.beanAge) : null

  // Bayesian-blended time window: personal stddev (last ~20 shots) blended with population prior.
  const blendedTimeWindow = useMemo(() => {
    const populationWindow = (algoParams && algoParams.n >= MIN_SHOTS_TO_LEARN) ? algoParams.time_window : 3
    return personalTimeWindow(state.shots, populationWindow)
  }, [state.shots, algoParams])

  // ─── Target adjust helpers ───────────────────────────────────────────────────
  // Per-key snap resolution. Grind snaps to 0.5 (physical dial granularity);
  // dose/volume/time snap to 0.1 (scale + timer precision); tamp stays whole.
  function snapForKey(key: keyof BrewTargets, n: number): number {
    if (key === 'grind') return Math.round(n * 2) / 2
    if (key === 'tamp')  return Math.round(n)
    return Math.round(n * 10) / 10
  }
  function clampForKey(key: keyof BrewTargets, n: number): number {
    if (key === 'dose')   return Math.max(5, Math.min(30, n))
    if (key === 'volume') return Math.max(10, Math.min(120, n))
    if (key === 'time')   return Math.max(10, Math.min(60, n))
    if (key === 'tamp')   return Math.max(0, Math.min(100, n))
    if (key === 'grind')  {
      const min = state.grinder?.minSetting ?? 1
      const max = state.grinder?.maxSetting ?? 40
      return Math.max(min, Math.min(max, n))
    }
    return n
  }
  function adjustTarget(key: keyof BrewTargets, delta: number) {
    setTargets((prev) => ({ ...prev, [key]: snapForKey(key, clampForKey(key, prev[key] + delta)) }))
  }
  function setTargetValue(key: keyof BrewTargets, n: number) {
    if (!Number.isFinite(n)) return
    setTargets((prev) => ({ ...prev, [key]: snapForKey(key, clampForKey(key, n)) }))
  }

  // ─── Validation ──────────────────────────────────────────────────────────────
  function validate(): string | null {
    const ratio = targets.volume / targets.dose
    if (ratio < 1 || ratio > 4.5) {
      return t('brew.errorRatio', { ratio: ratio.toFixed(1) })
    }
    if (targets.time < 15 || targets.time > 45) {
      return t('brew.errorTime', { time: targets.time })
    }
    return null
  }

  // Render a reason composed of a primary key + optional wrapper.
  // ComputeAdjustments returns reasonKey (possibly a wrapper) with reasonParams
  // that may contain {primaryKey} pointing to the inner reason to render first.
  function renderReason(reasonKey: string, reasonParams?: TParams): string {
    if (!reasonKey) return ''
    const params = reasonParams ?? {}
    const innerKey = typeof params.primaryKey === 'string' ? params.primaryKey : null
    if (innerKey) {
      const inner = t(innerKey, params)
      return t(reasonKey, { ...params, primary: inner })
    }
    return t(reasonKey, params)
  }

  // ─── Card transition helper ──────────────────────────────────────────────────
  function transitionCard(to: 'targets' | 'results') {
    setCardVisible(false)
    setTimeout(() => {
      setCardState(to)
      setCardVisible(true)
    }, 180)
  }

  // ─── BREW tap → 3-2-1 countdown → timer ─────────────────────────────────────
  function handleBrew() {
    const err = validate()
    if (err) {
      setBrewError(err)
      setTimeout(() => setBrewError(null), 3000)
      return
    }
    setBrewError(null)
    setResult(null)
    setManualTime('')
    // Default actual volume to the target so the user only adjusts deltas
    // with +/- buttons (no typing required).
    setTimerVolume(String(targets.volume))
    setTimerSecs(0)
    setTimerStopped(false)
    setPhase('countdown')
    brewTap()
    startCountdown()
  }

  function startCountdown() {
    if (countdownRef.current) clearInterval(countdownRef.current)
    setCountdown(3)
    countdownRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          if (countdownRef.current) {
            clearInterval(countdownRef.current)
            countdownRef.current = null
          }
          setPhase('logging')
          startTimer()
          return 0
        }
        return c - 1
      })
    }, 1000)
  }

  // ─── Cancel — works from countdown, brewing, capture, or rating ──────────────
  function handleCancel() {
    if (countdownRef.current) {
      clearInterval(countdownRef.current)
      countdownRef.current = null
    }
    stopTimer()
    setCountdown(0)
    setTimerStopped(false)
    setTimerSecs(0)
    setPhase('idle')
    if (brewTimerRef.current) clearTimeout(brewTimerRef.current)
  }

  // ─── Timer controls ──────────────────────────────────────────────────────────
  function startTimer() {
    setTimerSecs(0)
    setTimerStopped(false)
    timerStartRef.current = Date.now()
    setTimerRunning(true)
    timerRef.current = setInterval(() => {
      if (timerStartRef.current !== null) {
        setTimerSecs(Math.floor((Date.now() - timerStartRef.current) / 100) / 10)
      }
    }, 100)
  }

  function stopTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    setTimerRunning(false)
    setTimerStopped(true)
    // Mirror the captured time into the editable field so the user can
    // correct it (e.g. forgot to stop, hit stop late).
    setManualTime(timerSecs.toFixed(1))
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (brewTimerRef.current) clearTimeout(brewTimerRef.current)
    }
  }, [])

  // Live recompute recommendation whenever taste changes (barista consensus: taste updates current recommendation)
  useEffect(() => {
    if (!rawActuals || phase !== 'taste') return
    const gMin = state.grinder?.minSetting ?? 1
    const gMax = state.grinder?.maxSetting ?? 40
    const recent = state.shots.slice(0, 2).map((s) => ({
      grindAdjust: s.grindAdjust, doseAdjust: s.doseAdjust,
    }))
    const adjs = computeAdjustments(
      rawActuals.time, rawActuals.volume,
      targets.time, targets.volume,
      targets.dose, targets.grind,
      weather, age,
      state.beans?.roastLevel ?? null,
      tasteFlavor, tasteStrength,
      gMin, gMax, algoParams, blendedTimeWindow,
      recent,
    )
    setResult((prev) => prev ? { ...prev, ...adjs } : prev)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasteFlavor, tasteStrength])

  // ─── Save shot ───────────────────────────────────────────────────────────────
  function handleSave(actualTime: number, actualVolume: number) {
    const score = computeScore(actualTime, actualVolume, targets.time, targets.volume, targets.dose)
    const gMin = state.grinder?.minSetting ?? 1
    const gMax = state.grinder?.maxSetting ?? 40
    // state.shots is the list BEFORE this shot is added (saved below) — perfect for trend.
    const recent = state.shots.slice(0, 2).map((s) => ({
      grindAdjust: s.grindAdjust, doseAdjust: s.doseAdjust,
    }))
    // Compute initial recommendation without taste (taste will live-update below)
    const adjs = computeAdjustments(
      actualTime, actualVolume, targets.time, targets.volume,
      targets.dose, targets.grind,
      weather, age, state.beans?.roastLevel ?? null,
      null, null, gMin, gMax, algoParams, blendedTimeWindow,
      recent,
    )
    const shotId = generateId()

    const shot: ShotEntry = {
      id: shotId,
      timestamp: new Date().toISOString(),
      inputGrind: targets.grind,
      inputDose: targets.dose,
      inputTamp: targets.tamp,
      targetVolume: targets.volume,
      targetTime: targets.time,
      actualVolume,
      actualTime,
      score,
      grindAdjust: adjs.grindAdjust,
      doseAdjust: adjs.doseAdjust,
      volumeAdjust: adjs.volumeAdjust,
      timeAdjust: adjs.timeAdjust,
      tampAdjust: adjs.tampAdjust,
      crema: null,
      tasteFlavor: null,
      tasteStrength: null,
      beanAge: age,
      roastLevel: beans?.roastLevel ?? null,
      temp: weather?.temp ?? null,
      humidity: weather?.humidity ?? null,
    }

    dispatch({ type: 'ADD_SHOT', payload: shot })
    dispatch({ type: 'SET_CURRENT_GRIND', payload: targets.grind })

    // Native review prompt after meaningful milestones. Apple caps at 3 per
    // 365 days, so 3/10/25 is our budget. Fires AFTER the shot is recorded
    // so the user has just seen the value.
    const newCount = state.shots.length + 1
    if ([3, 10, 25].includes(newCount)) maybeRequestReview()
    shotSavedHaptic()
    track('shot_logged', {
      shot_number: newCount,
      score,
      roast_level: beans?.roastLevel ?? 'none',
      bean_age_bucket: age === null ? 'none' : age <= 7 ? '0-7' : age <= 21 ? '8-21' : age <= 30 ? '22-30' : '30+',
      taste_flavor: 'none',
    })

    const newResult: ShotResult = {
      score,
      ...adjs,
      actuals: { volume: actualVolume, time: actualTime },
    }
    setResult(newResult)
    setRawActuals({ time: actualTime, volume: actualVolume })
    setSavedShotId(shotId)
    setCrema(null)
    setTasteFlavor(null)
    setTasteStrength(null)
    stopTimer()

    // Two-step flow: rating wizard alone first, results+coaching after.
    setPhase('taste')
  }

  function handleTimerSave() {
    const v = parseFloat(timerVolume)
    if (isNaN(v) || v <= 0) return
    // Use the editable manualTime (user may have corrected the captured timer
    // value — e.g. they forgot to stop). Fall back to the raw timer reading.
    const editedTime = parseFloat(manualTime)
    const finalTime = Number.isFinite(editedTime) && editedTime > 0
      ? Math.round(editedTime * 10) / 10
      : parseFloat(timerSecs.toFixed(1))
    handleSave(finalTime, Math.round(v * 10) / 10)
  }

  // ─── Taste phase handlers ─────────────────────────────────────────────────────
  function handleTasteDone() {
    if (savedShotId) {
      const updates: Partial<ShotEntry> = { crema, tasteFlavor, tasteStrength }
      if (result) {
        updates.grindAdjust = result.grindAdjust
        updates.doseAdjust = result.doseAdjust
      }
      dispatch({ type: 'UPDATE_SHOT', payload: { id: savedShotId, updates } })
    }
    transitionCard('results')
    setPhase('rated')
  }

  // Rate later: schedule a local notification in ~8 min and move on to
  // results+coaching. Espresso reads truer once it's settled; this matches
  // barista practice and gives the user space to taste before recording.
  function handleRateLater() {
    transitionCard('results')
    setPhase('rated')
    if (savedShotId) {
      scheduleLocalNotification({
        id: 2001,
        title: 'How did that shot taste?',
        body: 'Tap to rate crema, flavour, and strength.',
        at: new Date(Date.now() + 8 * 60_000),
      }).catch(() => {})
    }
  }


  // Clamp + snap a target value the same way the manual stepper does, so applying
  // an adjustment can't produce out-of-range or fractional-step settings.
  function clampSnap(key: keyof BrewTargets, raw: number): number {
    let next = raw
    if (key === 'dose') next = Math.max(5, Math.min(30, raw))
    else if (key === 'volume') next = Math.max(10, Math.min(120, raw))
    else if (key === 'time') next = Math.max(10, Math.min(60, raw))
    else if (key === 'tamp') next = Math.max(0, Math.min(100, raw))
    else if (key === 'grind') {
      const min = state.grinder?.minSetting ?? 1
      const max = state.grinder?.maxSetting ?? 40
      next = Math.max(min, Math.min(max, raw))
    }
    return Math.round(next * 2) / 2
  }

  // ─── Apply single adjustment ──────────────────────────────────────────────────
  function applyAdjustment(row: RowConfig) {
    if (!result) return
    const adjVal = result[row.adjustKey] as number
    if (adjVal === 0) return
    setTargets((prev) => ({ ...prev, [row.key]: clampSnap(row.key, prev[row.key] + adjVal) }))
    setResult((prev) => prev ? { ...prev, [row.adjustKey]: 0 } : prev)
  }

  function applyAllAdjustments() {
    if (!result) return
    setTargets((prev) => {
      const next = { ...prev }
      for (const row of ROWS) {
        const adjVal = result[row.adjustKey] as number
        if (adjVal !== 0) {
          next[row.key] = clampSnap(row.key, prev[row.key] + adjVal)
        }
      }
      return next
    })
    setResult((prev) => {
      if (!prev) return prev
      return { ...prev, grindAdjust: 0, doseAdjust: 0, volumeAdjust: 0, timeAdjust: 0, tampAdjust: 0 }
    })
  }


  // ─── Brew again — returns to the targets/recipe view, doesn't auto-start.
  // User can review applied adjustments, tweak if needed, then tap BREW.
  function handleBrewAgain() {
    transitionCard('targets')
    setPhase('idle')
    setResult(null)
    setRawActuals(null)
    setSavedShotId(null)
    setCrema(null)
    setTasteFlavor(null)
    setTasteStrength(null)
    setTimerStopped(false)
    setTimerSecs(0)
  }

  // Bean age helpers (kept for potential reuse; hero now owns these signals)
  void age

  const isMachineConfigured = !!state.machine

  // ─── Parameter stepper row ────────────────────────────────────────────────────
  function renderParamRow(row: RowConfig, isLast: boolean) {
    const isManualTamp = row.key === 'tamp' && (state.tamp?.type === 'manual' || !state.tamp)
    const isFixedTamp  = row.key === 'tamp' && state.tamp && state.tamp.type !== 'manual'
    const fixedPressure = state.tamp?.type === 'spring' ? state.tamp.springPressure : state.tamp?.autoPressure

    return (
      <div key={row.key} className={`bs-param-row${!isLast ? ' bs-param-row--sep' : ''}`}>
        <span className="bs-param-row__label">{t(row.labelKey)}</span>

        {isManualTamp ? (
          <div className="bs-tamp-group">
            {TAMP_STEPS.map((step) => (
              <button
                key={step.labelKey}
                className={`bs-tamp-btn${targets.tamp === step.value ? ' bs-tamp-btn--active' : ''}`}
                onClick={() => setTargets((prev) => ({ ...prev, tamp: step.value }))}
                type="button"
              >
                {t(step.labelKey)}
              </button>
            ))}
          </div>
        ) : isFixedTamp ? (
          /* Match the stepper-row grid: spacer · value-group · badge */
          <div className="bs-param-row__controls bs-param-row__controls--fixed">
            <span className="bs-stepper bs-stepper--spacer" aria-hidden="true" />
            <div className="bs-param-row__value-group">
              <span className="bs-param-row__value">{fixedPressure ?? '—'}</span>
              <span className="bs-param-row__unit">{t('brew.tampUnitKg')}</span>
            </div>
            <span className="bs-tamp-fixed__badge">{state.tamp!.type === 'spring' ? t('brew.tampSpring') : t('brew.tampAuto')}</span>
          </div>
        ) : (
          <div className="bs-param-row__controls">
            <button
              className="bs-stepper bs-stepper--big"
              onClick={() => adjustTarget(row.key, -row.step)}
              type="button"
              aria-label={t('brew.decrease', { label: t(row.labelKey) })}
            >
              −
            </button>
            <button
              className="bs-stepper bs-stepper--fine"
              onClick={() => adjustTarget(row.key, -row.fineStep)}
              type="button"
              aria-label={t('brew.decreaseFine', { label: t(row.labelKey) })}
            >
              −
            </button>
            <div className="bs-param-row__value-group">
              <input
                className="bs-param-row__value bs-param-row__input"
                type="text"
                inputMode="decimal"
                value={targets[row.key]}
                onChange={(e) => {
                  const v = e.target.value
                  if (/^[0-9]*\.?[0-9]*$/.test(v)) {
                    const n = parseFloat(v)
                    if (!isNaN(n)) setTargetValue(row.key, n)
                  }
                }}
                onFocus={(e) => e.target.select()}
                aria-label={t(row.labelKey)}
              />
              <span className="bs-param-row__unit">{row.unit}</span>
            </div>
            <button
              className="bs-stepper bs-stepper--fine bs-stepper--plus"
              onClick={() => adjustTarget(row.key, row.fineStep)}
              type="button"
              aria-label={t('brew.increaseFine', { label: t(row.labelKey) })}
            >
              +
            </button>
            <button
              className="bs-stepper bs-stepper--big bs-stepper--plus"
              onClick={() => adjustTarget(row.key, row.step)}
              type="button"
              aria-label={t('brew.increase', { label: t(row.labelKey) })}
            >
              +
            </button>
          </div>
        )}
      </div>
    )
  }

  // ─── Targets card ────────────────────────────────────────────────────────────
  function renderTargetsCard() {
    return (
      <div className="bs-param-card">
        <div className="bs-section bs-section--recipe">
          <span className="bs-section__label">{t('brew.chipRecipe')}</span>
          <div className="bs-section__rows">
            {RECIPE_ROWS.map((row, idx) => renderParamRow(row, idx === RECIPE_ROWS.length - 1))}
          </div>
        </div>
        <div className="bs-section bs-section--targets">
          <span className="bs-section__label">{t('brew.chipTargets')}</span>
          <div className="bs-section__rows">
            {TARGET_ROWS.map((row, idx) => renderParamRow(row, idx === TARGET_ROWS.length - 1))}
          </div>
        </div>
      </div>
    )
  }

  // ─── Results card ─────────────────────────────────────────────────────────────
  function renderResultsCard() {
    if (!result) return null
    const color = scoreColor(result.score)
    const tier = t(scoreTierKey(result.score))
    const hasAnyAdjust = ROWS.some((row) => (result[row.adjustKey] as number) !== 0)
    const reasonText = renderReason(result.reasonKey, result.reasonParams)
    // doseReasonKey is no longer surfaced — the numeric adjustment speaks
    // for itself ("Dose 18 → 18.5g" doesn't need "Watery. Add 0.5g.").

    // Hero context: how does this score compare to recent shots?
    // state.shots[0] is the just-saved current shot; [1] is the previous one.
    const prevScores = state.shots.slice(1, 11)
      .map((s) => s.score)
      .filter((s): s is number => typeof s === 'number')
    const prevScore = prevScores[0] ?? null
    const scoreDelta = prevScore !== null ? result.score - prevScore : null
    const bestRecent = prevScores.length > 0 ? Math.max(...prevScores) : null
    const isPersonalBest = bestRecent !== null && result.score > bestRecent
    let scoreContextKey: string | null = null
    let scoreContextParams: Record<string, string | number> | undefined
    if (isPersonalBest && prevScores.length >= 3) {
      scoreContextKey = 'brew.scoreBest'
    } else if (scoreDelta !== null && scoreDelta > 0) {
      scoreContextKey = 'brew.scoreUp'
      scoreContextParams = { delta: scoreDelta }
    } else if (scoreDelta !== null && scoreDelta < 0) {
      scoreContextKey = 'brew.scoreDown'
      scoreContextParams = { delta: Math.abs(scoreDelta) }
    } else if (scoreDelta === 0) {
      scoreContextKey = 'brew.scoreSame'
    } else {
      scoreContextKey = 'brew.scoreFirst'
    }

    return (
      <div className="bs-param-card">
        {/* Score hero */}
        <div className="bs-hero">
          <div className="bs-hero__row">
            <div className="bs-hero__num bs-hero__num--reveal" style={{ color }}>
              <ScoreCountUp value={result.score} />
            </div>
            <div className="bs-hero__rhs">
              <div className="bs-hero__tier bs-hero__tier--reveal" style={{ color }}>{tier}</div>
              {scoreContextKey && (
                <div className={`bs-hero__delta bs-hero__delta--reveal${isPersonalBest ? ' bs-hero__delta--best' : ''}`}>
                  {t(scoreContextKey, scoreContextParams)}
                </div>
              )}
            </div>
          </div>
          {prevScores.length > 0 && (
            <div className="bs-hero__spark" aria-hidden="true">
              {[...prevScores.slice(0, 7).reverse(), result.score].map((s, i, arr) => {
                const max = Math.max(...arr, 100)
                const min = Math.min(...arr, 0)
                const range = Math.max(max - min, 20)
                const h = ((s - min) / range) * 100
                const isCurrent = i === arr.length - 1
                return (
                  <span
                    key={i}
                    className={`bs-hero__bar${isCurrent ? ' bs-hero__bar--current' : ''}`}
                    style={{ height: `${Math.max(8, h)}%`, background: isCurrent ? color : undefined }}
                  />
                )
              })}
            </div>
          )}
        </div>

        <div className="bs-results-divider" />

        {/* ── INPUT changes (RECIPE side: grind / dose / tamp) ──────────── */}
        {(() => {
          const inputRows = ROWS.filter((r) => r.section === 'recipe')
          const anyChange = inputRows.some((r) => (result[r.adjustKey] as number) !== 0)
          return (
            <>
              <div className="bs-section-head bs-section-head--recipe">
                {anyChange ? t('brew.sectionChange') : t('brew.sectionHold')}
              </div>
              {inputRows.map((row, idx) => {
                const adjVal = result[row.adjustKey] as number
                const targetVal = targets[row.key]
                const recommendedVal = clampSnap(row.key, targetVal + adjVal)
                const isLast = idx === inputRows.length - 1
                const isGrind = row.key === 'grind'
                const grindDirection = adjVal < 0 ? t('brew.directionFiner') : adjVal > 0 ? t('brew.directionCoarser') : null

                return (
                  <div key={row.key} className={`bs-adj-row${!isLast ? ' bs-adj-row--sep' : ''}`}>
                    <div className="bs-adj-row__top">
                      <span className="bs-adj-row__label">{t(row.labelKey)}</span>
                      {adjVal === 0 ? (
                        <span className="bs-adj-row__hold">{t('brew.holdAtTarget')}</span>
                      ) : (
                        <div className="bs-adj-row__change">
                          {isGrind && grindDirection && (
                            <span className={`bs-adj-row__direction${adjVal < 0 ? ' bs-adj-row__direction--finer' : ' bs-adj-row__direction--coarser'}`}>
                              {grindDirection}
                            </span>
                          )}
                          <span className="bs-adj-row__from">{targetVal} {row.unit}</span>
                          <span className="bs-adj-row__arrow">→</span>
                          <span className="bs-adj-row__to">{recommendedVal} {row.unit}</span>
                          <button
                            className="bs-adj-apply"
                            onClick={() => applyAdjustment(row)}
                            type="button"
                          >
                            {t('brew.apply')}
                          </button>
                        </div>
                      )}
                    </div>
                    {isGrind && adjVal !== 0 && reasonText && (
                      <p className="bs-adj-row__reason">{reasonText}</p>
                    )}
                  </div>
                )
              })}
            </>
          )
        })()}

        {/* ── OUTCOME rows (TARGETS side: how time/volume landed) ───────── */}
        {(() => {
          const outcomeRows = ROWS.filter((r) => r.section === 'targets')
          return (
            <>
              <div className="bs-section-head bs-section-head--targets">{t('brew.sectionShot')}</div>
              {outcomeRows.map((row, idx) => {
                const targetVal = targets[row.key]
                const actual = row.key === 'time' ? result.actuals.time : result.actuals.volume
                const delta = actual - targetVal
                const tolerance = row.key === 'time' ? 2 : 3
                const absDelta = Math.abs(delta)
                const isLast = idx === outcomeRows.length - 1
                let chip: { text: string; tone: 'short' | 'long' | 'on' }
                if (absDelta <= tolerance) {
                  chip = { text: t('brew.onTarget'), tone: 'on' }
                } else if (delta < 0) {
                  chip = { text: t('brew.outcomeShort', { delta: Math.round(absDelta), unit: row.unit }), tone: 'short' }
                } else {
                  chip = { text: t('brew.outcomeLong', { delta: Math.round(absDelta), unit: row.unit }), tone: 'long' }
                }
                return (
                  <div key={row.key} className={`bs-adj-row bs-adj-row--outcome${!isLast ? ' bs-adj-row--sep' : ''}`}>
                    <span className="bs-adj-row__label">{t(row.labelKey)}</span>
                    <span className="bs-adj-row__actual">
                      <span className="bs-adj-row__actual-val">{actual} {row.unit}</span>
                      <span className="bs-adj-row__vs">{t('brew.targetWas', { value: targetVal, unit: row.unit })}</span>
                    </span>
                    <span className={`bs-adj-row__outcome bs-adj-row__outcome--${chip.tone}`}>{chip.text}</span>
                  </div>
                )
              })}
            </>
          )
        })()}

        {/* Apply CTAs — primary "Apply for next shot" + secondary "Always do this" */}
        {hasAnyAdjust && (
          <div className="bs-apply-wrap">
            <button className="bs-apply-all-btn" onClick={applyAllAdjustments} type="button">
              {t('brew.applyAll')}
            </button>
            <button
              className={`bs-apply-always${state.autoApplyAdjustments ? ' bs-apply-always--on' : ''}`}
              onClick={() => dispatch({ type: 'SET_AUTO_APPLY', payload: !state.autoApplyAdjustments })}
              type="button"
              role="switch"
              aria-checked={state.autoApplyAdjustments}
            >
              <span className="bs-apply-always__check" aria-hidden="true">
                {state.autoApplyAdjustments ? '✓' : ''}
              </span>
              {t('brew.applyAuto')}
            </button>
          </div>
        )}

      </div>
    )
  }

  // ─── Rating wizard (crema · flavour · strength) ─────────────────────────────
  // Three rows of pills on one screen. Each row is optional — leave any of them
  // un-set and the wizard still saves. "Rate later" defers and schedules a push.
  function renderRatingWizard() {
    return (
      <div className="bs-rating">
        <div className="bs-rating__header">{t('brew.tasteHeader')}</div>

        <div className="bs-rating__row">
          <span className="bs-rating__label">{t('rating.crema')}</span>
          <div className="bs-rating__pills">
            {(['thin', 'normal', 'thick'] as const).map((c) => (
              <button
                key={c}
                className={`bs-rating-pill${crema === c ? ' bs-rating-pill--on' : ''}`}
                onClick={() => setCrema(crema === c ? null : c)}
                type="button"
              >
                {t(`crema.${c}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="bs-rating__row">
          <span className="bs-rating__label">{t('rating.flavour')}</span>
          <div className="bs-rating__pills">
            {(['sour', 'balanced', 'bitter'] as const).map((f) => (
              <button
                key={f}
                className={`bs-rating-pill${tasteFlavor === f ? ' bs-rating-pill--on' : ''}`}
                onClick={() => setTasteFlavor(tasteFlavor === f ? null : f)}
                type="button"
              >
                {t(`taste.${f}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="bs-rating__row">
          <span className="bs-rating__label">{t('rating.strength')}</span>
          <div className="bs-rating__pills">
            {(['weak', 'perfect', 'strong'] as const).map((s) => (
              <button
                key={s}
                className={`bs-rating-pill${tasteStrength === s ? ' bs-rating-pill--on' : ''}`}
                onClick={() => setTasteStrength(tasteStrength === s ? null : s)}
                type="button"
              >
                {t(`taste.${s}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="bs-rating__footer">
          <button className="bs-rating__later" onClick={handleRateLater} type="button">
            {t('rating.later')}
          </button>
          <button className="bs-rating__save" onClick={handleTasteDone} type="button">
            {t('rating.save')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="bs-screen">

      {/* ── Setup reminder pill ── */}
      {!isMachineConfigured && (
        <button
          className="bs-setup-pill"
          onClick={onNavigateToSetup}
          type="button"
        >
          <span className="bs-setup-pill__text">{t('brew.setupPill')}</span>
          <span className="bs-setup-pill__chevron">›</span>
        </button>
      )}

      {isMachineConfigured && !beans?.brand && (
        <button className="bs-add-beans-link" onClick={onNavigateToSetup} type="button">
          {t('brew.addBeans')}
        </button>
      )}

      {/* ── Validation error ── */}
      {brewError && (
        <div className="bs-error-banner" role="alert">{brewError}</div>
      )}

      {/* ── Recipe / Results card. Hidden during countdown, timing, and the
            rating wizard step (each owns the screen on its own). ── */}
      {phase !== 'countdown' && phase !== 'logging' && phase !== 'taste' && (
        <div
          className={`bs-card-wrap${cardVisible ? ' bs-card-wrap--visible' : ' bs-card-wrap--hidden'}`}
        >
          {cardState === 'targets' ? renderTargetsCard() : renderResultsCard()}
        </div>
      )}

      {/* ── Rating wizard (inline, below results) ── */}
      {phase === 'taste' && renderRatingWizard()}

      {/* ── 3-2-1 countdown — runs before the timer starts ── */}
      {phase === 'countdown' && (
        <div className="bs-countdown">
          <span className="bs-countdown__num">{countdown}</span>
          <span className="bs-countdown__sub">{t('brew.countdownSub')}</span>
          <button className="bs-timing__cancel" type="button" onClick={handleCancel}>
            {t('brew.cancel')}
          </button>
        </div>
      )}

      {/* ── Inline timer panel — replaces the recipe card while pulling.
            Time is captured by the timer and editable on stop. Volume
            defaults to the user's target and is adjusted via +/- steppers. ── */}
      {phase === 'logging' && (
        <div className="bs-timing">
          <div className="bs-timing__head">
            <span className="bs-timing__eyebrow">
              {timerStopped ? t('brew.timingStopped') : t('brew.timingRunning')}
            </span>
            <button className="bs-timing__cancel" type="button" onClick={handleCancel}>
              {t('brew.cancel')}
            </button>
          </div>

          {/* Time — big serif numeral while running. Editable after stop,
              with +/- steppers (big = 1s, fine = 0.1s) for quick fixes. */}
          <div className="bs-timing__metric-block">
            <span className="bs-timing__label">{t('brew.fieldTimeSec')}</span>
            {timerRunning ? (
              <div className="bs-timing__metric">
                <input
                  className="bs-timing__num"
                  type="text"
                  inputMode="decimal"
                  value={timerSecs.toFixed(1)}
                  readOnly
                  aria-label={t('brew.fieldTimeSec')}
                />
                <span className="bs-timing__unit">s</span>
              </div>
            ) : (
              <div className="bs-timing__stepper-row">
                <button
                  type="button"
                  className="bs-stepper bs-stepper--big"
                  onClick={() => {
                    const cur = parseFloat(manualTime) || timerSecs
                    setManualTime(String(Math.max(0, Math.round((cur - 1) * 10) / 10)))
                  }}
                  aria-label={t('brew.decrease', { label: t('brew.fieldTimeSec') })}
                >−</button>
                <button
                  type="button"
                  className="bs-stepper bs-stepper--fine"
                  onClick={() => {
                    const cur = parseFloat(manualTime) || timerSecs
                    setManualTime(String(Math.max(0, Math.round((cur - 0.1) * 10) / 10)))
                  }}
                  aria-label={t('brew.decreaseFine', { label: t('brew.fieldTimeSec') })}
                >−</button>
                <div className="bs-timing__metric bs-timing__metric--inline">
                  <input
                    className="bs-timing__num bs-timing__num--small"
                    type="text"
                    inputMode="decimal"
                    value={manualTime}
                    onChange={(e) => /^[0-9]*\.?[0-9]*$/.test(e.target.value) && setManualTime(e.target.value)}
                    onFocus={(e) => e.target.select()}
                    aria-label={t('brew.fieldTimeSec')}
                  />
                  <span className="bs-timing__unit">s</span>
                </div>
                <button
                  type="button"
                  className="bs-stepper bs-stepper--fine bs-stepper--plus"
                  onClick={() => {
                    const cur = parseFloat(manualTime) || timerSecs
                    setManualTime(String(Math.round((cur + 0.1) * 10) / 10))
                  }}
                  aria-label={t('brew.increaseFine', { label: t('brew.fieldTimeSec') })}
                >+</button>
                <button
                  type="button"
                  className="bs-stepper bs-stepper--big bs-stepper--plus"
                  onClick={() => {
                    const cur = parseFloat(manualTime) || timerSecs
                    setManualTime(String(Math.round((cur + 1) * 10) / 10))
                  }}
                  aria-label={t('brew.increase', { label: t('brew.fieldTimeSec') })}
                >+</button>
              </div>
            )}
          </div>

          {/* Volume — defaults to the target, +/- steppers do the rest. */}
          {timerStopped && (
            <div className="bs-timing__metric-block">
              <span className="bs-timing__label">{t('brew.fieldVolumeG')}</span>
              <div className="bs-timing__stepper-row">
                <button
                  type="button"
                  className="bs-stepper bs-stepper--big"
                  onClick={() => {
                    const cur = parseFloat(timerVolume) || targets.volume
                    setTimerVolume(String(Math.max(1, Math.round((cur - 1) * 10) / 10)))
                  }}
                  aria-label={t('brew.decrease', { label: t('brew.fieldVolumeG') })}
                >−</button>
                <button
                  type="button"
                  className="bs-stepper bs-stepper--fine"
                  onClick={() => {
                    const cur = parseFloat(timerVolume) || targets.volume
                    setTimerVolume(String(Math.max(1, Math.round((cur - 0.1) * 10) / 10)))
                  }}
                  aria-label={t('brew.decreaseFine', { label: t('brew.fieldVolumeG') })}
                >−</button>
                <div className="bs-timing__metric bs-timing__metric--inline">
                  <input
                    className="bs-timing__num bs-timing__num--small"
                    type="text"
                    inputMode="decimal"
                    value={timerVolume}
                    onChange={(e) => /^[0-9]*\.?[0-9]*$/.test(e.target.value) && setTimerVolume(e.target.value)}
                    onFocus={(e) => e.target.select()}
                    aria-label={t('brew.fieldVolumeG')}
                  />
                  <span className="bs-timing__unit">ml</span>
                </div>
                <button
                  type="button"
                  className="bs-stepper bs-stepper--fine bs-stepper--plus"
                  onClick={() => {
                    const cur = parseFloat(timerVolume) || targets.volume
                    setTimerVolume(String(Math.round((cur + 0.1) * 10) / 10))
                  }}
                  aria-label={t('brew.increaseFine', { label: t('brew.fieldVolumeG') })}
                >+</button>
                <button
                  type="button"
                  className="bs-stepper bs-stepper--big bs-stepper--plus"
                  onClick={() => {
                    const cur = parseFloat(timerVolume) || targets.volume
                    setTimerVolume(String(Math.round((cur + 1) * 10) / 10))
                  }}
                  aria-label={t('brew.increase', { label: t('brew.fieldVolumeG') })}
                >+</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── BREW button — last in the flex column so it pins to the bottom.
            Morphs in place: BREW → STOP → SAVE SHOT → BREW AGAIN. Hidden
            during the 3-2-1 countdown and the rating wizard (each owns the
            screen on its own). ── */}
      {phase !== 'countdown' && phase !== 'taste' && (
        <button
          className={`bs-brew-btn${phase === 'logging' && !timerStopped ? ' bs-brew-btn--running' : ''}`}
          onClick={
            phase === 'logging' && timerRunning
              ? stopTimer
              : phase === 'logging' && timerStopped
                ? handleTimerSave
                : (phase === 'idle' || phase === 'rated')
                  ? (cardState === 'results' ? handleBrewAgain : handleBrew)
                  : undefined
          }
          disabled={
            (phase === 'logging' && timerStopped && !timerVolume) ||
            phase === 'brewing'
          }
          type="button"
        >
          <span className="bs-brew-btn__label">
            {phase === 'logging' && timerRunning
              ? t('brew.stop')
              : phase === 'logging' && timerStopped
                ? t('brew.saveShot')
                : cardState === 'results'
                  ? t('brew.brewAgainButton')
                  : t('brew.brewButton')}
          </span>
        </button>
      )}

      <PremiumModal
        open={premiumTrigger !== null}
        onClose={() => setPremiumTrigger(null)}
        trigger={premiumTrigger}
        isSignedIn={!!state.userId}
        onSignInRequired={onSignIn}
      />

      <style>{`
        /* ── Screen container ─────────────────────────────────────────── */
        .bs-screen {
          background: var(--cream);
          /* Padding + gap scale with viewport height so iPhone SE breathes
             but iPhone Pro Max doesn't waste space. */
          padding: clamp(4px, 1vh, 12px) 16px clamp(8px, 1.5vh, 20px);
          display: flex;
          flex-direction: column;
          gap: clamp(4px, 0.8vh, 10px);
          /* Parent (.screen-content) is flex-column with flex:1; we claim the
             full visible height so margin-top:auto on the BREW button pins it
             to the bottom regardless of param-card height. */
          flex: 1 0 auto;
        }

        /* ── Setup nudge ─────────────────────────────────────────────── */
        .bs-setup-pill {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          padding: 10px 16px;
          background: var(--accent-green-tint);
          border-radius: 12px;
          border: 1px solid rgba(107, 142, 92, 0.22);
          cursor: pointer;
          transition: background 0.15s ease, border-color 0.15s ease;
          -webkit-tap-highlight-color: transparent;
        }
        .bs-setup-pill:active {
          background: rgba(107, 142, 92, 0.18);
        }
        .bs-setup-pill__text {
          font-size: 13px;
          font-weight: 500;
          color: var(--accent-green);
          letter-spacing: 0.1px;
        }
        .bs-setup-pill__chevron {
          font-size: 16px;
          font-weight: 600;
          color: var(--accent-green);
          opacity: 0.7;
          line-height: 1;
        }

        /* ── Bean card: tight, integrated ─────────────────────────────── */
        .bs-bean-card {
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding: 10px 14px;
          background: rgba(184, 116, 74, 0.06);
          border: 1px solid rgba(184, 116, 74, 0.18);
          border-radius: 12px;
        }
        .bs-bean-card__name {
          font-size: 14px;
          font-weight: 700;
          color: var(--text-primary);
          line-height: 1.3;
        }
        .bs-bean-card__age {
          font-size: 12px;
          font-weight: 500;
          color: var(--text-tertiary);
          line-height: 1.3;
        }
        .bs-bean-card__stale {
          font-weight: 600;
          color: #C2410C;
        }

        .bs-add-beans-link {
          font-size: 13px;
          font-weight: 600;
          color: var(--accent-green);
          background: none;
          border: 1px dashed rgba(107, 142, 92, 0.4);
          padding: 8px 14px;
          border-radius: 10px;
          cursor: pointer;
          text-align: center;
          -webkit-tap-highlight-color: transparent;
          align-self: flex-start;
        }

        /* ── Error banner ─────────────────────────────────────────────── */
        .bs-error-banner {
          padding: 10px 14px;
          background: #FEE8E8;
          border: 1px solid #F5AAAA;
          border-radius: var(--radius-md);
          font-size: 13px;
          font-weight: 500;
          color: #8B1A1A;
        }

        /* ── Inline timer panel (replaces the recipe card while pulling) ── */
        .bs-timing {
          display: flex;
          flex-direction: column;
          gap: clamp(10px, 1.8vh, 18px);
          padding: clamp(16px, 2.5vh, 24px) clamp(16px, 3vw, 22px);
          background: var(--white);
          border: 1px solid var(--border-light);
          border-radius: 18px;
          box-shadow: 0 1px 3px rgba(60, 40, 20, 0.06), 0 6px 18px rgba(60, 40, 20, 0.05);
          flex: 1 1 auto;
        }
        .bs-timing__head {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .bs-timing__eyebrow {
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 1.8px;
          text-transform: uppercase;
          color: var(--copper-deep);
        }
        .bs-timing__cancel {
          font-size: 12px;
          font-weight: 600;
          color: var(--text-tertiary);
          background: transparent;
          border: none;
          padding: 4px 8px;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
        }
        .bs-timing__cancel:hover { color: var(--text-secondary); }

        .bs-timing__metric-block {
          display: flex;
          flex-direction: column;
          gap: 4px;
          align-items: center;
        }
        .bs-timing__label {
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 1.4px;
          text-transform: uppercase;
          color: var(--text-tertiary);
        }
        .bs-timing__metric {
          display: flex;
          align-items: baseline;
          justify-content: center;
          gap: 6px;
        }
        .bs-timing__metric--inline {
          flex: 0 0 auto;
        }
        .bs-timing__num {
          width: 100%;
          max-width: 180px;
          font-family: var(--font-brand);
          font-size: clamp(48px, 10vh, 80px);
          font-weight: 600;
          line-height: 1;
          letter-spacing: -2px;
          color: var(--text-primary);
          background: transparent;
          border: none;
          text-align: center;
          font-variant-numeric: tabular-nums;
          outline: none;
          padding: 0;
        }
        .bs-timing__num--small {
          font-size: clamp(28px, 4.6vh, 40px);
          max-width: 96px;
        }
        .bs-timing__num:focus { color: var(--accent-green); }
        .bs-timing__unit {
          font-size: 16px;
          font-style: italic;
          color: var(--text-tertiary);
          font-weight: 500;
        }
        .bs-timing__stepper-row {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          margin-top: 4px;
        }
        .bs-brew-btn--running {
          background:
            radial-gradient(120% 100% at 50% 0%, rgba(255,255,255,0.16), transparent 55%),
            linear-gradient(180deg, #B8744A 0%, #8C5532 100%);
          border-color: rgba(140, 85, 50, 0.7);
        }

        /* ── 3-2-1 countdown ──────────────────────────────────────────── */
        .bs-countdown {
          flex: 1 1 auto;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 14px;
          background: var(--white);
          border-radius: 18px;
          border: 1px solid var(--border-light);
          box-shadow: 0 1px 3px rgba(60, 40, 20, 0.06), 0 6px 18px rgba(60, 40, 20, 0.05);
          padding: 40px 20px;
          position: relative;
        }
        .bs-countdown__num {
          font-family: var(--font-brand);
          font-size: clamp(110px, 24vh, 180px);
          font-weight: 600;
          line-height: 1;
          color: var(--copper);
          letter-spacing: -6px;
          animation: bsCountPulse 1s ease-out;
        }
        .bs-countdown__sub {
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 2px;
          text-transform: uppercase;
          color: var(--text-tertiary);
        }
        .bs-countdown .bs-timing__cancel {
          position: absolute;
          top: 14px;
          right: 14px;
        }
        @keyframes bsCountPulse {
          0% { transform: scale(0.6); opacity: 0; }
          40% { transform: scale(1.08); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }

        /* ── Rating wizard (crema · flavour · strength) ─────────────────── */
        .bs-rating {
          background: var(--white);
          border: 1px solid var(--border-light);
          border-radius: 16px;
          padding: clamp(12px, 2vh, 18px) clamp(14px, 3vw, 18px);
          box-shadow: 0 1px 3px rgba(60, 40, 20, 0.05);
          display: flex;
          flex-direction: column;
          gap: clamp(8px, 1.4vh, 14px);
        }
        .bs-rating__header {
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 1.6px;
          text-transform: uppercase;
          color: var(--copper-deep);
        }
        .bs-rating__row {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .bs-rating__label {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.8px;
          text-transform: uppercase;
          color: var(--text-tertiary);
        }
        .bs-rating__pills {
          display: flex;
          gap: 6px;
        }
        .bs-rating-pill {
          flex: 1;
          min-height: 44px;
          padding: clamp(10px, 1.6vh, 14px) 4px;
          font-size: clamp(12px, 1.8vh, 14px);
          font-weight: 600;
          background: var(--off-white);
          border: 1.5px solid var(--border);
          color: var(--text-secondary);
          border-radius: 10px;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
          transition: background 0.15s, border-color 0.15s, color 0.15s;
        }
        .bs-rating-pill--on {
          background: rgba(107, 142, 92, 0.08);
          border-color: var(--accent-green);
          color: var(--accent-green);
        }
        .bs-rating__footer {
          display: flex;
          gap: 10px;
          margin-top: 4px;
        }
        .bs-rating__later {
          flex: 0 0 auto;
          padding: 10px 18px;
          background: transparent;
          color: var(--text-secondary);
          border: 1.5px solid var(--border);
          border-radius: 9999px;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
        }
        .bs-rating__later:hover { color: var(--copper); border-color: rgba(184, 116, 74, 0.4); }
        .bs-rating__save {
          flex: 1;
          padding: 10px 18px;
          background: var(--accent-green);
          color: #fff;
          border: none;
          border-radius: 9999px;
          font-size: 14px;
          font-weight: 800;
          letter-spacing: 0.4px;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
        }
        .bs-rating__save:hover { background: #5C7E4D; }
        .bs-rating__save:active { transform: scale(0.985); }

        /* ── Card transition wrapper ──────────────────────────────────── */
        .bs-card-wrap {
          transition: opacity 180ms ease-out, transform 280ms ease-out;
          /* Grow to absorb the slack between the hero/setup-pill and BREW.
             The card's internal sections distribute rows evenly. */
          flex: 1 1 auto;
          min-height: 0;
          display: flex;
          flex-direction: column;
        }
        .bs-card-wrap--visible {
          opacity: 1;
          transform: translateY(0);
        }
        .bs-card-wrap--hidden {
          opacity: 0;
          transform: translateY(8px);
        }

        /* ── Parameter card (State A: Targets) ───────────────────────── */
        .bs-param-card {
          background: var(--white);
          border-radius: 18px;
          border: 1px solid var(--border-light);
          box-shadow: 0 1px 3px rgba(60, 40, 20, 0.06), 0 6px 18px rgba(60, 40, 20, 0.05);
          overflow: hidden;
          /* Fill .bs-card-wrap so sections + rows distribute evenly. */
          flex: 1 1 auto;
          display: flex;
          flex-direction: column;
        }

        /* ── Inline section headers (used in results card) ─────────────── */
        .bs-section-head {
          padding: clamp(8px, 1.5vh, 14px) clamp(12px, 3vw, 16px) clamp(4px, 0.8vh, 8px);
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 1.6px;
          text-transform: uppercase;
          line-height: 1;
        }
        .bs-section-head--recipe {
          color: var(--copper-deep);
        }
        .bs-section-head--targets {
          color: var(--accent-green);
        }
        .bs-section-head + .bs-adj-row {
          border-top: 1px solid rgba(0, 0, 0, 0.04);
        }

        /* ── Sections: RECIPE (copper tint) and TARGETS (sage tint) ──── */
        .bs-section {
          position: relative;
          padding: clamp(2px, 0.6vh, 8px) 0 clamp(1px, 0.3vh, 4px);
          /* Sections share the card's growable height. */
          flex: 1 1 auto;
          display: flex;
          flex-direction: column;
        }
        .bs-section--recipe {
          background: linear-gradient(180deg, rgba(184, 116, 74, 0.045) 0%, rgba(184, 116, 74, 0.015) 100%);
        }
        .bs-section--targets {
          background: linear-gradient(180deg, rgba(107, 142, 92, 0.04) 0%, rgba(107, 142, 92, 0.015) 100%);
          border-top: 1px solid var(--border-light);
        }

        .bs-section__label {
          position: absolute;
          top: 6px;
          left: 16px;
          font-size: 8px;
          font-weight: 800;
          letter-spacing: 1.6px;
          text-transform: uppercase;
          padding: 1px 0;
          z-index: 1;
          background: none !important;
        }
        .bs-section--recipe .bs-section__label {
          color: var(--copper-deep);
          background: rgba(184, 116, 74, 0.12);
        }
        .bs-section--targets .bs-section__label {
          color: var(--accent-green);
          background: rgba(107, 142, 92, 0.14);
        }

        .bs-section__rows {
          padding-top: clamp(10px, 1.8vh, 22px);
          /* Rows distribute evenly across the section's height. */
          flex: 1 1 auto;
          display: flex;
          flex-direction: column;
        }

        /* ── Param row: each row claims an equal share of the section
              so the card breathes naturally on tall screens, stays compact
              on small ones. ───────────────────────────────────────────── */
        .bs-param-row {
          padding: clamp(4px, 0.9vh, 11px) clamp(12px, 2vw, 16px);
          display: grid;
          grid-template-columns: clamp(50px, 8vw, 64px) 1fr;
          align-items: center;
          gap: 8px;
          flex: 1 1 0;
          min-height: 0;
        }
        .bs-param-row--sep {
          border-bottom: 1px solid rgba(0, 0, 0, 0.04);
        }

        .bs-param-row__label {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.8px;
          color: var(--text-tertiary);
        }

        .bs-param-row__controls {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 4px;
        }

        /* Fixed two-column grid: number right-aligns, unit left-aligns.
           Every row's digits land on the same vertical line. */
        .bs-param-row__value-group {
          display: grid;
          grid-template-columns: 1fr 20px;
          column-gap: 3px;
          align-items: baseline;
          width: 78px;
        }

        .bs-param-row__value {
          font-size: clamp(19px, 3.2vh, 30px);
          font-weight: 800;
          color: var(--text-primary);
          line-height: 1;
          font-variant-numeric: tabular-nums;
          letter-spacing: -0.6px;
          text-align: right;
        }
        .bs-param-row__input {
          width: 100%;
          background: transparent;
          border: none;
          padding: 0;
          font-family: inherit;
          appearance: none;
          -moz-appearance: textfield;
          outline: none;
          cursor: text;
          -webkit-tap-highlight-color: transparent;
        }
        .bs-param-row__input::-webkit-outer-spin-button,
        .bs-param-row__input::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        .bs-param-row__input:focus {
          color: var(--accent-green);
        }

        .bs-param-row__unit {
          font-size: 12px;
          font-weight: 500;
          color: var(--text-tertiary);
          line-height: 1;
          text-align: left;
        }

        /* Dual stepper buttons: BIG = ±1.0, FINE = ±0.1 (±0.5 for grind).
           Size encodes magnitude so users can read it at a glance. */
        .bs-stepper {
          position: relative;
          border-radius: 50%;
          background: transparent;
          border: 1px solid var(--border);
          color: var(--text-secondary);
          font-weight: 500;
          line-height: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          cursor: pointer;
          transition: background 0.12s ease, border-color 0.12s ease, transform 0.08s ease, color 0.12s ease;
          -webkit-tap-highlight-color: transparent;
        }
        /* Invisible hit-area extender — every stepper has at least a 44pt
           tappable square even if the visible circle is smaller. Matches
           Apple HIG and Material guidelines. */
        .bs-stepper::before {
          content: '';
          position: absolute;
          inset: -10px;
        }
        .bs-stepper--big {
          width: clamp(26px, 4vh, 34px);
          height: clamp(26px, 4vh, 34px);
          font-size: clamp(15px, 2.3vh, 19px);
        }
        .bs-stepper--fine {
          width: clamp(18px, 2.8vh, 24px);
          height: clamp(18px, 2.8vh, 24px);
          font-size: clamp(12px, 1.8vh, 15px);
          opacity: 0.75;
        }
        .bs-stepper--fine::before { inset: -13px; }
        .bs-stepper--fine:hover:not(:disabled) { opacity: 1; }
        /* Unspecified (fallback for spacer/fixed-tamp slot) */
        .bs-stepper:not(.bs-stepper--big):not(.bs-stepper--fine) {
          width: 30px;
          height: 30px;
          font-size: 18px;
        }
        .bs-stepper:hover:not(:disabled) {
          border-color: var(--accent-green);
          color: var(--accent-green);
        }
        .bs-stepper:active:not(:disabled) {
          transform: scale(0.85);
          background: rgba(107, 142, 92, 0.1);
          border-color: var(--accent-green);
          color: var(--accent-green);
        }
        .bs-stepper:disabled {
          opacity: 0.3;
          cursor: not-allowed;
        }

        /* ── Manual tamp Soft/Mid/Firm buttons ───────────────────────── */
        .bs-tamp-group {
          display: flex;
          gap: 6px;
          margin-top: 2px;
        }
        .bs-tamp-btn {
          flex: 1;
          padding: 7px 0;
          border-radius: 9px;
          border: 1.5px solid var(--border);
          background: var(--off-white);
          font-size: 13px;
          font-weight: 600;
          color: var(--text-secondary);
          cursor: pointer;
          transition: background 0.12s, border-color 0.12s, color 0.12s;
          -webkit-tap-highlight-color: transparent;
        }
        .bs-tamp-btn--active {
          background: rgba(107, 142, 92, 0.08);
          border-color: var(--accent-green);
          color: var(--accent-green);
        }
        .bs-tamp-btn:active:not(.bs-tamp-btn--active) {
          background: var(--border-light);
        }

        /* Fixed tamp inherits .bs-param-row__controls layout — only the badge needs its own style */

        /* Invisible stepper spacer so fixed-tamp value aligns with stepper rows */
        .bs-stepper--spacer {
          visibility: hidden;
          pointer-events: none;
        }
        /* AUTO/SPRING badge sits in the right-stepper slot so columns line up */
        .bs-tamp-fixed__badge {
          width: 30px;
          height: 30px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 9px;
          font-weight: 800;
          letter-spacing: 0.6px;
          text-transform: uppercase;
          color: var(--text-tertiary);
          background: var(--border-light);
          border-radius: 50%;
          flex-shrink: 0;
          padding: 0;
        }

        /* ── Results score section ────────────────────────────────────── */
        /* ── Score hero ────────────────────────────────────────────────── */
        .bs-hero {
          padding: clamp(12px, 2vh, 22px) clamp(16px, 4vw, 20px) clamp(10px, 1.6vh, 18px);
          display: flex;
          flex-direction: column;
          gap: clamp(8px, 1.4vh, 14px);
        }

        .bs-hero__row {
          display: flex;
          align-items: center;
          gap: clamp(12px, 3vw, 18px);
        }

        .bs-hero__num {
          font-family: var(--font-brand);
          font-size: clamp(52px, 11vh, 92px);
          font-weight: 500;
          line-height: 0.85;
          letter-spacing: -2px;
          font-variant-numeric: tabular-nums;
        }
        .bs-hero__num--reveal { animation: bsScoreIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both; }
        .bs-hero__tier--reveal { animation: bsTierIn 0.45s ease-out 0.35s both; }
        .bs-hero__delta--reveal { animation: bsDeltaIn 0.5s ease-out 0.5s both; }

        @keyframes bsScoreIn {
          0%   { opacity: 0; transform: scale(0.5); }
          60%  { transform: scale(1.06); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes bsTierIn {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes bsDeltaIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .bs-hero__rhs {
          display: flex;
          flex-direction: column;
          gap: 6px;
          flex: 1;
          min-width: 0;
        }

        .bs-hero__tier {
          font-size: 12px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 2px;
          line-height: 1;
        }

        .bs-hero__delta {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-secondary);
          line-height: 1.3;
          animation: deltaFade 0.5s ease-out 0.2s both;
        }

        .bs-hero__delta--best {
          color: var(--copper);
          font-weight: 700;
        }

        .bs-hero__spark {
          display: flex;
          align-items: flex-end;
          gap: 4px;
          height: 28px;
          padding: 0;
        }

        .bs-hero__bar {
          flex: 1;
          background: var(--border);
          border-radius: 2px;
          transition: height 0.35s ease, background 0.2s ease;
          min-height: 4px;
        }

        .bs-hero__bar--current {
          animation: barPulse 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) 0.55s both;
          transform-origin: bottom;
        }

        @keyframes deltaFade {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes barPulse {
          0% { transform: scaleY(0.2); opacity: 0; }
          100% { transform: scaleY(1); opacity: 1; }
        }

        /* ── Outcome chips for time/volume rows ─────────────────────────── */
        .bs-adj-row__outcome {
          font-size: 12px;
          font-weight: 700;
          padding: 4px 10px;
          border-radius: 9999px;
          letter-spacing: 0.2px;
          white-space: nowrap;
        }
        .bs-adj-row__outcome--on {
          background: rgba(107, 142, 92, 0.12);
          color: var(--accent-green);
        }
        .bs-adj-row__outcome--short {
          background: rgba(184, 116, 74, 0.14);
          color: var(--copper);
        }
        .bs-adj-row__outcome--long {
          background: rgba(184, 116, 74, 0.14);
          color: var(--copper);
        }

        /* ── "Keep as is" pill for unchanged inputs ─────────────────────── */
        .bs-adj-row__hold {
          font-size: 12px;
          font-weight: 600;
          color: var(--text-tertiary);
          padding: 4px 10px;
          background: var(--off-white);
          border-radius: 9999px;
          letter-spacing: 0.2px;
        }

        /* ── Outcome row layout (TIME / VOLUME under "This shot") ──────── */
        .bs-adj-row.bs-adj-row--outcome {
          display: grid;
          grid-template-columns: 60px 1fr auto;
          align-items: center;
          gap: 10px;
          padding: clamp(6px, 1.2vh, 12px) clamp(12px, 3vw, 16px);
          flex-direction: row;
        }

        .bs-adj-row__actual {
          display: flex;
          align-items: baseline;
          gap: 8px;
          min-width: 0;
        }

        .bs-adj-row__actual-val {
          font-size: 18px;
          font-weight: 800;
          color: var(--text-primary);
          font-variant-numeric: tabular-nums;
          line-height: 1;
        }

        .bs-adj-row__vs {
          font-size: 11px;
          color: var(--text-tertiary);
          letter-spacing: 0.2px;
          font-weight: 400;
        }

        .bs-results-divider {
          height: 1px;
          background: var(--border-light);
          margin: 0 20px;
        }

        /* ── Adjustment rows (NEXT SHOT) ──────────────────────────────── */
        .bs-adj-row {
          display: flex;
          flex-direction: column;
          padding: clamp(6px, 1.2vh, 12px) clamp(12px, 3vw, 16px);
          gap: 4px;
          min-height: clamp(36px, 6vh, 48px);
        }
        .bs-adj-row--sep {
          border-bottom: 1px solid var(--border-light);
        }

        .bs-adj-row__top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          min-height: 24px;
        }

        .bs-adj-row__label {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 1px;
          color: var(--text-tertiary);
          flex: 0 0 52px;
        }

        .bs-adj-row__ontarget {
          font-size: 12px;
          font-weight: 600;
          color: var(--accent-green);
          flex: 1;
          text-align: right;
        }

        .bs-adj-row__change {
          display: flex;
          align-items: center;
          gap: 5px;
          flex: 1;
          justify-content: flex-end;
          flex-wrap: wrap;
        }

        .bs-adj-row__direction {
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.5px;
          padding: 2px 7px;
          border-radius: 9999px;
        }
        .bs-adj-row__direction--finer {
          background: rgba(107, 142, 92, 0.12);
          color: var(--accent-green);
        }
        .bs-adj-row__direction--coarser {
          background: rgba(184, 116, 74, 0.14);
          color: var(--copper-deep);
        }

        .bs-adj-row__reason {
          font-size: 11px;
          color: var(--text-tertiary);
          margin: 0;
          padding-left: 52px;
          line-height: 1.4;
        }

        .bs-adj-row__from {
          font-size: 13px;
          color: var(--text-tertiary);
          font-variant-numeric: tabular-nums;
          text-decoration: line-through;
        }

        .bs-adj-row__arrow {
          font-size: 12px;
          color: var(--text-tertiary);
        }

        .bs-adj-row__to {
          font-size: 13px;
          font-weight: 700;
          color: var(--text-primary);
          font-variant-numeric: tabular-nums;
        }

        .bs-adj-apply {
          padding: 4px 10px;
          border-radius: 9999px;
          background: var(--accent-green);
          color: #fff;
          font-size: 11px;
          font-weight: 700;
          border: none;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
          transition: opacity 0.15s ease, transform 0.08s ease;
          flex-shrink: 0;
        }
        .bs-adj-apply:active {
          transform: scale(0.92);
          opacity: 0.85;
        }

        /* ── Auto-apply toggle row ────────────────────────────────────── */
        .bs-auto-apply-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 16px;
          border-top: 1px solid var(--border-light);
          gap: 12px;
        }

        .bs-auto-apply-row__label {
          font-size: 12px;
          font-weight: 500;
          color: var(--text-secondary);
          flex: 1;
        }

        /* Toggle switch */
        .bs-toggle {
          width: 44px;
          height: 26px;
          border-radius: 9999px;
          background: #DDD9D4;
          border: none;
          cursor: pointer;
          position: relative;
          flex-shrink: 0;
          transition: background 0.2s ease;
          -webkit-tap-highlight-color: transparent;
          padding: 0;
        }
        .bs-toggle--on {
          background: var(--accent-green);
        }
        .bs-toggle__thumb {
          position: absolute;
          top: 3px;
          left: 3px;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: #fff;
          box-shadow: 0 1px 3px rgba(0,0,0,0.2);
          transition: transform 0.2s ease;
        }
        .bs-toggle--on .bs-toggle__thumb {
          transform: translateX(18px);
        }

        /* ── Apply CTAs — primary + secondary toggle ───────────────────── */
        .bs-apply-wrap {
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding: clamp(8px, 1.4vh, 14px) 16px 4px;
        }
        .bs-apply-always {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          background: transparent;
          border: 1px dashed rgba(184, 116, 74, 0.32);
          color: var(--copper-deep);
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.2px;
          padding: 7px 14px;
          border-radius: 9999px;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
          transition: background 0.15s, border-color 0.15s, color 0.15s;
        }
        .bs-apply-always:hover { background: rgba(184, 116, 74, 0.06); }
        .bs-apply-always--on {
          background: rgba(184, 116, 74, 0.10);
          border-style: solid;
          border-color: var(--copper);
        }
        .bs-apply-always__check {
          display: inline-block;
          width: 14px;
          height: 14px;
          line-height: 14px;
          text-align: center;
          border-radius: 50%;
          font-size: 10px;
          color: #fff;
          background: var(--copper);
          opacity: 0;
          transition: opacity 0.15s;
        }
        .bs-apply-always--on .bs-apply-always__check { opacity: 1; }

        .bs-apply-all-wrap {
          padding: clamp(8px, 1.4vh, 14px) 16px 4px;
        }
        .bs-apply-all-btn {
          width: 100%;
          height: clamp(46px, 7vh, 56px);
          font-family: var(--font-primary);
          font-size: clamp(13px, 1.9vh, 15px);
          font-weight: 700;
          letter-spacing: 2.4px;
          text-transform: uppercase;
          border-radius: 9999px;
          color: #fff;
          background:
            radial-gradient(120% 100% at 50% 0%, rgba(255,255,255,0.16), transparent 55%),
            linear-gradient(180deg, #84A571 0%, #6B8E5C 55%, #587D49 100%);
          border: 1.5px solid rgba(184, 116, 74, 0.4);
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
          box-shadow:
            inset 0 1.5px 0 rgba(255, 255, 255, 0.28),
            0 2px 4px rgba(60, 40, 20, 0.10),
            0 8px 20px rgba(88, 125, 73, 0.28);
          transition: transform 0.12s, filter 0.18s;
        }
        .bs-apply-all-btn:hover { filter: brightness(1.04); }
        .bs-apply-all-btn:active { transform: scale(0.985); filter: brightness(0.96); }

        /* Edit targets link */
        .bs-edit-targets {
          display: block;
          width: 100%;
          text-align: center;
          padding: 10px 20px 14px;
          font-size: 12px;
          font-weight: 500;
          color: var(--text-tertiary);
          background: none;
          border: none;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
          transition: color 0.15s ease;
        }
        .bs-edit-targets:active {
          color: var(--text-primary);
        }

        /* ── BREW button (heroic) ────────────────────────────────────── */
        /* ── Barista Mode ─────────────────────────────────────────────── */
        .bs-barista-toggle {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          align-self: center;
          background: transparent;
          border: 1px dashed rgba(184, 116, 74, 0.32);
          color: var(--copper-deep);
          padding: 7px 14px;
          border-radius: 9999px;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.6px;
          text-transform: uppercase;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
          transition: background 0.15s ease, border-color 0.15s ease;
          margin: 6px 0 4px;
        }
        .bs-barista-toggle:hover {
          background: rgba(184, 116, 74, 0.06);
        }
        .bs-barista-toggle:active { transform: scale(0.98); }
        .bs-barista-toggle__dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--copper);
          opacity: 0.7;
        }
        .bs-barista-toggle__badge {
          font-size: 9px;
          font-weight: 800;
          letter-spacing: 1.2px;
          padding: 2px 7px;
          border-radius: 9999px;
          background: rgba(184, 116, 74, 0.14);
          margin-left: 4px;
        }

        .bs-barista-active {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 8px 14px;
          background: linear-gradient(180deg, rgba(184, 116, 74, 0.10) 0%, rgba(184, 116, 74, 0.04) 100%);
          border: 1px solid rgba(184, 116, 74, 0.28);
          border-radius: 12px;
          margin: 6px 0 4px;
        }
        .bs-barista-active__pill {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          background: none;
          border: none;
          padding: 4px 0;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 1.3px;
          text-transform: uppercase;
          color: var(--copper-deep);
        }
        .bs-barista-active__indicator {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--copper);
          box-shadow: 0 0 0 0 rgba(184, 116, 74, 0.6);
          animation: baristaPulse 1.6s ease-out infinite;
        }
        @keyframes baristaPulse {
          0% { box-shadow: 0 0 0 0 rgba(184, 116, 74, 0.55); }
          70% { box-shadow: 0 0 0 9px rgba(184, 116, 74, 0); }
          100% { box-shadow: 0 0 0 0 rgba(184, 116, 74, 0); }
        }
        .bs-barista-active__label { line-height: 1; }
        .bs-barista-active__session {
          font-size: 12px;
          font-weight: 600;
          color: var(--copper-deep);
          letter-spacing: 0.2px;
        }

        /* BREW is the sibling of Lazy Sous's Dinner Spinner: one big sage pill
           that does the magic. Their identity edge is gold; ours is copper. */
        .bs-spacer {
          flex: 1 1 0;
          min-height: 0;
        }

        .bs-brew-btn {
          position: relative;
          width: 100%;
          height: clamp(56px, 9vh, 76px);
          border-radius: 9999px;
          background:
            radial-gradient(120% 100% at 50% 0%, rgba(255,255,255,0.16), transparent 55%),
            linear-gradient(180deg, #84A571 0%, #6B8E5C 55%, #587D49 100%);
          color: var(--white);
          font-family: var(--font-primary);
          font-size: 17px;
          font-weight: 700;
          letter-spacing: 4px;
          text-transform: uppercase;
          border: 1.5px solid rgba(184, 116, 74, 0.55);
          cursor: pointer;
          box-shadow:
            inset 0 1.5px 0 rgba(255, 255, 255, 0.28),
            inset 0 -2px 0 rgba(40, 60, 30, 0.20),
            0 0 0 1px rgba(184, 116, 74, 0.18),
            0 2px 4px rgba(60, 40, 20, 0.10),
            0 14px 30px rgba(88, 125, 73, 0.36),
            0 4px 12px rgba(88, 125, 73, 0.22);
          transition: transform 0.12s ease, box-shadow 0.22s ease, filter 0.18s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          -webkit-tap-highlight-color: transparent;
          text-shadow: 0 1px 0 rgba(40, 60, 30, 0.28);
          margin-top: 10px;
          overflow: hidden;
        }
        .bs-brew-btn::after {
          content: '';
          position: absolute;
          inset: 2px;
          border-radius: 9999px;
          background: radial-gradient(60% 100% at 50% 0%, rgba(255,255,255,0.16), transparent 65%);
          pointer-events: none;
          opacity: 0.9;
        }
        .bs-brew-btn__label {
          position: relative;
          z-index: 1;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .bs-brew-btn:active:not(:disabled) {
          transform: scale(0.985) translateY(1px);
          box-shadow:
            inset 0 1.5px 0 rgba(255, 255, 255, 0.16),
            inset 0 0 12px rgba(40, 60, 30, 0.18),
            0 1px 3px rgba(60, 40, 20, 0.10),
            0 4px 10px rgba(88, 125, 73, 0.24);
          filter: brightness(0.96);
        }
        .bs-brew-btn:disabled {
          cursor: not-allowed;
          opacity: 0.55;
          box-shadow: none;
        }
        .bs-brew-btn--brewing {
          background: linear-gradient(180deg, #6B8E5C 0%, #587D49 100%);
          box-shadow: 0 1px 3px rgba(60, 40, 20, 0.08), 0 4px 12px rgba(107, 142, 92, 0.24);
          animation: bsBrewPulse 1.6s ease-in-out infinite;
        }
        /* Barista mode keeps the same BREW size — the active bar above already
           signals session mode. No need to fight for attention twice. */
        @keyframes bsBrewPulse {
          0%, 100% { box-shadow: 0 1px 3px rgba(60, 40, 20, 0.08), 0 4px 12px rgba(107, 142, 92, 0.24), 0 0 0 0 rgba(107, 142, 92, 0.0); }
          50%      { box-shadow: 0 1px 3px rgba(60, 40, 20, 0.08), 0 6px 18px rgba(107, 142, 92, 0.32), 0 0 0 8px rgba(107, 142, 92, 0.08); }
        }

        /* ── Coach promise: zero-state preview card ──────────────────── */
        .bs-coach-preview {
          margin-top: 18px;
          padding: 14px 16px 14px;
          background: linear-gradient(180deg, #FFFEFB 0%, #FBF7F1 100%);
          border: 1px dashed rgba(184, 116, 74, 0.42);
          border-radius: 14px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          position: relative;
          animation: fadeIn 0.3s ease-out both;
        }
        .bs-coach-preview__badge {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 1.2px;
          text-transform: uppercase;
          color: var(--copper);
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        .bs-coach-preview__dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--copper);
          box-shadow: 0 0 0 3px rgba(184, 116, 74, 0.18);
        }
        .bs-coach-preview__row {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .bs-coach-preview__pill {
          background: rgba(184, 116, 74, 0.14);
          color: var(--copper-deep);
          font-size: 13px;
          font-weight: 700;
          padding: 4px 10px;
          border-radius: 9999px;
        }
        .bs-coach-preview__from {
          color: var(--text-tertiary);
          text-decoration: line-through;
          font-weight: 500;
        }
        .bs-coach-preview__arrow {
          color: var(--text-tertiary);
          font-weight: 700;
        }
        .bs-coach-preview__to {
          font-size: 16px;
          font-weight: 800;
          color: var(--text-primary);
        }
        .bs-coach-preview__why {
          font-size: 12.5px;
          color: var(--text-secondary);
          line-height: 1.4;
        }
        .bs-coach-preview__caption {
          font-size: 12px;
          color: var(--accent-green);
          font-weight: 600;
          padding-top: 6px;
          border-top: 1px solid var(--border-light);
          margin-top: 2px;
          letter-spacing: 0.1px;
        }

        /* ── Coach line (returning users, above BREW) ────────────────── */
        .bs-coach-line {
          text-align: center;
          font-size: 12px;
          font-weight: 500;
          color: var(--accent-green);
          margin: 8px 0 -2px;
          letter-spacing: 0.2px;
          line-height: 1.4;
          opacity: 0.85;
          text-transform: none;
        }

        /* Pulsing dots */
        .bs-btn__dots {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .bs-btn__dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: rgba(255,255,255,0.9);
          animation: bs-dot-pulse 1.2s ease-in-out infinite;
        }
        .bs-btn__dot:nth-child(2) { animation-delay: 0.2s; }
        .bs-btn__dot:nth-child(3) { animation-delay: 0.4s; }
        @keyframes bs-dot-pulse {
          0%, 80%, 100% { opacity: 0.25; transform: scale(0.75); }
          40% { opacity: 1; transform: scale(1); }
        }

        /* ── Taste feedback card ──────────────────────────────────────── */
        .bs-taste-card {
          background: var(--white);
          border-radius: 18px;
          border: 1px solid var(--border-light);
          box-shadow: 0 1px 3px rgba(60, 40, 20, 0.06), 0 6px 18px rgba(60, 40, 20, 0.05);
          overflow: hidden;
          animation: fadeIn 0.22s ease-out both;
        }

        .bs-taste-card__header {
          padding: 14px 16px 8px;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 1.4px;
          color: var(--text-tertiary);
          text-transform: uppercase;
        }

        .bs-taste-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          column-gap: 8px;
          row-gap: 14px;
          padding: 4px 16px 14px;
          position: relative;
        }
        /* Subtle full-width divider between the flavor and strength rows. */
        .bs-taste-grid::before {
          content: '';
          position: absolute;
          left: 16px;
          right: 16px;
          top: calc(50% - 1px);
          height: 1px;
          background: var(--border-light);
          pointer-events: none;
        }

        .bs-taste-btn {
          padding: 10px 4px;
          border-radius: 12px;
          background: var(--cream);
          border: 1px solid var(--border-light);
          font-size: 13px;
          font-weight: 600;
          color: var(--text-secondary);
          cursor: pointer;
          transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease, box-shadow 0.12s ease;
          -webkit-tap-highlight-color: transparent;
          text-align: center;
        }
        .bs-taste-btn--selected {
          background: var(--accent-green-tint);
          border-color: var(--accent-green);
          color: var(--accent-green);
          box-shadow: 0 0 0 2px rgba(107, 142, 92, 0.18);
        }
        .bs-taste-btn:active {
          transform: scale(0.96);
        }

        .bs-taste-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 14px 14px;
          border-top: 1px solid var(--border-light);
          gap: 8px;
        }

        .bs-taste-skip {
          font-size: 13px;
          font-weight: 500;
          color: var(--text-tertiary);
          background: none;
          border: none;
          cursor: pointer;
          padding: 6px 4px;
          -webkit-tap-highlight-color: transparent;
        }
        .bs-taste-skip:active { color: var(--text-primary); }

        .bs-taste-done {
          padding: 9px 22px;
          border-radius: 9999px;
          background: var(--accent-green);
          color: #fff;
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.3px;
          border: none;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
          transition: transform 0.08s ease, background 0.15s ease;
          box-shadow: 0 2px 8px rgba(107, 142, 92, 0.22);
        }
        .bs-taste-done:active {
          transform: scale(0.96);
          opacity: 0.88;
        }

        /* ── First-time tip card ──────────────────────────────────────── */
        .bs-tip-card {
          display: flex;
          gap: 14px;
          align-items: flex-start;
          background: var(--white);
          border-radius: 14px;
          border: 1px solid var(--border);
          padding: 16px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.06);
        }
        .bs-tip-card__icon {
          color: var(--accent-green);
          flex-shrink: 0;
          margin-top: 2px;
        }
        .bs-tip-card__body {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        .bs-tip-card__title {
          font-size: 13px;
          font-weight: 700;
          color: var(--text-primary);
        }
        .bs-tip-card__text {
          font-size: 12px;
          color: var(--text-tertiary);
          line-height: 1.5;
        }

        /* ── Data Entry Modal ─────────────────────────────────────────── */
        .bs-modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.5);
          backdrop-filter: blur(4px);
          -webkit-backdrop-filter: blur(4px);
          display: flex;
          align-items: flex-end;
          justify-content: center;
          z-index: 100;
        }
        .bs-modal {
          width: 100%;
          max-width: var(--app-max-width);
          background: var(--white);
          border-radius: 20px 20px 0 0;
          padding: 20px 16px calc(24px + var(--safe-bottom));
          box-shadow: var(--shadow-lg);
          animation: bs-modal-up 0.28s cubic-bezier(0.32, 0.72, 0, 1) both;
        }
        @keyframes bs-modal-up {
          from { transform: translateY(100%); }
          to   { transform: translateY(0); }
        }
        .bs-modal__header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 16px;
        }
        .bs-modal__title {
          font-size: 17px;
          font-weight: 700;
          color: var(--text-primary);
          letter-spacing: -0.2px;
        }
        .bs-modal__close {
          width: 30px;
          height: 30px;
          border-radius: 50%;
          background: var(--off-white);
          border: 1px solid var(--border);
          font-size: 12px;
          color: var(--text-tertiary);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: background 0.15s ease;
          -webkit-tap-highlight-color: transparent;
        }
        .bs-modal__close:active { background: var(--border); }

        .bs-modal__tabs {
          display: flex;
          background: var(--off-white);
          border: 1px solid var(--border);
          border-radius: var(--radius-full);
          padding: 3px;
          margin-bottom: 20px;
        }
        .bs-modal__tab {
          flex: 1;
          padding: 9px 12px;
          font-size: 13px;
          font-weight: 600;
          color: var(--text-tertiary);
          border-radius: var(--radius-full);
          background: none;
          border: none;
          cursor: pointer;
          transition: var(--transition);
          text-align: center;
          -webkit-tap-highlight-color: transparent;
        }
        .bs-modal__tab--active {
          background: var(--accent-green);
          color: var(--white);
          box-shadow: 0 1px 4px rgba(107, 142, 92, 0.28);
        }

        .bs-modal__body {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .bs-modal__field {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .bs-modal__field-label {
          font-size: 11px;
          font-weight: 600;
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.8px;
        }
        .bs-modal__input {
          width: 100%;
          padding: 14px 16px;
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          font-size: 22px;
          font-weight: 700;
          color: var(--text-primary);
          background: var(--off-white);
          transition: border-color 0.15s ease, background 0.15s ease;
          outline: none;
          -webkit-appearance: none;
          appearance: none;
          font-variant-numeric: tabular-nums;
          text-align: center;
          letter-spacing: -0.5px;
        }
        .bs-modal__input:focus {
          border-color: var(--accent-green);
          background: var(--white);
        }
        .bs-modal__save {
          width: 100%;
          height: 52px;
          border-radius: 14px;
          background: var(--accent-green);
          color: var(--white);
          font-family: var(--font-primary);
          font-size: 15px;
          font-weight: 700;
          letter-spacing: 0.5px;
          border: none;
          cursor: pointer;
          box-shadow: 0 2px 8px rgba(107, 142, 92, 0.24);
          transition: opacity 0.15s ease, transform 0.1s ease;
          -webkit-tap-highlight-color: transparent;
        }
        .bs-modal__save:active:not(:disabled) {
          transform: scale(0.97);
          opacity: 0.9;
        }
        .bs-modal__save:disabled {
          background: var(--grey-light);
          box-shadow: none;
          cursor: not-allowed;
        }

        /* Timer display */
        .bs-timer-display {
          text-align: center;
          font-size: 56px;
          font-weight: 700;
          color: var(--text-primary);
          letter-spacing: -1px;
          line-height: 1;
          font-variant-numeric: tabular-nums;
          font-family: 'SF Mono', 'Fira Code', 'Courier New', monospace;
          padding: 8px 0 16px;
        }
        .bs-timer-btns {
          display: flex;
          justify-content: center;
          gap: 10px;
        }
        .bs-timer-btn {
          min-width: 110px;
          height: 46px;
          border-radius: var(--radius-md);
          font-size: 14px;
          font-weight: 700;
          border: none;
          cursor: pointer;
          transition: var(--transition);
          -webkit-tap-highlight-color: transparent;
        }
        .bs-timer-btn--start {
          background: var(--accent-green);
          color: var(--white);
          box-shadow: 0 2px 8px rgba(107, 142, 92, 0.24);
        }
        .bs-timer-btn--stop {
          background: #A05050;
          color: var(--white);
          box-shadow: 0 2px 8px rgba(160, 80, 80, 0.22);
        }
        .bs-timer-btn--reset {
          background: var(--off-white);
          color: var(--text-secondary);
          border: 1px solid var(--border);
        }
        .bs-timer-btn:active {
          transform: scale(0.96);
          opacity: 0.9;
        }

        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        @keyframes scoreReveal {
          0%   { opacity: 0; transform: scale(0.5); }
          70%  { transform: scale(1.08); }
          100% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  )
}
