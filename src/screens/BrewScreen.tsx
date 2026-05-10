import React, { useState, useEffect, useRef, useCallback } from 'react'
import type { BrewmieState, AppAction, ShotEntry } from '../types'
import type { AlgoParams } from '../lib/supabase'

// ─── Types ────────────────────────────────────────────────────────────────────

type BrewPhase = 'idle' | 'brewing' | 'logging' | 'taste' | 'rated'
type LogTab = 'manual' | 'timer'

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
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface BrewScreenProps {
  state: BrewmieState
  dispatch: React.Dispatch<AppAction>
  onNavigateToSetup: () => void
  weather: { temp: number; humidity: number } | null
  algoParams?: AlgoParams | null
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

// Minimum real Brewmie shots before we trust learned params over defaults
const MIN_SHOTS_TO_LEARN = 30

// Roast-level time offsets derived from 19,546 Visualizer.coffee community shots.
// Represents how many seconds each roast level naturally deviates from the
// community baseline of 32.1s. Used to normalise timeDelta so a dark roast
// running 4s long isn't misread as a grind problem.
const ROAST_TIME_OFFSET: Record<string, number> = {
  'light':       -1.5,   // avg 30.6s  (lighter = less dense = faster)
  'medium-light': -0.5,  // interpolated between light and medium
  'medium':       1.0,   // avg 33.1s
  'medium-dark':  0.0,   // avg 32.1s  (same as baseline)
  'dark':         4.0,   // avg 36.1s  (denser, more soluble, runs long)
}

function effectToStep(avgTd: number | null, defaultStep: number): number {
  if (avgTd === null) return defaultStep
  const abs = Math.abs(avgTd)
  if (abs < 0.5) return 0
  const dir = avgTd > 0 ? 1 : -1
  return dir * (abs >= 1.5 ? 0.5 : 0.25)
}

function computeAdjustments(
  actualTime: number,
  actualVolume: number,
  targetTime: number,
  targetVolume: number,
  inputDose: number,
  weather: { temp: number; humidity: number } | null,
  beanAgeDays: number | null,
  roastLevel: string | null,
  algoParams?: AlgoParams | null,
): { grindAdjust: number; doseAdjust: number; volumeAdjust: number; timeAdjust: number; tampAdjust: number } {
  const p = (algoParams && algoParams.n >= MIN_SHOTS_TO_LEARN) ? algoParams : null
  const timeWindow = p?.time_window ?? 3

  // Roast-normalised delta: subtract the natural roast offset so we only react
  // to deviations that are likely grind/equipment related, not roast-inherent.
  const roastOffset = roastLevel ? (ROAST_TIME_OFFSET[roastLevel] ?? 0) : 0
  const timeDelta = (actualTime - targetTime) - roastOffset
  let grindAdjust = timeDelta > timeWindow ? 0.5 : timeDelta < -timeWindow ? -0.5 : 0

  // Bean age: fresh beans outgas CO2 → shots run long → go coarser
  //           stale beans extract faster → shots run short → go finer
  if (beanAgeDays !== null) {
    if (beanAgeDays <= 5)       grindAdjust += effectToStep(p?.age_fresh ?? null,  0.5)
    else if (beanAgeDays >= 28) grindAdjust += effectToStep(p?.age_stale ?? null, -0.5)
  }

  // Humidity: high swells grounds → shots run long → go coarser
  //           low → grounds dry/loose → shots run short → go finer
  // Temperature: hot speeds extraction → shots run short → go finer
  //              cold slows extraction → shots run long → go coarser
  if (weather) {
    if (weather.humidity > 70)      grindAdjust += effectToStep(p?.hum_hi ?? null,  0.5)
    else if (weather.humidity < 40) grindAdjust += effectToStep(p?.hum_lo ?? null, -0.5)
    if (weather.temp > 28)          grindAdjust += effectToStep(p?.tmp_hi ?? null, -0.5)
    else if (weather.temp < 15)     grindAdjust += effectToStep(p?.tmp_lo ?? null,  0.5)
  }

  grindAdjust = Math.max(-1.5, Math.min(1.5, Math.round(grindAdjust * 2) / 2))

  const volumeDelta = actualVolume - targetVolume
  const volumeAdjust = volumeDelta > 3 ? -2 : volumeDelta < -3 ? 2 : 0
  const doseAdjust = 0
  const timeAdjust = 0

  const actualRatio = actualVolume / inputDose
  const targetRatio = targetVolume / inputDose
  const ratioDelta = Math.abs(actualRatio - targetRatio)
  const tampAdjust = (grindAdjust === 0 && ratioDelta > 0.4)
    ? (actualRatio > targetRatio ? 1 : -1)
    : 0

  return { grindAdjust, doseAdjust, volumeAdjust, timeAdjust, tampAdjust }
}

function scoreColor(score: number): string {
  if (score >= 95) return 'var(--gold-dark)'
  if (score >= 85) return 'var(--accent-green)'
  if (score >= 70) return '#6B7280'
  return '#8B1A1A'
}

function scoreTierLabel(score: number): string {
  if (score >= 95) return 'Perfect'
  if (score >= 85) return 'Excellent'
  if (score >= 70) return 'Good'
  return 'Needs work'
}

const TAMP_STEPS = [
  { label: 'Soft', value: 25 },
  { label: 'Mid',  value: 50 },
  { label: 'Firm', value: 75 },
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
interface RowConfig {
  key: keyof BrewTargets
  label: string
  unit: string
  step: number
  adjustKey: keyof Omit<ShotResult, 'score' | 'actuals'>
  section: 'recipe' | 'targets'
}

const ROWS: RowConfig[] = [
  { key: 'grind',  label: 'Grind',  unit: 'setting', step: 0.5, adjustKey: 'grindAdjust',  section: 'recipe'  },
  { key: 'dose',   label: 'Dose',   unit: 'g',       step: 0.5, adjustKey: 'doseAdjust',   section: 'recipe'  },
  { key: 'tamp',   label: 'Tamp',   unit: '',        step: 25,  adjustKey: 'tampAdjust',   section: 'recipe'  },
  { key: 'volume', label: 'Volume', unit: 'ml',      step: 1,   adjustKey: 'volumeAdjust', section: 'targets' },
  { key: 'time',   label: 'Time',   unit: 's',       step: 1,   adjustKey: 'timeAdjust',   section: 'targets' },
]

const RECIPE_ROWS = ROWS.filter((r) => r.section === 'recipe')
const TARGET_ROWS = ROWS.filter((r) => r.section === 'targets')

// ─── Sub-components ───────────────────────────────────────────────────────────

function BrewingDots() {
  return (
    <span className="bs-btn__dots" aria-label="Brewing">
      <span className="bs-btn__dot" />
      <span className="bs-btn__dot" />
      <span className="bs-btn__dot" />
    </span>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function BrewScreen({ state, dispatch, onNavigateToSetup, weather, algoParams }: BrewScreenProps) {
  // ── Derived defaults from state
  const initTargets = useCallback(() => defaultTargets(state), [])
  const [targets, setTargets] = useState<BrewTargets>(initTargets)

  // ── Phase
  const [phase, setPhase] = useState<BrewPhase>('idle')

  // ── Card display state: 'targets' or 'results'
  const [cardState, setCardState] = useState<'targets' | 'results'>('targets')
  const [cardVisible, setCardVisible] = useState(true)

  // ── Modal / logging
  const [logTab, setLogTab] = useState<LogTab>('manual')
  const [manualTime, setManualTime] = useState('')
  const [manualVolume, setManualVolume] = useState('')

  // ── Timer
  const [timerRunning, setTimerRunning] = useState(false)
  const [timerSecs, setTimerSecs] = useState(0)
  const [timerStopped, setTimerStopped] = useState(false)
  const [timerVolume, setTimerVolume] = useState('')
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timerStartRef = useRef<number | null>(null)

  // ── Result
  const [result, setResult] = useState<ShotResult | null>(null)

  // ── Saved shot id (for taste update)
  const [savedShotId, setSavedShotId] = useState<string | null>(null)

  // ── Taste feedback state
  const [tasteFlavor, setTasteFlavor] = useState<'sour' | 'balanced' | 'bitter' | null>(null)
  const [tasteStrength, setTasteStrength] = useState<'weak' | 'perfect' | 'strong' | null>(null)

  // ── Validation
  const [brewError, setBrewError] = useState<string | null>(null)

  // ── Brew button timer ref
  const brewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ─── Computed bean info ──────────────────────────────────────────────────────
  const beans = state.beans
  const age = beans ? beanAge(beans.roastDate, beans.beanAge) : null

  // ─── Target adjust helpers ───────────────────────────────────────────────────
  function adjustTarget(key: keyof BrewTargets, delta: number) {
    setTargets((prev) => {
      const raw = prev[key] + delta
      let next = raw
      if (key === 'dose') next = Math.max(5, Math.min(30, raw))
      if (key === 'volume') next = Math.max(10, Math.min(120, raw))
      if (key === 'time') next = Math.max(10, Math.min(60, raw))
      if (key === 'tamp') next = Math.max(0, Math.min(100, raw))
      if (key === 'grind') {
        const min = state.grinder?.minSetting ?? 1
        const max = state.grinder?.maxSetting ?? 40
        next = Math.max(min, Math.min(max, raw))
      }
      return { ...prev, [key]: Math.round(next * 2) / 2 }
    })
  }

  // ─── Validation ──────────────────────────────────────────────────────────────
  function validate(): string | null {
    const ratio = targets.volume / targets.dose
    if (ratio < 1 || ratio > 4.5) {
      return `Ratio ${ratio.toFixed(1)}:1 is outside 1:1–4.5:1 range`
    }
    if (targets.time < 15 || targets.time > 45) {
      return `Target time ${targets.time}s must be 15–45s`
    }
    return null
  }

  // ─── Card transition helper ──────────────────────────────────────────────────
  function transitionCard(to: 'targets' | 'results') {
    setCardVisible(false)
    setTimeout(() => {
      setCardState(to)
      setCardVisible(true)
    }, 180)
  }

  // ─── BREW tap ────────────────────────────────────────────────────────────────
  function handleBrew() {
    const err = validate()
    if (err) {
      setBrewError(err)
      setTimeout(() => setBrewError(null), 3000)
      return
    }
    setBrewError(null)
    setResult(null)
    setPhase('brewing')
    // Pre-fill log actuals with target values
    setManualTime(String(targets.time))
    setManualVolume(String(targets.volume))
    setTimerVolume(String(targets.volume))
    setTimerSecs(0)
    setTimerStopped(false)
    setLogTab('manual')

    brewTimerRef.current = setTimeout(() => {
      setPhase('logging')
    }, 1500)
  }

  // ─── Cancel modal ────────────────────────────────────────────────────────────
  function handleCancel() {
    stopTimer()
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
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (brewTimerRef.current) clearTimeout(brewTimerRef.current)
    }
  }, [])

  // ─── Save shot ───────────────────────────────────────────────────────────────
  function handleSave(actualTime: number, actualVolume: number) {
    const score = computeScore(actualTime, actualVolume, targets.time, targets.volume, targets.dose)
    const adjs = computeAdjustments(actualTime, actualVolume, targets.time, targets.volume, targets.dose, weather, age, state.beans?.roastLevel ?? null, algoParams)
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
      tasteFlavor: null,
      tasteStrength: null,
      beanAge: age,
      roastLevel: beans?.roastLevel ?? null,
      temp: weather?.temp ?? null,
      humidity: weather?.humidity ?? null,
    }

    dispatch({ type: 'ADD_SHOT', payload: shot })
    dispatch({ type: 'SET_CURRENT_GRIND', payload: targets.grind })

    const newResult: ShotResult = {
      score,
      ...adjs,
      actuals: { volume: actualVolume, time: actualTime },
    }
    setResult(newResult)
    setSavedShotId(shotId)
    setTasteFlavor(null)
    setTasteStrength(null)
    stopTimer()

    // Transition card to results view, then go to taste phase
    transitionCard('results')
    setPhase('taste')
  }

  function handleManualSave() {
    const t = parseFloat(manualTime)
    const v = parseFloat(manualVolume)
    if (isNaN(t) || isNaN(v) || t <= 0 || v <= 0) return
    handleSave(t, v)
  }

  function handleTimerSave() {
    const v = parseFloat(timerVolume)
    if (isNaN(v) || v <= 0) return
    handleSave(parseFloat(timerSecs.toFixed(1)), v)
  }

  // ─── Taste phase handlers ─────────────────────────────────────────────────────
  function handleTasteDone() {
    if (savedShotId && (tasteFlavor || tasteStrength)) {
      dispatch({
        type: 'UPDATE_SHOT',
        payload: { id: savedShotId, updates: { tasteFlavor, tasteStrength } },
      })
    }
    setPhase('rated')
  }

  function handleTasteSkip() {
    setPhase('rated')
  }

  // ─── Apply single adjustment ──────────────────────────────────────────────────
  function applyAdjustment(row: RowConfig) {
    if (!result) return
    const adjVal = result[row.adjustKey] as number
    if (adjVal === 0) return
    const newVal = Math.round((targets[row.key] + adjVal) * 2) / 2
    setTargets((prev) => ({ ...prev, [row.key]: newVal }))
    // Zero out the adjustment in displayed result so UI updates
    setResult((prev) => prev ? { ...prev, [row.adjustKey]: 0 } : prev)
  }

  function applyAllAdjustments() {
    if (!result) return
    setTargets((prev) => {
      const next = { ...prev }
      for (const row of ROWS) {
        const adjVal = result[row.adjustKey] as number
        if (adjVal !== 0) {
          next[row.key] = Math.round((prev[row.key] + adjVal) * 2) / 2
        }
      }
      return next
    })
    setResult((prev) => {
      if (!prev) return prev
      return { ...prev, grindAdjust: 0, doseAdjust: 0, volumeAdjust: 0, timeAdjust: 0, tampAdjust: 0 }
    })
  }

  // ─── Edit targets (from results back to targets) ──────────────────────────────
  function handleEditTargets() {
    transitionCard('targets')
    setPhase('idle')
    setResult(null)
  }

  // ─── Brew again ──────────────────────────────────────────────────────────────
  function handleBrewAgain() {
    handleBrew()
  }

  // ─── Bean age display helpers ─────────────────────────────────────────────────
  function beanAgeColor(): string {
    if (age === null) return 'inherit'
    if (age > 30) return '#C2410C'
    if (age > 21) return '#D97706'
    return 'inherit'
  }

  function beanWindowLabel(): string | null {
    if (age === null) return null
    const optimalEnd = 30
    const start = 7
    if (age < start) return `Day ${age} — resting, best after day ${start}`
    return `Day ${age} of ~${optimalEnd} optimal window`
  }

  const isMachineConfigured = !!state.machine

  // ─── Parameter stepper row ────────────────────────────────────────────────────
  function renderParamRow(row: RowConfig, isLast: boolean, sectionChip?: { text: string; variant: 'recipe' | 'targets' }) {
    const isManualTamp = row.key === 'tamp' && (state.tamp?.type === 'manual' || !state.tamp)
    const isFixedTamp  = row.key === 'tamp' && state.tamp && state.tamp.type !== 'manual'
    const fixedPressure = state.tamp?.type === 'spring' ? state.tamp.springPressure : state.tamp?.autoPressure

    return (
      <div key={row.key} className={`bs-param-row${!isLast ? ' bs-param-row--sep' : ''}${sectionChip ? ' bs-param-row--section-start' : ''}`}>
        {sectionChip && (
          <span className={`bs-inline-chip bs-inline-chip--${sectionChip.variant}`}>{sectionChip.text}</span>
        )}
        <span className="bs-param-row__label">{row.label}</span>

        {/* Manual tamp: Soft / Mid / Firm buttons */}
        {isManualTamp ? (
          <div className="bs-tamp-group">
            {TAMP_STEPS.map((step) => (
              <button
                key={step.label}
                className={`bs-tamp-btn${targets.tamp === step.value ? ' bs-tamp-btn--active' : ''}`}
                onClick={() => setTargets((prev) => ({ ...prev, tamp: step.value }))}
                type="button"
              >
                {step.label}
              </button>
            ))}
          </div>
        ) : isFixedTamp ? (
          /* Spring/Auto tamp: read-only pressure display */
          <div className="bs-tamp-fixed">
            <span className="bs-tamp-fixed__val">{fixedPressure ?? '—'}</span>
            <span className="bs-tamp-fixed__unit">kg</span>
            <span className="bs-tamp-fixed__badge">{state.tamp!.type === 'spring' ? 'spring' : 'auto'}</span>
          </div>
        ) : (
          /* Standard stepper for all other rows */
          <div className="bs-param-row__controls">
          <button
            className="bs-stepper"
            onClick={() => adjustTarget(row.key, -row.step)}
            type="button"
            aria-label={`Decrease ${row.label}`}
          >
            −
          </button>
          <div className="bs-param-row__value-group">
            <span className="bs-param-row__value">{targets[row.key]}</span>
            <span className="bs-param-row__unit">{row.unit}</span>
          </div>
          <button
            className="bs-stepper bs-stepper--plus"
            onClick={() => adjustTarget(row.key, row.step)}
            type="button"
            aria-label={`Increase ${row.label}`}
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
        {RECIPE_ROWS.map((row, idx) => renderParamRow(
          row,
          idx === RECIPE_ROWS.length - 1,
          idx === 0 ? { text: 'RECIPE', variant: 'recipe' } : undefined
        ))}
        {TARGET_ROWS.map((row, idx) => renderParamRow(
          row,
          idx === TARGET_ROWS.length - 1,
          idx === 0 ? { text: 'TARGETS', variant: 'targets' } : undefined
        ))}
      </div>
    )
  }

  // ─── Results card ─────────────────────────────────────────────────────────────
  function renderResultsCard() {
    if (!result) return null
    const color = scoreColor(result.score)
    const tier = scoreTierLabel(result.score)
    const hasAnyAdjust = ROWS.some((row) => (result[row.adjustKey] as number) !== 0)

    return (
      <div className="bs-param-card">
        {/* Score top section */}
        <div className="bs-results-score-row">
          <div className="bs-results-score-num animate-score" style={{ color }}>{result.score}</div>
          <div className="bs-results-score-tier" style={{ color }}>{tier}</div>
        </div>

        <div className="bs-results-divider" />

        {/* Per-parameter adjustment rows */}
        {ROWS.map((row, idx) => {
          const adjVal = result[row.adjustKey] as number
          const targetVal = targets[row.key]
          const recommendedVal = Math.round((targetVal + adjVal) * 2) / 2
          const isLast = idx === ROWS.length - 1

          return (
            <div key={row.key} className={`bs-adj-row${!isLast ? ' bs-adj-row--sep' : ''}`}>
              <span className="bs-adj-row__label">{row.label}</span>
              {adjVal === 0 ? (
                <span className="bs-adj-row__ontarget">On target</span>
              ) : (
                <div className="bs-adj-row__change">
                  <span className="bs-adj-row__from">{targetVal}{row.unit}</span>
                  <span className="bs-adj-row__arrow">→</span>
                  <span className="bs-adj-row__to">{recommendedVal}{row.unit}</span>
                  <button
                    className="bs-adj-apply"
                    onClick={() => applyAdjustment(row)}
                    type="button"
                  >
                    Apply
                  </button>
                </div>
              )}
            </div>
          )
        })}

        {/* Auto-apply toggle */}
        <div className="bs-auto-apply-row">
          <span className="bs-auto-apply-row__label">Auto-apply AI adjustments</span>
          <button
            className={`bs-toggle${state.autoApplyAdjustments ? ' bs-toggle--on' : ''}`}
            onClick={() => dispatch({ type: 'SET_AUTO_APPLY', payload: !state.autoApplyAdjustments })}
            type="button"
            role="switch"
            aria-checked={state.autoApplyAdjustments}
            aria-label="Auto-apply AI adjustments"
          >
            <span className="bs-toggle__thumb" />
          </button>
        </div>

        {/* Apply all button */}
        {hasAnyAdjust && (
          <div className="bs-apply-all-wrap">
            <button className="bs-apply-all-btn" onClick={applyAllAdjustments} type="button">
              Apply all
            </button>
          </div>
        )}

        {/* Edit targets link */}
        <button className="bs-edit-targets" onClick={handleEditTargets} type="button">
          Edit targets
        </button>
      </div>
    )
  }

  // ─── Taste card ───────────────────────────────────────────────────────────────
  function renderTasteCard() {
    return (
      <div className="bs-taste-card">
        <div className="bs-taste-card__header">HOW DID IT TASTE?</div>

        <div className="bs-taste-grid">
          {(['sour', 'balanced', 'bitter'] as const).map((f) => (
            <button
              key={f}
              className={`bs-taste-btn${tasteFlavor === f ? ' bs-taste-btn--selected' : ''}`}
              onClick={() => setTasteFlavor(tasteFlavor === f ? null : f)}
              type="button"
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
          {(['weak', 'perfect', 'strong'] as const).map((s) => (
            <button
              key={s}
              className={`bs-taste-btn${tasteStrength === s ? ' bs-taste-btn--selected' : ''}`}
              onClick={() => setTasteStrength(tasteStrength === s ? null : s)}
              type="button"
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        <div className="bs-taste-footer">
          <button className="bs-taste-skip" onClick={handleTasteSkip} type="button">
            Skip
          </button>
          <button className="bs-taste-done" onClick={handleTasteDone} type="button">
            Done →
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
          <span className="bs-setup-pill__text">Complete setup for better guidance</span>
          <span className="bs-setup-pill__chevron">›</span>
        </button>
      )}

      {/* ── Bean + Weather card — only shown once machine is configured ── */}
      {isMachineConfigured && (
        <div className="bs-bean-card">
          <div className="bs-bean-card__left">
            {beans ? (
              <>
                <span className="bs-bean-card__name">{beans.brand} {beans.type}</span>
                {beanWindowLabel() && (
                  <span
                    className="bs-bean-card__age"
                    style={{ color: beanAgeColor() }}
                  >
                    {beanWindowLabel()}
                    {age !== null && age > 30 && (
                      <span className="bs-bean-card__stale"> · Getting stale</span>
                    )}
                  </span>
                )}
              </>
            ) : (
              <button
                className="bs-bean-card__configure"
                onClick={onNavigateToSetup}
                type="button"
              >
                Add beans →
              </button>
            )}
          </div>
          <div className="bs-bean-card__right">
            {weather ? (
              <span className="bs-bean-card__weather">{weather.temp}°C · {weather.humidity}% RH</span>
            ) : null}
          </div>
        </div>
      )}

      {/* ── Validation error ── */}
      {brewError && (
        <div className="bs-error-banner" role="alert">{brewError}</div>
      )}

      {/* ── Two-state card with fade-up transition ── */}
      <div
        className={`bs-card-wrap${cardVisible ? ' bs-card-wrap--visible' : ' bs-card-wrap--hidden'}`}
      >
        {cardState === 'targets' ? renderTargetsCard() : renderResultsCard()}
      </div>

      {/* ── Taste feedback card (inline, below results) ── */}
      {phase === 'taste' && renderTasteCard()}

      {/* ── BREW button ── */}
      <button
        className={`bs-brew-btn${phase === 'brewing' ? ' bs-brew-btn--brewing' : ''}`}
        onClick={
          (phase === 'idle' || phase === 'rated')
            ? (cardState === 'results' ? handleBrewAgain : handleBrew)
            : undefined
        }
        disabled={phase === 'brewing' || phase === 'logging' || phase === 'taste'}
        type="button"
      >
        {phase === 'brewing'
          ? <BrewingDots />
          : cardState === 'results'
            ? 'BREW AGAIN'
            : 'BREW'}
      </button>

      {/* ── First-time tip (no shots yet) ── */}
      {state.shots.length === 0 && phase === 'idle' && (
        <div className="bs-tip-card">
          <div className="bs-tip-card__icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/>
              <line x1="6" y1="2" x2="6" y2="4"/><line x1="10" y1="2" x2="10" y2="4"/><line x1="14" y1="2" x2="14" y2="4"/>
            </svg>
          </div>
          <div className="bs-tip-card__body">
            <span className="bs-tip-card__title">Ready to dial in?</span>
            <span className="bs-tip-card__text">Set your grind, dose, and targets above, then hit BREW. Log your actual time and volume to get your first adjustment recommendation.</span>
          </div>
        </div>
      )}

      {/* ── Data entry modal ── */}
      {phase === 'logging' && (
        <div className="bs-modal-backdrop" role="dialog" aria-modal="true" aria-label="Log your shot">
          <div className="bs-modal">
            <div className="bs-modal__header">
              <span className="bs-modal__title">Log your shot</span>
              <button
                className="bs-modal__close"
                onClick={handleCancel}
                type="button"
                aria-label="Cancel"
              >
                ✕
              </button>
            </div>

            {/* Tabs */}
            <div className="bs-modal__tabs">
              <button
                className={`bs-modal__tab${logTab === 'manual' ? ' bs-modal__tab--active' : ''}`}
                onClick={() => setLogTab('manual')}
                type="button"
              >
                Manual Entry
              </button>
              <button
                className={`bs-modal__tab${logTab === 'timer' ? ' bs-modal__tab--active' : ''}`}
                onClick={() => setLogTab('timer')}
                type="button"
              >
                Use Timer
              </button>
            </div>

            {/* Manual entry */}
            {logTab === 'manual' && (
              <div className="bs-modal__body">
                <label className="bs-modal__field">
                  <span className="bs-modal__field-label">Time (seconds)</span>
                  <input
                    className="bs-modal__input"
                    type="number"
                    inputMode="decimal"
                    placeholder={`Target: ${targets.time}s`}
                    value={manualTime}
                    onChange={(e) => setManualTime(e.target.value)}
                    min={1}
                    max={120}
                  />
                </label>
                <label className="bs-modal__field">
                  <span className="bs-modal__field-label">Volume (g)</span>
                  <input
                    className="bs-modal__input"
                    type="number"
                    inputMode="decimal"
                    placeholder={`Target: ${targets.volume}g`}
                    value={manualVolume}
                    onChange={(e) => setManualVolume(e.target.value)}
                    min={1}
                    max={200}
                  />
                </label>
                <button
                  className="bs-modal__save"
                  onClick={handleManualSave}
                  disabled={!manualTime || !manualVolume}
                  type="button"
                >
                  Save Shot
                </button>
              </div>
            )}

            {/* Timer entry */}
            {logTab === 'timer' && (
              <div className="bs-modal__body">
                <div className="bs-timer-display">
                  {timerSecs.toFixed(1)}
                </div>
                <div className="bs-timer-btns">
                  {!timerRunning && !timerStopped && (
                    <button className="bs-timer-btn bs-timer-btn--start" onClick={startTimer} type="button">
                      Start
                    </button>
                  )}
                  {timerRunning && (
                    <button className="bs-timer-btn bs-timer-btn--stop" onClick={stopTimer} type="button">
                      Stop
                    </button>
                  )}
                  {timerStopped && (
                    <button
                      className="bs-timer-btn bs-timer-btn--reset"
                      onClick={() => { setTimerSecs(0); setTimerStopped(false) }}
                      type="button"
                    >
                      Reset
                    </button>
                  )}
                </div>

                {timerStopped && (
                  <>
                    <label className="bs-modal__field">
                      <span className="bs-modal__field-label">Volume (g)</span>
                      <input
                        className="bs-modal__input"
                        type="number"
                        inputMode="decimal"
                        placeholder={`Target: ${targets.volume}g`}
                        value={timerVolume}
                        onChange={(e) => setTimerVolume(e.target.value)}
                        min={1}
                        max={200}
                      />
                    </label>
                    <button
                      className="bs-modal__save"
                      onClick={handleTimerSave}
                      disabled={!timerVolume}
                      type="button"
                    >
                      Save Shot
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        /* ── Screen container ─────────────────────────────────────────── */
        .bs-screen {
          background: #FAF8F5;
          padding: 10px 14px 16px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          min-height: 100%;
        }

        /* ── Setup nudge ─────────────────────────────────────────────── */
        .bs-setup-pill {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          padding: 9px 14px;
          background: rgba(45, 80, 22, 0.06);
          border-radius: 12px;
          border: 1px solid rgba(45, 80, 22, 0.18);
          cursor: pointer;
          transition: background 0.15s ease, border-color 0.15s ease;
          -webkit-tap-highlight-color: transparent;
        }
        .bs-setup-pill:active {
          background: rgba(45, 80, 22, 0.1);
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

        /* ── Bean + Weather card ──────────────────────────────────────── */
        .bs-bean-card {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          padding: 12px 16px;
          background: #FDFAF5;
          border: 1px solid #E8DFC8;
          border-radius: 14px;
        }
        .bs-bean-card__left {
          display: flex;
          flex-direction: column;
          gap: 3px;
          flex: 1;
          min-width: 0;
        }
        .bs-bean-card__name {
          font-size: 14px;
          font-weight: 600;
          color: var(--text-primary);
          line-height: 1.3;
        }
        .bs-bean-card__age {
          font-size: 12px;
          font-weight: 400;
          color: var(--text-tertiary);
          line-height: 1.3;
        }
        .bs-bean-card__stale {
          font-weight: 500;
          color: #C2410C;
        }
        .bs-bean-card__configure {
          font-size: 13px;
          font-weight: 600;
          color: var(--accent-green);
          background: none;
          border: none;
          padding: 0;
          cursor: pointer;
          text-align: left;
          -webkit-tap-highlight-color: transparent;
        }
        .bs-bean-card__right {
          flex-shrink: 0;
          padding-top: 1px;
        }
        .bs-bean-card__weather {
          font-size: 12px;
          color: var(--text-tertiary);
          white-space: nowrap;
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

        /* ── Card transition wrapper ──────────────────────────────────── */
        .bs-card-wrap {
          transition: opacity 180ms ease-out, transform 280ms ease-out;
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
          border-radius: 20px;
          border: 1px solid var(--border);
          box-shadow: 0 2px 16px rgba(0,0,0,0.06);
          overflow: hidden;
        }

        /* ── Inline section chips (inside first row of each section) ─── */
        .bs-param-row--section-start {
          padding-top: 10px;
        }
        .bs-param-row--section-start + .bs-param-row,
        .bs-param-row--section-start:not(:first-child) {
          border-top: 1px solid var(--border-light);
        }

        .bs-inline-chip {
          display: inline-flex;
          align-items: center;
          align-self: flex-start;
          padding: 2px 8px;
          border-radius: 9999px;
          font-size: 9px;
          font-weight: 800;
          letter-spacing: 1.2px;
          text-transform: uppercase;
          margin-bottom: 2px;
        }
        .bs-inline-chip--recipe {
          background: rgba(212, 160, 23, 0.12);
          color: #A07010;
        }
        .bs-inline-chip--targets {
          background: rgba(45, 80, 22, 0.08);
          color: var(--accent-green);
        }

        /* ── Param row ────────────────────────────────────────────────── */
        .bs-param-row {
          padding: 8px 16px;
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        .bs-param-row--sep {
          border-bottom: 1px solid var(--border-light);
        }

        .bs-param-row__label {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 1px;
          color: var(--text-tertiary);
        }

        .bs-param-row__controls {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .bs-param-row__value-group {
          flex: 1;
          display: flex;
          align-items: baseline;
          justify-content: center;
          gap: 5px;
        }

        .bs-param-row__value {
          font-size: 30px;
          font-weight: 800;
          color: var(--text-primary);
          line-height: 1;
          font-variant-numeric: tabular-nums;
        }

        .bs-param-row__unit {
          font-size: 14px;
          font-weight: 400;
          color: var(--text-tertiary);
          line-height: 1;
        }

        /* Stepper buttons */
        .bs-stepper {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: #FAF8F5;
          border: 1px solid var(--border);
          color: var(--text-secondary);
          font-size: 20px;
          font-weight: 400;
          line-height: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          cursor: pointer;
          transition: background 0.12s ease, border-color 0.12s ease, transform 0.08s ease;
          -webkit-tap-highlight-color: transparent;
        }
        .bs-stepper:active:not(:disabled) {
          transform: scale(0.88);
          background: #F0EDE8;
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
          background: rgba(45, 80, 22, 0.08);
          border-color: var(--accent-green);
          color: var(--accent-green);
        }
        .bs-tamp-btn:active:not(.bs-tamp-btn--active) {
          background: var(--border-light);
        }

        /* ── Fixed tamp (spring/auto) display ────────────────────────── */
        .bs-tamp-fixed {
          display: flex;
          align-items: baseline;
          gap: 4px;
          padding: 4px 0;
        }
        .bs-tamp-fixed__val {
          font-size: 28px;
          font-weight: 800;
          color: var(--text-primary);
          font-variant-numeric: tabular-nums;
        }
        .bs-tamp-fixed__unit {
          font-size: 13px;
          color: var(--text-tertiary);
        }
        .bs-tamp-fixed__badge {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.8px;
          text-transform: uppercase;
          color: var(--text-tertiary);
          background: var(--border-light);
          padding: 2px 7px;
          border-radius: 9999px;
          margin-left: 4px;
        }

        /* ── Results score section ────────────────────────────────────── */
        .bs-results-score-row {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 24px 20px 16px;
          gap: 4px;
        }

        .bs-results-score-num {
          font-size: 64px;
          font-weight: 800;
          line-height: 1;
          letter-spacing: -2px;
          font-variant-numeric: tabular-nums;
          animation: scoreReveal 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) both;
        }

        .bs-results-score-tier {
          font-family: var(--font-brand);
          font-size: 20px;
          font-weight: 600;
          line-height: 1.2;
        }

        .bs-results-divider {
          height: 1px;
          background: var(--border-light);
          margin: 0 20px;
        }

        /* ── Adjustment rows (NEXT SHOT) ──────────────────────────────── */
        .bs-adj-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 11px 16px;
          gap: 8px;
          min-height: 44px;
        }
        .bs-adj-row--sep {
          border-bottom: 1px solid var(--border-light);
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

        /* ── Apply all button ────────────────────────────────────────── */
        .bs-apply-all-wrap {
          padding: 0 16px 4px;
        }
        .bs-apply-all-btn {
          width: 100%;
          height: 40px;
          border-radius: 10px;
          background: rgba(45, 80, 22, 0.08);
          color: var(--accent-green);
          font-size: 13px;
          font-weight: 700;
          border: 1px solid rgba(45, 80, 22, 0.2);
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
          transition: background 0.15s ease, transform 0.08s ease;
        }
        .bs-apply-all-btn:active {
          background: rgba(45, 80, 22, 0.14);
          transform: scale(0.98);
        }

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

        /* ── BREW button ──────────────────────────────────────────────── */
        .bs-brew-btn {
          width: 100%;
          height: 54px;
          border-radius: 14px;
          background: linear-gradient(135deg, #2D5016 0%, #3a6b1e 100%);
          color: var(--white);
          font-family: var(--font-primary);
          font-size: 20px;
          font-weight: 800;
          letter-spacing: 3px;
          text-transform: uppercase;
          border: none;
          cursor: pointer;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.1), 0 4px 16px rgba(45,80,22,0.4);
          transition: transform 0.1s ease, box-shadow 0.1s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          -webkit-tap-highlight-color: transparent;
        }
        .bs-brew-btn:active:not(:disabled) {
          transform: scale(0.97);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.08), 0 2px 8px rgba(45,80,22,0.3);
        }
        .bs-brew-btn:disabled {
          cursor: not-allowed;
          opacity: 0.7;
        }
        .bs-brew-btn--brewing {
          background: linear-gradient(135deg, #1e3d0d 0%, #2D5016 100%);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.05), 0 2px 8px rgba(45,80,22,0.2);
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
          border-radius: 20px;
          border: 1px solid var(--border);
          box-shadow: 0 2px 12px rgba(0,0,0,0.06);
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
          gap: 6px;
          padding: 0 12px 10px;
        }

        .bs-taste-btn {
          padding: 9px 4px;
          border-radius: 10px;
          background: var(--off-white);
          border: 1.5px solid var(--border);
          font-size: 13px;
          font-weight: 600;
          color: var(--text-secondary);
          cursor: pointer;
          transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
          -webkit-tap-highlight-color: transparent;
          text-align: center;
        }
        .bs-taste-btn--selected {
          background: rgba(45, 80, 22, 0.1);
          border-color: var(--accent-green);
          color: var(--accent-green);
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
          padding: 8px 20px;
          border-radius: 9999px;
          background: linear-gradient(135deg, #2D5016 0%, #3a6b1e 100%);
          color: #fff;
          font-size: 13px;
          font-weight: 700;
          border: none;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
          transition: transform 0.08s ease, opacity 0.12s ease;
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
          z-index: 100;
          max-width: var(--app-max-width);
          left: 50%;
          transform: translateX(-50%);
        }
        .bs-modal {
          width: 100%;
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
          box-shadow: 0 1px 4px rgba(45,80,22,0.3);
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
          font-size: 18px;
          font-weight: 500;
          color: var(--text-primary);
          background: var(--off-white);
          transition: border-color 0.15s ease, background 0.15s ease;
          outline: none;
          -webkit-appearance: none;
          appearance: none;
        }
        .bs-modal__input:focus {
          border-color: var(--accent-green);
          background: var(--white);
        }
        .bs-modal__save {
          width: 100%;
          height: 54px;
          border-radius: 14px;
          background: linear-gradient(135deg, #2D5016 0%, #3a6b1e 100%);
          color: var(--white);
          font-family: var(--font-primary);
          font-size: 15px;
          font-weight: 700;
          letter-spacing: 0.5px;
          border: none;
          cursor: pointer;
          box-shadow: 0 2px 8px rgba(45,80,22,0.3);
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
          background: linear-gradient(135deg, #2D5016 0%, #3a6b1e 100%);
          color: var(--white);
          box-shadow: 0 2px 8px rgba(45,80,22,0.3);
        }
        .bs-timer-btn--stop {
          background: #8B1A1A;
          color: var(--white);
          box-shadow: 0 2px 8px rgba(139,26,26,0.3);
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
