import React, { useState, useEffect, useRef } from 'react'
import type {
  BrewmieState,
  AppAction,
  Units,
  RoastLevel,
  TampType,
  MachineConfig,
  GrinderConfig,
  TampConfig,
  BeanConfig,
} from '../types'

// ─── Constants ────────────────────────────────────────────────────────────────

const MACHINE_BRANDS: string[] = [
  'Breville',
  "De'Longhi",
  'Sage',
  'Gaggia',
  'Rancilio',
  'La Marzocco',
  'ECM',
  'Rocket',
  'Lelit',
  'Jura',
  'Profitec',
  'Nespresso',
  'Other',
]

const MACHINE_MODELS: Record<string, string[]> = {
  Breville: ['Barista Express', 'Barista Pro', 'Barista Touch', 'Bambino Plus', 'Oracle', 'Oracle Touch'],
  "De'Longhi": ['Dedica', 'Dedica Style', 'La Specialista', 'La Specialista Maestro', 'Dinamica', 'Eletta Explore'],
  Sage: ['Barista Express', 'Barista Pro', 'Oracle', 'Oracle Touch', 'Bambino', 'Bambino Plus'],
  Gaggia: ['Classic', 'Classic Pro', 'Classic Evo Pro', 'Carezza', 'Magenta Plus'],
  Rancilio: ['Silvia', 'Silvia Pro', 'Silvia Pro X', 'Mia'],
  'La Marzocco': ['Linea Mini', 'GS3', 'Micra', 'Strada'],
  ECM: ['Synchronika', 'Classika PID', 'Puristika', 'Mechanika'],
  Rocket: ['Appartamento', 'Mozzafiato', 'Giotto', 'Boxer'],
  Lelit: ['Bianca', 'Elizabeth', 'Anna', 'Mara X', 'Victoria'],
  Jura: ['ENA 4', 'E8', 'S8', 'Z10', 'X8'],
  Other: [],
}

const BASKET_TYPES = ['Standard', 'Precision/VST', 'Bottomless']

const GRINDER_BRANDS = [
  'Baratza',
  'Eureka',
  'Niche',
  'Fellow',
  'DF64',
  'DF64 Gen 2',
  '1Zpresso',
  'Comandante',
  'Lagom',
  'Mahlkonig',
  'Mazzer',
  'EK43',
  'Other',
]

// Known grinder setting ranges: [min, max]
const GRINDER_PRESETS: Record<string, [number, number]> = {
  'Niche Zero': [0, 50],
  DF64: [0, 64],
  'DF64 Gen 2': [0, 64],
  'Eureka Mignon Specialita': [0, 8],
  'Eureka Mignon Silenzio': [0, 8],
  'Baratza Encore': [1, 40],
  'Baratza Virtuoso+': [1, 40],
  'Lagom P64': [0, 12],
  'Lagom P100': [0, 12],
  'Fellow Ode Gen 2': [1, 11],
  '1Zpresso JX-Pro': [0, 90],
  '1Zpresso Q2': [0, 36],
  'Comandante C40': [0, 40],
  'Mahlkonig EK43': [1, 10],
  'Mahlkonig E65S': [1, 9],
  'Mazzer Mini': [1, 8],
}

const ROAST_LEVELS: { value: RoastLevel; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'medium-light', label: 'Med-Light' },
  { value: 'medium', label: 'Medium' },
  { value: 'medium-dark', label: 'Med-Dark' },
  { value: 'dark', label: 'Dark' },
]

const TODAY_ISO = new Date().toISOString().slice(0, 10)

// Maintenance intervals in days
const BACKFLUSH_INTERVAL_DAYS = 14
const DESCALE_INTERVAL_DAYS = 90
const GRINDER_CLEAN_INTERVAL_DAYS = 28

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysSince(isoDate: string | null): number | null {
  if (!isoDate) return null
  const diff = Date.now() - new Date(isoDate).getTime()
  return Math.floor(diff / (1000 * 60 * 60 * 24))
}

function daysUntilDue(lastDate: string | null, intervalDays: number): number | null {
  const age = daysSince(lastDate)
  if (age === null) return null
  return intervalDays - age
}

function celsiusToFahrenheit(c: number): number {
  return Math.round((c * 9) / 5 + 32)
}

function fahrenheitToCelsius(f: number): number {
  return Math.round(((f - 32) * 5) / 9)
}

function toDateInputValue(isoDate: string | null): string {
  if (!isoDate) return ''
  return isoDate.slice(0, 10)
}

// ─── SVG Icons ────────────────────────────────────────────────────────────────

function IconWrench() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
    </svg>
  )
}

function IconDroplet() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>
    </svg>
  )
}

function IconDisc() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  )
}

function IconLeaf() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z"/>
      <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>
    </svg>
  )
}

function IconClock() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10"/>
      <polyline points="12 6 12 12 16 14"/>
    </svg>
  )
}

function IconRuler() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21.3 8.7 8.7 21.3c-1 1-2.5 1-3.4 0l-2.6-2.6c-1-1-1-2.5 0-3.4L15.3 2.7c1-1 2.5-1 3.4 0l2.6 2.6c1 1 1 2.5 0 3.4z"/>
      <path d="m7.5 10.5 2 2"/><path d="m10.5 7.5 2 2"/><path d="m13.5 4.5 2 2"/>
    </svg>
  )
}

// Portafilter silhouette for the empty state hero
function IconPortafilter() {
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" fill="none" aria-hidden="true">
      {/* Long horizontal handle */}
      <rect x="22" y="6" width="18" height="6" rx="3" fill="currentColor"/>
      {/* Short neck down from handle into basket top */}
      <rect x="18" y="10" width="7" height="5" rx="1.5" fill="currentColor"/>
      {/* Basket body -- trapezoidal shape, wider at top, narrower at bottom */}
      <path d="M7 15 L37 15 L33 34 L11 34 Z" fill="currentColor" opacity="0.9"/>
      {/* Double spout */}
      <line x1="14" y1="34" x2="11" y2="42" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
      <line x1="30" y1="34" x2="33" y2="42" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
      {/* Filter holes */}
      <circle cx="17" cy="22" r="1.3" fill="white" opacity="0.55"/>
      <circle cx="22" cy="22" r="1.3" fill="white" opacity="0.55"/>
      <circle cx="27" cy="22" r="1.3" fill="white" opacity="0.55"/>
      <circle cx="19" cy="27" r="1.3" fill="white" opacity="0.55"/>
      <circle cx="25" cy="27" r="1.3" fill="white" opacity="0.55"/>
    </svg>
  )
}

// Clean tamper icons (SVG, no emoji)
function IconTamperManual() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {/* Flat tamper top */}
      <rect x="5" y="3" width="14" height="5" rx="2"/>
      {/* Handle stem */}
      <rect x="10" y="8" width="4" height="7" rx="1"/>
      {/* Base plate */}
      <rect x="7" y="15" width="10" height="3" rx="1.5"/>
      {/* Puck surface line */}
      <line x1="4" y1="21" x2="20" y2="21" strokeWidth="1.5"/>
    </svg>
  )
}

function IconTamperSpring() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {/* Top cap */}
      <rect x="8" y="2" width="8" height="3" rx="1.5"/>
      {/* Spring coils */}
      <path d="M10 5 Q14 7 10 9 Q14 11 10 13 Q14 15 10 17"/>
      {/* Base */}
      <rect x="7" y="17" width="10" height="3" rx="1.5"/>
    </svg>
  )
}

function IconTamperAuto() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {/* Motor body */}
      <rect x="6" y="3" width="12" height="9" rx="2"/>
      {/* Pressure arrow */}
      <path d="M12 12 L12 18" strokeWidth="2.5"/>
      <polyline points="9 15 12 18 15 15" strokeWidth="2"/>
      {/* Base plate */}
      <rect x="7" y="18" width="10" height="3" rx="1.5"/>
    </svg>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface ChevronProps {
  open: boolean
}
function Chevron({ open }: ChevronProps) {
  return (
    <svg
      className={`sc-chevron${open ? ' sc-chevron--open' : ''}`}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

interface CardProps {
  title: string
  open: boolean
  onToggle: () => void
  complete?: boolean
  icon: React.ReactNode
  children: React.ReactNode
}
function Card({ title, open, onToggle, complete, icon, children }: CardProps) {
  return (
    <div className={`sc-card${open ? ' sc-card--open' : ''}`}>
      <button className={`sc-card__header${open ? ' sc-card__header--open' : ''}`} onClick={onToggle} aria-expanded={open}>
        <span className="sc-card__header-left">
          <span className="sc-card__icon">{icon}</span>
          <span className="sc-card__title">{title}</span>
        </span>
        <span className="sc-card__header-right">
          <span
            className={`sc-card__dot${complete ? ' sc-card__dot--complete' : ''}`}
            aria-label={complete ? 'Complete' : 'Incomplete'}
          />
          <Chevron open={open} />
        </span>
      </button>
      {open && (
        <div className="sc-card__body">
          {children}
        </div>
      )}
    </div>
  )
}

interface FieldProps {
  label: string
  children: React.ReactNode
}
function Field({ label, children }: FieldProps) {
  return (
    <div className="sc-field">
      <label className="sc-label">{label}</label>
      {children}
    </div>
  )
}

interface MaintenanceRowProps {
  label: string
  lastDate: string | null
  intervalDays: number
  onDateChange: (iso: string) => void
  onToday: () => void
}
function MaintenanceRow({ label, lastDate, intervalDays, onDateChange, onToday }: MaintenanceRowProps) {
  const daysLeft = daysUntilDue(lastDate, intervalDays)

  let pillClass = 'sc-maint__pill'
  let noteText = 'No record'
  if (daysLeft !== null) {
    if (daysLeft > 3) {
      pillClass = 'sc-maint__pill sc-maint__pill--good'
      noteText = `Due in ${daysLeft}d`
    } else if (daysLeft >= 0) {
      pillClass = 'sc-maint__pill sc-maint__pill--warn'
      noteText = daysLeft === 0 ? 'Due today' : `Due in ${daysLeft}d`
    } else {
      pillClass = 'sc-maint__pill sc-maint__pill--overdue'
      noteText = `Overdue ${Math.abs(daysLeft)}d`
    }
  }

  return (
    <div className="sc-maint__row">
      <div className="sc-maint__row-top">
        <span className="sc-maint__label">{label}</span>
        <span className={pillClass}>{noteText}</span>
      </div>
      <div className="sc-maint__inputs">
        <input
          type="date"
          className="sc-input sc-input--date"
          value={toDateInputValue(lastDate)}
          max={TODAY_ISO}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onDateChange(e.target.value)}
        />
        <button className="sc-btn-today" onClick={onToday} type="button">
          Today
        </button>
      </div>
    </div>
  )
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface SetupScreenProps {
  state: BrewmieState
  dispatch: React.Dispatch<AppAction>
}

// ─── Card keys ────────────────────────────────────────────────────────────────

type CardKey = 'units' | 'machine' | 'grinder' | 'tamper' | 'beans' | 'maintenance'
const CARD_KEYS: CardKey[] = ['units', 'machine', 'grinder', 'tamper', 'beans', 'maintenance']

// ─── Roast age display ────────────────────────────────────────────────────────

interface RoastAgeDisplayProps {
  days: number
}
function RoastAgeDisplay({ days }: RoastAgeDisplayProps) {
  if (days < 7) {
    return <span className="sc-age-tag sc-age-tag--fresh">Too fresh -- let it degas</span>
  }
  if (days <= 21) {
    return <span className="sc-age-tag sc-age-tag--prime">Prime window</span>
  }
  if (days <= 30) {
    return <span className="sc-age-tag sc-age-tag--aging">Getting towards stale</span>
  }
  return <span className="sc-age-tag sc-age-tag--stale">Past peak</span>
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SetupScreen({ state, dispatch }: SetupScreenProps) {
  // Determine which card starts open
  const defaultOpen = (): Record<CardKey, boolean> => {
    const hasMachine = state.machine && state.machine.brand
    return {
      units: !hasMachine,
      machine: !hasMachine,
      grinder: false,
      tamper: false,
      beans: false,
      maintenance: false,
    }
  }

  const [openCards, setOpenCards] = useState<Record<CardKey, boolean>>(defaultOpen)

  // ── Toast state ──────────────────────────────────────────────────────────────
  const [toastVisible, setToastVisible] = useState<boolean>(false)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function showSavedToast() {
    setToastVisible(true)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastVisible(false), 1500)
  }

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current)
    }
  }, [])

  // ── Machine local state ──────────────────────────────────────────────────────
  const [machineBrand, setMachineBrand] = useState<string>(state.machine?.brand ?? '')
  const [machineModel, setMachineModel] = useState<string>(state.machine?.model ?? '')
  const [basketSize, setBasketSize] = useState<number>(state.machine?.basketSize ?? 18)
  const [basketType, setBasketType] = useState<string>(state.machine?.basketType ?? 'Standard')
  const [shotTempC, setShotTempC] = useState<number>(state.machine?.shotTemp ?? 93)

  // ── Grinder local state ──────────────────────────────────────────────────────
  const [grinderBuiltIn, setGrinderBuiltIn] = useState<boolean>(
    state.grinder ? state.grinder.type !== 'flat-burr' && state.grinder.type !== 'conical-burr' && state.grinder.brand === '' : false
  )
  const [grinderBrand, setGrinderBrand] = useState<string>(state.grinder?.brand ?? '')
  const [grinderModel, setGrinderModel] = useState<string>(state.grinder?.model ?? '')
  const [grinderMin, setGrinderMin] = useState<number>(state.grinder?.minSetting ?? 0)
  const [grinderMax, setGrinderMax] = useState<number>(state.grinder?.maxSetting ?? 64)

  // ── Tamper local state ───────────────────────────────────────────────────────
  const [tampType, setTampType] = useState<TampType>(state.tamp?.type ?? 'manual')
  const [springPressure, setSpringPressure] = useState<number>(state.tamp?.springPressure ?? 20)
  const [autoPressure, setAutoPressure] = useState<number>(state.tamp?.autoPressure ?? 20)

  // ── Beans local state ────────────────────────────────────────────────────────
  const [beanBrand, setBeanBrand] = useState<string>(state.beans?.brand ?? '')
  const [beanType, setBeanType] = useState<string>(state.beans?.type ?? '')
  const [roastDate, setRoastDate] = useState<string | null>(state.beans?.roastDate ?? null)
  const [roastLevel, setRoastLevel] = useState<RoastLevel>(state.beans?.roastLevel ?? 'medium')

  // ─── Derived ──────────────────────────────────────────────────────────────────

  const beanAgeDays = daysSince(roastDate)
  const shotTempDisplay = state.units === 'imperial' ? celsiusToFahrenheit(shotTempC) : shotTempC

  const isEquipmentConfigured = !!(state.machine?.brand && state.grinder?.brand)

  // ─── Dispatch helpers ─────────────────────────────────────────────────────────

  function dispatchMachine(overrides: Partial<MachineConfig> = {}) {
    const cfg: MachineConfig = {
      brand: machineBrand,
      model: machineModel,
      basketSize,
      basketType,
      shotTemp: shotTempC,
      ...overrides,
    }
    dispatch({ type: 'SET_MACHINE', payload: cfg })
  }

  function dispatchGrinder(overrides: Partial<GrinderConfig> = {}) {
    const cfg: GrinderConfig = {
      type: grinderBuiltIn ? 'blade' : 'flat-burr',
      brand: grinderBuiltIn ? '(Built-in)' : grinderBrand,
      model: grinderBuiltIn ? '' : grinderModel,
      minSetting: grinderMin,
      maxSetting: grinderMax,
      ...overrides,
    }
    dispatch({ type: 'SET_GRINDER', payload: cfg })
  }

  function dispatchTamp(overrides: Partial<TampConfig> = {}) {
    const cfg: TampConfig = {
      type: tampType,
      level: state.tamp?.level ?? 50,
      springPressure: tampType === 'spring' ? springPressure : null,
      springMin: null,
      springMax: null,
      autoPressure: tampType === 'automatic' ? autoPressure : null,
      autoMin: null,
      autoMax: null,
      ...overrides,
    }
    dispatch({ type: 'SET_TAMP', payload: cfg })
  }

  function dispatchBeans(overrides: Partial<BeanConfig> = {}) {
    const cfg: BeanConfig = {
      brand: beanBrand,
      type: beanType,
      roastDate,
      roastLevel,
      beanAge: beanAgeDays,
      ...overrides,
    }
    dispatch({ type: 'SET_BEANS', payload: cfg })
  }

  // ─── Auto-dispatch effects ────────────────────────────────────────────────────

  const isMounted = useRef(false)

  useEffect(() => {
    if (!isMounted.current) return
    if (machineBrand) { dispatchMachine(); showSavedToast() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machineBrand, machineModel, basketSize, basketType, shotTempC])

  useEffect(() => {
    if (!isMounted.current) return
    dispatchGrinder(); showSavedToast()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grinderBuiltIn, grinderBrand, grinderModel, grinderMin, grinderMax])

  useEffect(() => {
    if (!isMounted.current) return
    dispatchTamp(); showSavedToast()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tampType, springPressure, autoPressure])

  useEffect(() => {
    if (!isMounted.current) return
    if (beanBrand) { dispatchBeans(); showSavedToast() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beanBrand, beanType, roastDate, roastLevel])

  // Mark mounted after first render so initial state doesn't trigger toasts
  useEffect(() => {
    isMounted.current = true
  }, [])

  // ─── Card toggle helpers ──────────────────────────────────────────────────────

  function toggleCard(key: CardKey) {
    setOpenCards((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  function expandAll() {
    const all: Record<CardKey, boolean> = {} as Record<CardKey, boolean>
    CARD_KEYS.forEach((k) => (all[k] = true))
    setOpenCards(all)
  }

  function collapseAll() {
    const none: Record<CardKey, boolean> = {} as Record<CardKey, boolean>
    CARD_KEYS.forEach((k) => (none[k] = false))
    setOpenCards(none)
  }

  // ─── Machine brand change ─────────────────────────────────────────────────────

  function handleMachineBrandChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const brand = e.target.value
    setMachineBrand(brand)
    setMachineModel('')
  }

  // ─── Machine model auto-suggest ───────────────────────────────────────────────
  const modelSuggestions: string[] = machineBrand ? (MACHINE_MODELS[machineBrand] ?? []) : []

  // ─── Grinder model preset detection ──────────────────────────────────────────

  function handleGrinderModelChange(e: React.ChangeEvent<HTMLInputElement>) {
    const model = e.target.value
    setGrinderModel(model)
    const preset = GRINDER_PRESETS[model]
    if (preset) {
      setGrinderMin(preset[0])
      setGrinderMax(preset[1])
    }
  }

  // ─── Shot temperature ─────────────────────────────────────────────────────────

  function handleShotTempChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = Number(e.target.value)
    if (state.units === 'imperial') {
      setShotTempC(fahrenheitToCelsius(val))
    } else {
      setShotTempC(val)
    }
  }

  // ─── Beans helpers ────────────────────────────────────────────────────────────

  function handleNewBeans() {
    setBeanBrand('')
    setBeanType('')
    setRoastDate(null)
    setRoastLevel('medium')
    setOpenCards((prev) => ({ ...prev, beans: true }))
  }

  // ─── Maintenance helpers ──────────────────────────────────────────────────────

  function setMaintenanceDate(field: 'lastBackflush' | 'lastDescale' | 'lastGrinderClean', value: string) {
    dispatch({ type: 'UPDATE_MAINTENANCE', payload: { [field]: value || null } })
    showSavedToast()
  }

  // ─── Profile header text ──────────────────────────────────────────────────────

  function buildProfileLabel(): string {
    const parts: string[] = []
    if (state.machine?.brand) {
      parts.push([state.machine.brand, state.machine.model].filter(Boolean).join(' '))
    }
    if (state.grinder?.brand && state.grinder.brand !== '(Built-in)') {
      parts.push(state.grinder.brand)
    }
    return parts.join(' · ')
  }

  // ─── Roast level background tint ─────────────────────────────────────────────

  function roastTintClass(value: RoastLevel): string {
    const map: Record<RoastLevel, string> = {
      'light': 'sc-roast-btn--light',
      'medium-light': 'sc-roast-btn--medium-light',
      'medium': 'sc-roast-btn--medium',
      'medium-dark': 'sc-roast-btn--medium-dark',
      'dark': 'sc-roast-btn--dark',
    }
    return map[value]
  }

  // Tamper button definitions (SVG icons, no emoji)
  const tampOptions: { type: TampType; icon: React.ReactNode; label: string }[] = [
    { type: 'manual',    icon: <IconTamperManual />,  label: 'Manual' },
    { type: 'spring',    icon: <IconTamperSpring />,  label: 'Spring' },
    { type: 'automatic', icon: <IconTamperAuto />,    label: 'Auto'   },
  ]

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="sc-screen">

      {/* Equipment Profile header */}
      {isEquipmentConfigured ? (
        <div className="sc-profile sc-profile--set">
          <span className="sc-profile__dot" aria-hidden="true" />
          <span className="sc-profile__text">{buildProfileLabel()}</span>
        </div>
      ) : (
        <div className="sc-profile sc-profile--empty">
          <div className="sc-profile__icon-wrap" aria-hidden="true">
            <IconPortafilter />
          </div>
          <h2 className="sc-profile__heading">What are you working with?</h2>
          <p className="sc-profile__body">Your machine and grinder shape every shot. Set them up once and we'll remember.</p>
          <button
            className="sc-profile__cta-btn"
            type="button"
            onClick={() => setOpenCards((prev) => ({ ...prev, machine: true }))}
          >
            Let's set it up →
          </button>
        </div>
      )}

      {/* Expand / Collapse All */}
      <div className="sc-controls">
        <button className="sc-ctrl-btn" onClick={expandAll} type="button">Expand All</button>
        <button className="sc-ctrl-btn" onClick={collapseAll} type="button">Collapse All</button>
      </div>

      {/* Cards */}
      <div className="sc-cards">

        {/* ── 1. Units ── */}
        <Card
          title="Units"
          open={openCards.units}
          onToggle={() => toggleCard('units')}
          complete={true}
          icon={<IconRuler />}
        >
          <div className="sc-pill-toggle">
            <span
              className="sc-pill-toggle__track"
              aria-hidden="true"
              style={{ left: state.units === 'metric' ? '3px' : 'calc(50% + 0px)' }}
            />
            <button
              className={`sc-pill-option${state.units === 'metric' ? ' sc-pill-option--active' : ''}`}
              onClick={() => dispatch({ type: 'SET_UNITS', payload: 'metric' as Units })}
              type="button"
            >
              Metric
            </button>
            <button
              className={`sc-pill-option${state.units === 'imperial' ? ' sc-pill-option--active' : ''}`}
              onClick={() => dispatch({ type: 'SET_UNITS', payload: 'imperial' as Units })}
              type="button"
            >
              Imperial
            </button>
          </div>
          <p className="sc-hint">
            {state.units === 'metric'
              ? 'Weights in grams, temperature in °C'
              : 'Weights in oz, temperature in °F'}
          </p>
        </Card>

        {/* ── 2. Machine ── */}
        <Card
          title="Machine"
          open={openCards.machine}
          onToggle={() => toggleCard('machine')}
          complete={!!state.machine?.brand}
          icon={<IconWrench />}
        >
          <p className="sc-card__desc">Your espresso machine determines your baseline pressure and temperature profile.</p>

          <Field label="Brand">
            <select
              className="sc-select"
              value={machineBrand}
              onChange={handleMachineBrandChange}
            >
              <option value="">Select brand</option>
              {MACHINE_BRANDS.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </Field>

          <Field label="Model">
            <input
              list="machine-model-list"
              className="sc-input"
              placeholder="e.g. Barista Express"
              value={machineModel}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMachineModel(e.target.value)}
              onBlur={() => machineBrand && dispatchMachine({ model: machineModel })}
            />
            {modelSuggestions.length > 0 && (
              <datalist id="machine-model-list">
                {modelSuggestions.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            )}
          </Field>

          <div className="sc-row">
            <Field label="Basket Size (g)">
              <input
                type="number"
                className="sc-input"
                min={14}
                max={24}
                step={0.1}
                value={basketSize}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBasketSize(Number(e.target.value))}
              />
            </Field>
            <Field label="Basket Type">
              <select
                className="sc-select"
                value={basketType}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setBasketType(e.target.value)}
              >
                {BASKET_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </Field>
          </div>

          <Field label={`Shot Temperature (°${state.units === 'imperial' ? 'F' : 'C'})`}>
            <input
              type="number"
              className="sc-input"
              min={state.units === 'imperial' ? 185 : 85}
              max={state.units === 'imperial' ? 210 : 99}
              step={0.5}
              value={shotTempDisplay}
              onChange={handleShotTempChange}
            />
          </Field>
        </Card>

        {/* ── 3. Grinder ── */}
        <Card
          title="Grinder"
          open={openCards.grinder}
          onToggle={() => toggleCard('grinder')}
          complete={!!state.grinder?.brand}
          icon={<IconDroplet />}
        >
          <p className="sc-card__desc">The most important variable. We use your grinder's sensitivity curve from community data.</p>

          <Field label="Grinder Type">
            <div className="sc-option-group">
              <button
                className={`sc-option-btn${grinderBuiltIn ? ' sc-option-btn--active' : ''}`}
                onClick={() => setGrinderBuiltIn(true)}
                type="button"
              >
                Built-in
              </button>
              <button
                className={`sc-option-btn${!grinderBuiltIn ? ' sc-option-btn--active' : ''}`}
                onClick={() => setGrinderBuiltIn(false)}
                type="button"
              >
                Standalone
              </button>
            </div>
          </Field>

          {!grinderBuiltIn && (
            <>
              <Field label="Brand">
                <input
                  list="grinder-brand-list"
                  className="sc-input"
                  placeholder="e.g. Niche"
                  value={grinderBrand}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setGrinderBrand(e.target.value)}
                />
                <datalist id="grinder-brand-list">
                  {GRINDER_BRANDS.map((b) => (
                    <option key={b} value={b} />
                  ))}
                </datalist>
              </Field>

              <Field label="Model">
                <input
                  list="grinder-model-list"
                  className="sc-input"
                  placeholder="e.g. Zero"
                  value={grinderModel}
                  onChange={handleGrinderModelChange}
                />
                <datalist id="grinder-model-list">
                  {Object.keys(GRINDER_PRESETS).map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </Field>

              <div className="sc-row">
                <Field label="Min Setting">
                  <input
                    type="number"
                    className="sc-input"
                    min={0}
                    step={1}
                    value={grinderMin}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setGrinderMin(Number(e.target.value))}
                  />
                </Field>
                <Field label="Max Setting">
                  <input
                    type="number"
                    className="sc-input"
                    min={1}
                    step={1}
                    value={grinderMax}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setGrinderMax(Number(e.target.value))}
                  />
                </Field>
              </div>
            </>
          )}
        </Card>

        {/* ── 4. Tamper ── */}
        <Card
          title="Tamper"
          open={openCards.tamper}
          onToggle={() => toggleCard('tamper')}
          complete={!!state.tamp}
          icon={<IconDisc />}
        >
          <p className="sc-card__desc">Helps calibrate tamp consistency across shots.</p>

          <Field label="Tamper Type">
            <div className="sc-option-group">
              {tampOptions.map(({ type: t, icon, label }) => (
                <button
                  key={t}
                  className={`sc-option-btn sc-tamp-btn${tampType === t ? ' sc-option-btn--active' : ''}`}
                  onClick={() => {
                    setTampType(t)
                    dispatchTamp({ type: t })
                  }}
                  type="button"
                >
                  <span className="sc-tamp-btn__icon">{icon}</span>
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </Field>

          {tampType === 'spring' && (
            <Field label="Tamper Pressure">
              <div className="sc-pressure-presets">
                {[10, 15, 20, 25, 30].map((kg) => (
                  <button
                    key={kg}
                    className={`sc-pressure-btn${springPressure === kg ? ' sc-option-btn--active' : ''}`}
                    onClick={() => setSpringPressure(kg)}
                    type="button"
                  >
                    {kg} kg
                  </button>
                ))}
                <button
                  className={`sc-pressure-btn${![10, 15, 20, 25, 30].includes(springPressure) ? ' sc-option-btn--active' : ''}`}
                  onClick={() => {
                    const val = Number(prompt('Enter pressure in kg', String(springPressure)))
                    if (val > 0) setSpringPressure(val)
                  }}
                  type="button"
                >
                  Custom
                </button>
              </div>
              {![10, 15, 20, 25, 30].includes(springPressure) && (
                <p className="sc-hint">Your tamper pressure: {springPressure}kg</p>
              )}
            </Field>
          )}

          {tampType === 'automatic' && (
            <Field label="Tamper Pressure">
              <div className="sc-pressure-presets">
                {[10, 15, 20, 25, 30].map((kg) => (
                  <button
                    key={kg}
                    className={`sc-pressure-btn${autoPressure === kg ? ' sc-option-btn--active' : ''}`}
                    onClick={() => setAutoPressure(kg)}
                    type="button"
                  >
                    {kg} kg
                  </button>
                ))}
                <button
                  className={`sc-pressure-btn${![10, 15, 20, 25, 30].includes(autoPressure) ? ' sc-option-btn--active' : ''}`}
                  onClick={() => {
                    const val = Number(prompt('Enter pressure in kg', String(autoPressure)))
                    if (val > 0) setAutoPressure(val)
                  }}
                  type="button"
                >
                  Custom
                </button>
              </div>
              {![10, 15, 20, 25, 30].includes(autoPressure) && (
                <p className="sc-hint">Your tamper pressure: {autoPressure}kg</p>
              )}
            </Field>
          )}

          {tampType === 'manual' && (
            <p className="sc-hint">Tamp level is adjusted per-shot on the Brew screen.</p>
          )}
        </Card>

        {/* ── 5. Beans ── */}
        <Card
          title="Beans"
          open={openCards.beans}
          onToggle={() => toggleCard('beans')}
          complete={!!state.beans?.brand}
          icon={<IconLeaf />}
        >
          <p className="sc-card__desc">Fresh beans dial in differently. We factor roast age into every recommendation.</p>

          <Field label="Brand">
            <input
              type="text"
              className="sc-input"
              placeholder="e.g. Seven Seeds"
              value={beanBrand}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBeanBrand(e.target.value)}
              onBlur={() => dispatchBeans({ brand: beanBrand })}
            />
          </Field>

          <Field label="Type">
            <input
              type="text"
              className="sc-input"
              placeholder="e.g. Single Origin, Blend"
              value={beanType}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBeanType(e.target.value)}
              onBlur={() => dispatchBeans({ type: beanType })}
            />
          </Field>

          <Field label="Date of Roast">
            <div className="sc-date-row">
              <input
                type="date"
                className="sc-input sc-input--date"
                value={toDateInputValue(roastDate)}
                max={TODAY_ISO}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  const val = e.target.value || null
                  setRoastDate(val)
                  dispatchBeans({ roastDate: val, beanAge: daysSince(val) })
                }}
              />
              {beanAgeDays !== null && (
                <RoastAgeDisplay days={beanAgeDays} />
              )}
            </div>
            {beanAgeDays !== null && (
              <p className="sc-bean-age-sub">
                {beanAgeDays === 0 ? 'Roasted today' : `${beanAgeDays} day${beanAgeDays !== 1 ? 's' : ''} since roast`}
              </p>
            )}
          </Field>

          <Field label="Roast Level">
            <div className="sc-roast-group">
              {ROAST_LEVELS.map((rl) => (
                <button
                  key={rl.value}
                  className={`sc-roast-btn ${roastTintClass(rl.value)}${roastLevel === rl.value ? ' sc-roast-btn--active' : ''}`}
                  onClick={() => {
                    setRoastLevel(rl.value)
                    dispatchBeans({ roastLevel: rl.value })
                  }}
                  type="button"
                >
                  {rl.label}
                </button>
              ))}
            </div>
          </Field>

          <button className="sc-new-beans-btn" onClick={handleNewBeans} type="button">
            New Beans
          </button>
        </Card>

        {/* ── 6. Maintenance ── */}
        <Card
          title="Maintenance"
          open={openCards.maintenance}
          onToggle={() => toggleCard('maintenance')}
          complete={!!(state.maintenance.lastBackflush || state.maintenance.lastDescale || state.maintenance.lastGrinderClean)}
          icon={<IconClock />}
        >
          <p className="sc-card__desc">Clean equipment pulls better shots. We'll remind you when it's time.</p>

          <MaintenanceRow
            label="Backflush"
            lastDate={state.maintenance.lastBackflush}
            intervalDays={BACKFLUSH_INTERVAL_DAYS}
            onDateChange={(v) => setMaintenanceDate('lastBackflush', v)}
            onToday={() => setMaintenanceDate('lastBackflush', TODAY_ISO)}
          />
          <MaintenanceRow
            label="Descale"
            lastDate={state.maintenance.lastDescale}
            intervalDays={DESCALE_INTERVAL_DAYS}
            onDateChange={(v) => setMaintenanceDate('lastDescale', v)}
            onToday={() => setMaintenanceDate('lastDescale', TODAY_ISO)}
          />
          <MaintenanceRow
            label="Grinder Clean"
            lastDate={state.maintenance.lastGrinderClean}
            intervalDays={GRINDER_CLEAN_INTERVAL_DAYS}
            onDateChange={(v) => setMaintenanceDate('lastGrinderClean', v)}
            onToday={() => setMaintenanceDate('lastGrinderClean', TODAY_ISO)}
          />
          <p className="sc-hint sc-hint--spaced">
            Backflush every 2 weeks. Descale every 3 months. Grinder clean every 4 weeks.
          </p>
        </Card>

      </div>

      {/* Saved toast */}
      <div className={`sc-toast${toastVisible ? ' sc-toast--visible' : ''}`} aria-live="polite" aria-atomic="true">
        Saved.
      </div>

      <style>{`
        /* ── Screen ── */
        .sc-screen {
          padding: 16px 16px 32px;
          min-height: 100%;
          display: flex;
          flex-direction: column;
          gap: 0;
          position: relative;
        }

        /* ── Equipment profile header ── */
        .sc-profile {
          margin-bottom: 14px;
          border-radius: 16px;
          padding: 14px 16px;
        }

        .sc-profile--set {
          display: flex;
          align-items: center;
          gap: 8px;
          background: #1A1A1A;
          border: 1px solid rgba(255,255,255,0.08);
        }

        .sc-profile__dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #22c55e;
          flex-shrink: 0;
          box-shadow: 0 0 0 2px rgba(34,197,94,0.25);
        }

        .sc-profile__text {
          font-size: 13px;
          font-weight: 600;
          color: #e5e7eb;
          letter-spacing: 0.1px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        /* Empty state hero */
        .sc-profile--empty {
          background: var(--white);
          border: 1px solid var(--border-light);
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          gap: 8px;
          padding: 24px 20px 20px;
          box-shadow: 0 1px 4px rgba(45,30,10,0.06);
        }

        .sc-profile__icon-wrap {
          color: var(--accent-green);
          margin-bottom: 2px;
          opacity: 0.85;
        }

        .sc-profile__heading {
          font-size: 17px;
          font-weight: 700;
          color: var(--text-primary);
          line-height: 1.3;
          margin: 0;
        }

        .sc-profile__body {
          font-size: 13px;
          color: var(--text-tertiary);
          line-height: 1.55;
          max-width: 260px;
          margin: 0;
        }

        .sc-profile__cta-btn {
          margin-top: 6px;
          display: inline-flex;
          align-items: center;
          font-size: 14px;
          font-weight: 700;
          padding: 10px 22px;
          border-radius: 999px;
          background: var(--accent-green);
          color: var(--white);
          border: none;
          cursor: pointer;
          transition: opacity 0.15s ease, transform 0.15s ease;
          -webkit-tap-highlight-color: transparent;
          letter-spacing: 0.1px;
        }

        .sc-profile__cta-btn:active {
          opacity: 0.85;
          transform: scale(0.97);
        }

        /* ── Expand/Collapse controls ── */
        .sc-controls {
          display: flex;
          gap: 8px;
          margin-bottom: 10px;
        }

        .sc-ctrl-btn {
          font-size: 11px;
          font-weight: 600;
          color: var(--text-tertiary);
          background: var(--white);
          border: 1px solid var(--border-light);
          border-radius: 20px;
          padding: 5px 12px;
          cursor: pointer;
          transition: var(--transition);
          -webkit-tap-highlight-color: transparent;
          letter-spacing: 0.1px;
        }

        .sc-ctrl-btn:active {
          background: var(--off-white);
          transform: scale(0.96);
        }

        /* ── Cards stack ── */
        .sc-cards {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        /* ── Card ── */
        .sc-card {
          background: var(--white);
          border-radius: 16px;
          box-shadow: 0 1px 4px rgba(0,0,0,0.07), 0 2px 8px rgba(0,0,0,0.04);
          overflow: hidden;
        }

        .sc-card__header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          padding: 16px 20px;
          background: none;
          border: none;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
          text-align: left;
          transition: background 0.15s ease;
        }

        .sc-card__header--open {
          background: var(--cream);
        }

        .sc-card__header:active {
          background: var(--off-white);
        }

        .sc-card__header-left {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .sc-card__header-right {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-shrink: 0;
        }

        .sc-card__icon {
          color: var(--text-tertiary);
          display: flex;
          align-items: center;
          flex-shrink: 0;
        }

        .sc-card__title {
          font-size: 15px;
          font-weight: 700;
          color: var(--text-primary);
        }

        /* Complete/incomplete dot */
        .sc-card__dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          border: 1.5px solid #c8ccd0;
          background: transparent;
          flex-shrink: 0;
          transition: all 0.2s ease;
        }

        .sc-card__dot--complete {
          background: #22c55e;
          border-color: #22c55e;
          box-shadow: 0 0 0 2px rgba(34,197,94,0.2);
        }

        .sc-card__body {
          padding: 16px 20px 20px;
          display: flex;
          flex-direction: column;
          gap: 14px;
          border-top: 1px solid var(--border-light);
        }

        /* Card contextual description */
        .sc-card__desc {
          font-size: 12px;
          color: var(--text-tertiary);
          line-height: 1.5;
          margin-bottom: 14px;
          margin-top: -4px;
        }

        /* ── Chevron ── */
        .sc-chevron {
          color: var(--grey-light);
          flex-shrink: 0;
          transition: transform 0.2s ease;
        }

        .sc-chevron--open {
          transform: rotate(180deg);
        }

        /* ── Field ── */
        .sc-field {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }

        .sc-label {
          font-size: 11px;
          font-weight: 600;
          color: var(--text-tertiary);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        /* ── Input ── */
        .sc-input {
          border: 1.5px solid var(--border);
          border-radius: 10px;
          padding: 10px 12px;
          font-size: 15px;
          font-family: var(--font-primary);
          color: var(--text-primary);
          background: var(--white);
          width: 100%;
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
          -webkit-appearance: none;
          appearance: none;
          outline: none;
        }

        .sc-input:focus {
          border-color: var(--accent-green);
          box-shadow: 0 0 0 3px rgba(45,80,22,0.1);
        }

        .sc-input--date {
          min-width: 0;
        }

        /* ── Select ── */
        .sc-select {
          border: 1.5px solid var(--border);
          border-radius: 10px;
          padding: 10px 34px 10px 12px;
          font-size: 15px;
          font-family: var(--font-primary);
          color: var(--text-primary);
          background: var(--white) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236A6A6A' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E") no-repeat right 12px center;
          width: 100%;
          -webkit-appearance: none;
          appearance: none;
          cursor: pointer;
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
          outline: none;
        }

        .sc-select:focus {
          border-color: var(--accent-green);
          box-shadow: 0 0 0 3px rgba(45,80,22,0.1);
        }

        /* ── Side-by-side row ── */
        .sc-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }

        /* ── Pill toggle (Units) ── */
        .sc-pill-toggle {
          position: relative;
          display: flex;
          background: #EDEDED;
          border-radius: 20px;
          padding: 3px;
          gap: 0;
        }

        .sc-pill-toggle__track {
          position: absolute;
          top: 3px;
          width: calc(50% - 3px);
          height: calc(100% - 6px);
          background: var(--white);
          border-radius: 17px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.14), 0 1px 2px rgba(0,0,0,0.08);
          transition: left 0.2s ease;
          pointer-events: none;
        }

        .sc-pill-option {
          position: relative;
          flex: 1;
          font-size: 13px;
          font-weight: 600;
          padding: 7px 0;
          border-radius: 17px;
          color: var(--text-tertiary);
          background: none;
          border: none;
          cursor: pointer;
          z-index: 1;
          transition: color 0.2s ease;
          -webkit-tap-highlight-color: transparent;
        }

        .sc-pill-option--active {
          color: var(--text-primary);
        }

        .sc-hint {
          font-size: 12px;
          color: var(--text-tertiary);
          line-height: 1.5;
        }

        .sc-hint--spaced {
          margin-top: 4px;
        }

        /* ── Option group (Grinder type) ── */
        .sc-option-group {
          display: flex;
          gap: 7px;
        }

        .sc-option-group--wrap {
          flex-wrap: wrap;
        }

        .sc-option-btn {
          flex: 1;
          min-width: 0;
          font-size: 13px;
          font-weight: 600;
          padding: 8px 6px;
          border-radius: 10px;
          border: 1.5px solid var(--border);
          background: var(--white);
          color: var(--text-secondary);
          cursor: pointer;
          transition: var(--transition);
          text-align: center;
          white-space: nowrap;
          -webkit-tap-highlight-color: transparent;
        }

        .sc-option-btn--active {
          border-color: var(--accent-green);
          color: var(--accent-green);
          box-shadow: 0 0 0 3px rgba(45,80,22,0.12);
        }

        .sc-option-btn:active:not(.sc-option-btn--active) {
          background: var(--off-white);
        }

        /* ── Tamper buttons (SVG icon + label) ── */
        .sc-tamp-btn {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 5px;
          padding: 11px 6px 9px;
        }

        .sc-tamp-btn__icon {
          display: flex;
          align-items: center;
          justify-content: center;
          color: inherit;
          opacity: 0.75;
        }

        .sc-tamp-btn.sc-option-btn--active .sc-tamp-btn__icon {
          opacity: 1;
        }

        /* ── Pressure preset buttons ── */
        .sc-pressure-presets {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }

        .sc-pressure-btn {
          font-size: 13px;
          font-weight: 600;
          padding: 6px 12px;
          border-radius: 10px;
          border: 1.5px solid var(--border);
          background: var(--white);
          color: var(--text-secondary);
          cursor: pointer;
          transition: var(--transition);
          white-space: nowrap;
          -webkit-tap-highlight-color: transparent;
        }

        .sc-pressure-btn:active:not(.sc-option-btn--active) {
          background: var(--off-white);
        }

        /* ── Roast level segmented row ── */
        .sc-roast-group {
          display: flex;
          gap: 0;
          border: 1.5px solid var(--border);
          border-radius: 10px;
          overflow: hidden;
        }

        .sc-roast-btn {
          flex: 1;
          font-size: 11px;
          font-weight: 600;
          padding: 9px 2px;
          border: none;
          border-right: 1px solid var(--border-light);
          background: var(--white);
          color: var(--text-tertiary);
          cursor: pointer;
          transition: background 0.15s ease, color 0.15s ease;
          text-align: center;
          white-space: nowrap;
          -webkit-tap-highlight-color: transparent;
          letter-spacing: -0.1px;
        }

        .sc-roast-btn:last-child {
          border-right: none;
        }

        .sc-roast-btn--light        { background: #FFFBF0; }
        .sc-roast-btn--medium-light { background: #FFF7E6; }
        .sc-roast-btn--medium       { background: #FFF3D6; }
        .sc-roast-btn--medium-dark  { background: #F5EAD4; }
        .sc-roast-btn--dark         { background: #EBE0D4; }

        .sc-roast-btn--active {
          color: var(--accent-green);
          font-weight: 700;
          box-shadow: inset 0 0 0 1.5px var(--accent-green);
          position: relative;
          z-index: 1;
        }

        /* ── Beans date ── */
        .sc-date-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .sc-date-row .sc-input--date {
          flex: 1;
        }

        .sc-bean-age-sub {
          font-size: 11px;
          color: var(--text-tertiary);
          margin-top: 3px;
        }

        /* ── Roast age tag ── */
        .sc-age-tag {
          font-size: 11px;
          font-weight: 600;
          padding: 4px 9px;
          border-radius: 20px;
          white-space: nowrap;
          flex-shrink: 0;
        }

        .sc-age-tag--fresh {
          background: #FFF8E7;
          color: #D97706;
          border: 1px solid #FCD34D;
        }

        .sc-age-tag--prime {
          background: #ECFDF5;
          color: #059669;
          border: 1px solid #A7F3D0;
        }

        .sc-age-tag--aging {
          background: #FFF7ED;
          color: #C2410C;
          border: 1px solid #FED7AA;
        }

        .sc-age-tag--stale {
          background: rgba(254,242,242,0.8);
          color: #B91C1C;
          border: 1px solid #FECACA;
        }

        /* ── New Beans button ── */
        .sc-new-beans-btn {
          align-self: flex-start;
          font-size: 13px;
          font-weight: 600;
          padding: 8px 14px;
          border-radius: 10px;
          border: 1.5px dashed var(--border);
          background: var(--off-white);
          color: var(--text-secondary);
          cursor: pointer;
          transition: var(--transition);
          -webkit-tap-highlight-color: transparent;
        }

        .sc-new-beans-btn:active {
          background: var(--border-light);
        }

        /* ── Maintenance rows ── */
        .sc-maint__row {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding-bottom: 14px;
          border-bottom: 1px solid var(--border-light);
        }

        .sc-maint__row:last-of-type {
          border-bottom: none;
          padding-bottom: 0;
        }

        .sc-maint__row-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }

        .sc-maint__label {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-primary);
        }

        .sc-maint__pill {
          font-size: 11px;
          font-weight: 600;
          padding: 3px 10px;
          border-radius: 20px;
          background: var(--off-white);
          color: var(--text-tertiary);
          border: 1px solid var(--border);
          white-space: nowrap;
          flex-shrink: 0;
        }

        .sc-maint__pill--good {
          background: #ECFDF5;
          color: #059669;
          border-color: #A7F3D0;
        }

        .sc-maint__pill--warn {
          background: #FFFBEB;
          color: #D97706;
          border-color: #FCD34D;
        }

        .sc-maint__pill--overdue {
          background: rgba(254,242,242,0.85);
          color: #DC2626;
          border-color: #FECACA;
        }

        .sc-maint__inputs {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .sc-maint__inputs .sc-input--date {
          flex: 1;
        }

        /* ── Today button ── */
        .sc-btn-today {
          font-size: 12px;
          font-weight: 700;
          padding: 8px 14px;
          border-radius: 10px;
          background: var(--accent-green);
          color: var(--white);
          border: none;
          cursor: pointer;
          white-space: nowrap;
          transition: var(--transition);
          -webkit-tap-highlight-color: transparent;
          flex-shrink: 0;
        }

        .sc-btn-today:active {
          opacity: 0.85;
          transform: scale(0.97);
        }

        /* ── Saved toast ── */
        .sc-toast {
          position: fixed;
          bottom: 80px;
          left: 50%;
          transform: translateX(-50%) translateY(12px);
          background: rgba(26,26,26,0.88);
          color: #fff;
          font-size: 13px;
          font-weight: 600;
          padding: 8px 18px;
          border-radius: 999px;
          pointer-events: none;
          opacity: 0;
          transition: opacity 0.2s ease, transform 0.2s ease;
          white-space: nowrap;
          backdrop-filter: blur(6px);
          -webkit-backdrop-filter: blur(6px);
          z-index: 100;
          letter-spacing: 0.1px;
        }

        .sc-toast--visible {
          opacity: 1;
          transform: translateX(-50%) translateY(0);
        }
      `}</style>
    </div>
  )
}
