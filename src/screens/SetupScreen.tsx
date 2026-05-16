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
import { useTranslation } from '../hooks/useTranslation'
import type { TParams } from '../lib/i18n'
import { useTier } from '../hooks/useTier'
import { PremiumModal } from '../components/PremiumModal'
import {
  MACHINE_BRANDS,
  MACHINE_MODELS,
  BASKET_TYPES,
  GRINDER_BRANDS,
  GRINDER_MODELS,
  BEAN_TYPES,
  BEAN_ROASTERS,
} from '../data/equipment'

// ─── Constants ────────────────────────────────────────────────────────────────

const OTHER = 'Other'

const ROAST_LEVELS: { value: RoastLevel; labelKey: string }[] = [
  { value: 'light', labelKey: 'setup.roastLight' },
  { value: 'medium-light', labelKey: 'setup.roastMediumLight' },
  { value: 'medium', labelKey: 'setup.roastMedium' },
  { value: 'medium-dark', labelKey: 'setup.roastMediumDark' },
  { value: 'dark', labelKey: 'setup.roastDark' },
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

function IconShield() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
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
  locked?: boolean
}
function Card({ title, open, onToggle, complete, icon, children, locked }: CardProps) {
  const { t } = useTranslation()
  const completeLabel = t('setup.complete')
  const incompleteLabel = t('setup.incomplete')
  return (
    <div className={`sc-card${open ? ' sc-card--open' : ''}${locked ? ' sc-card--locked' : ''}`}>
      <button className={`sc-card__header${open ? ' sc-card__header--open' : ''}`} onClick={onToggle} aria-expanded={open}>
        <span className="sc-card__header-left">
          <span className="sc-card__icon">{icon}</span>
          <span className="sc-card__title">{title}</span>
        </span>
        <span className="sc-card__header-right">
          {locked ? (
            <span className="sc-card__premium-badge">{t('tierLock.badge')}</span>
          ) : (
            <span
              className={`sc-card__dot${complete ? ' sc-card__dot--complete' : ''}`}
              aria-label={complete ? completeLabel : incompleteLabel}
            />
          )}
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
  t: (key: string, params?: TParams) => string
}
function MaintenanceRow({ label, lastDate, intervalDays, onDateChange, onToday, t }: MaintenanceRowProps) {
  const daysLeft = daysUntilDue(lastDate, intervalDays)

  let pillClass = 'sc-maint__pill'
  let noteText = t('setup.maintNoRecord')
  if (daysLeft !== null) {
    if (daysLeft > 3) {
      pillClass = 'sc-maint__pill sc-maint__pill--good'
      noteText = t('setup.maintDueIn', { days: daysLeft })
    } else if (daysLeft >= 0) {
      pillClass = 'sc-maint__pill sc-maint__pill--warn'
      noteText = daysLeft === 0 ? t('setup.maintDueToday') : t('setup.maintDueIn', { days: daysLeft })
    } else {
      pillClass = 'sc-maint__pill sc-maint__pill--overdue'
      noteText = t('setup.maintOverdue', { days: Math.abs(daysLeft) })
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
          {t('setup.maintToday')}
        </button>
      </div>
    </div>
  )
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface SetupScreenProps {
  state: BrewmieState
  dispatch: React.Dispatch<AppAction>
  onSignIn: () => void
}

// ─── Card keys ────────────────────────────────────────────────────────────────

type CardKey = 'units' | 'machine' | 'grinder' | 'tamper' | 'beans' | 'maintenance' | 'privacy'

const WIZARD_STEP_KEYS = ['wizard.stepMachine', 'wizard.stepGrinder', 'wizard.stepTamper', 'wizard.stepBeans'] as const
type WizardStep = 0 | 1 | 2 | 3

// ─── Roast age display ────────────────────────────────────────────────────────

interface RoastAgeDisplayProps {
  days: number
  t: (key: string, params?: TParams) => string
}
function RoastAgeDisplay({ days, t }: RoastAgeDisplayProps) {
  if (days < 7) {
    return <span className="sc-age-tag sc-age-tag--fresh">{t('setup.ageTooFresh')}</span>
  }
  if (days <= 21) {
    return <span className="sc-age-tag sc-age-tag--prime">{t('setup.agePrime')}</span>
  }
  if (days <= 30) {
    return <span className="sc-age-tag sc-age-tag--aging">{t('setup.ageAging')}</span>
  }
  return <span className="sc-age-tag sc-age-tag--stale">{t('setup.ageStale')}</span>
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SetupScreen({ state, dispatch, onSignIn }: SetupScreenProps) {
  const { t } = useTranslation()
  const allClosed = (): Record<CardKey, boolean> => ({
    units: false, machine: false, grinder: false, tamper: false,
    beans: false, maintenance: false, privacy: false,
  })

  const [openCards, setOpenCards] = useState<Record<CardKey, boolean>>(allClosed)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [wizardStep, setWizardStep] = useState<WizardStep>(0)

  // ── Tier gating ───────────────────────────────────────────────────────────
  const tier = useTier(state)
  const isFree = tier === 'free'
  const [premiumTrigger, setPremiumTrigger] = useState<'grinder' | 'tamper' | 'beans' | null>(null)
  const PREMIUM_CARDS: CardKey[] = ['grinder', 'tamper', 'beans']
  const isLocked = (key: CardKey): boolean =>
    isFree && PREMIUM_CARDS.includes(key)

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

  // ── Privacy / consent local state ───────────────────────────────────────────
  const [sharingOn, setSharingOn] = useState<boolean>(
    () => localStorage.getItem('analyticsOptOut') !== 'true'
  )

  function handleSharingToggle() {
    const next = !sharingOn
    setSharingOn(next)
    localStorage.setItem('analyticsOptOut', next ? 'false' : 'true')
  }

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
  // True when the user has filled at least one optional section (machine, grinder, tamp, beans).
  // Used to swap the giant empty-state hero for a thin nudge banner once any progress exists.
  const hasAnyProgress = !!(state.machine?.brand || state.grinder?.brand || state.tamp || state.beans?.brand)

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
    if (isLocked(key)) {
      setPremiumTrigger(key as 'grinder' | 'tamper' | 'beans')
      return
    }
    setOpenCards((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  function openWizard() {
    setWizardStep(0)
    setWizardOpen(true)
  }

  function wizardNext() {
    if (wizardStep < 3) setWizardStep((s) => (s + 1) as WizardStep)
    else setWizardOpen(false)
  }

  function wizardBack() {
    if (wizardStep > 0) setWizardStep((s) => (s - 1) as WizardStep)
  }

  // ─── Machine brand change ─────────────────────────────────────────────────────

  function handleMachineBrandChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const brand = e.target.value
    setMachineBrand(brand)
    setMachineModel('')
  }

  // ─── Machine model dropdown ───────────────────────────────────────────────────
  const machineModelOptions: string[] = machineBrand ? (MACHINE_MODELS[machineBrand] ?? []) : []
  const [machineModelOther, setMachineModelOther] = useState<boolean>(
    !!(machineModel && machineBrand && machineModelOptions.length > 0 && !machineModelOptions.includes(machineModel))
  )

  function handleMachineModelChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value
    if (val === OTHER) {
      setMachineModelOther(true)
      setMachineModel('')
    } else {
      setMachineModelOther(false)
      setMachineModel(val)
    }
  }

  // ─── Grinder model dropdown with auto-preset ─────────────────────────────────
  const grinderModelOptions = grinderBrand ? (GRINDER_MODELS[grinderBrand] ?? []) : []
  const [grinderModelOther, setGrinderModelOther] = useState<boolean>(
    !!(grinderModel && grinderBrand && grinderModelOptions.length > 0
      && !grinderModelOptions.some((m) => m.name === grinderModel))
  )

  function handleGrinderBrandChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setGrinderBrand(e.target.value)
    setGrinderModel('')
    setGrinderModelOther(false)
  }

  function handleGrinderModelChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value
    if (val === OTHER) {
      setGrinderModelOther(true)
      setGrinderModel('')
      return
    }
    setGrinderModelOther(false)
    setGrinderModel(val)
    const preset = (GRINDER_MODELS[grinderBrand] ?? []).find((m) => m.name === val)?.range
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
    { type: 'manual',    icon: <IconTamperManual />,  label: t('setup.tamperManual') },
    { type: 'spring',    icon: <IconTamperSpring />,  label: t('setup.tamperSpring') },
    { type: 'automatic', icon: <IconTamperAuto />,    label: t('setup.tamperAuto')   },
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
      ) : hasAnyProgress ? (
        <button
          className="sc-profile sc-profile--banner"
          type="button"
          onClick={openWizard}
        >
          <span className="sc-profile__banner-eyebrow">{t('setup.bannerEyebrow')}</span>
          <span className="sc-profile__banner-text">{t('setup.profileFinish')}</span>
          <span className="sc-profile__banner-cta">{t('setup.bannerCta')}</span>
        </button>
      ) : (
        <button className="sc-profile-cta" type="button" onClick={openWizard}>
          {t('setup.profileCta')}
        </button>
      )}

      {/* Cards */}
      <div className="sc-cards">

        {/* ── 1. Units ── */}
        <Card
          title={t('setup.cardUnits')}
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
              {t('setup.unitsMetric')}
            </button>
            <button
              className={`sc-pill-option${state.units === 'imperial' ? ' sc-pill-option--active' : ''}`}
              onClick={() => dispatch({ type: 'SET_UNITS', payload: 'imperial' as Units })}
              type="button"
            >
              {t('setup.unitsImperial')}
            </button>
          </div>
          <p className="sc-hint">
            {state.units === 'metric'
              ? t('setup.unitsHintMetric')
              : t('setup.unitsHintImperial')}
          </p>
        </Card>

        {/* ── 2. Machine ── */}
        <Card
          title={t('setup.cardMachine')}
          open={openCards.machine}
          onToggle={() => toggleCard('machine')}
          complete={!!state.machine?.brand}
          icon={<IconWrench />}
        >
          <p className="sc-card__desc">{t('setup.machineDesc')}</p>

          <Field label={t('setup.fieldBrand')}>
            <select
              className="sc-select"
              value={machineBrand}
              onChange={handleMachineBrandChange}
            >
              <option value="">{t('setup.selectBrand')}</option>
              {MACHINE_BRANDS.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </Field>

          <Field label={t('setup.fieldModel')}>
            {machineModelOther || machineModelOptions.length === 0 ? (
              <input
                type="text"
                className="sc-input"
                placeholder={t('setup.modelPlaceholder')}
                value={machineModel}
                onChange={(e) => setMachineModel(e.target.value)}
                onBlur={() => machineBrand && dispatchMachine({ model: machineModel })}
              />
            ) : (
              <select
                className="sc-select"
                value={machineModel}
                onChange={handleMachineModelChange}
              >
                <option value="">{t('setup.selectModel')}</option>
                {machineModelOptions.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
                <option value={OTHER}>{t('setup.other')}</option>
              </select>
            )}
          </Field>

          <div className="sc-row">
            <Field label={t('setup.basketSize')}>
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
            <Field label={t('setup.basketType')}>
              <select
                className="sc-select"
                value={basketType}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setBasketType(e.target.value)}
              >
                {BASKET_TYPES.map((bt) => (
                  <option key={bt} value={bt}>{bt}</option>
                ))}
              </select>
            </Field>
          </div>

          <Field label={state.units === 'imperial' ? t('setup.shotTempF') : t('setup.shotTempC')}>
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
          title={t('setup.cardGrinder')}
          open={openCards.grinder}
          onToggle={() => toggleCard('grinder')}
          complete={!!state.grinder?.brand}
          icon={<IconDroplet />}
          locked={isLocked('grinder')}
        >
          <p className="sc-card__desc">{t('setup.grinderDesc')}</p>

          <Field label={t('setup.grinderType')}>
            <div className="sc-option-group">
              <button
                className={`sc-option-btn${grinderBuiltIn ? ' sc-option-btn--active' : ''}`}
                onClick={() => setGrinderBuiltIn(true)}
                type="button"
              >
                {t('setup.builtIn')}
              </button>
              <button
                className={`sc-option-btn${!grinderBuiltIn ? ' sc-option-btn--active' : ''}`}
                onClick={() => setGrinderBuiltIn(false)}
                type="button"
              >
                {t('setup.standalone')}
              </button>
            </div>
          </Field>

          {!grinderBuiltIn && (
            <>
              <Field label={t('setup.fieldBrand')}>
                <select
                  className="sc-select"
                  value={grinderBrand}
                  onChange={handleGrinderBrandChange}
                >
                  <option value="">{t('setup.selectBrand')}</option>
                  {GRINDER_BRANDS.filter((b) => b !== 'Built-in').map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </Field>

              <Field label={t('setup.fieldModel')}>
                {grinderModelOther || grinderModelOptions.length === 0 ? (
                  <input
                    type="text"
                    className="sc-input"
                    placeholder={t('setup.modelPlaceholder')}
                    value={grinderModel}
                    onChange={(e) => setGrinderModel(e.target.value)}
                  />
                ) : (
                  <select
                    className="sc-select"
                    value={grinderModel}
                    onChange={handleGrinderModelChange}
                  >
                    <option value="">{t('setup.selectModel')}</option>
                    {grinderModelOptions.map((m) => (
                      <option key={m.name} value={m.name}>{m.name}</option>
                    ))}
                    <option value={OTHER}>{t('setup.other')}</option>
                  </select>
                )}
              </Field>

              <div className="sc-row">
                <Field label={t('setup.minSetting')}>
                  <input
                    type="number"
                    className="sc-input"
                    min={0}
                    step={1}
                    value={grinderMin}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setGrinderMin(Number(e.target.value))}
                  />
                </Field>
                <Field label={t('setup.maxSetting')}>
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
          title={t('setup.cardTamper')}
          open={openCards.tamper}
          onToggle={() => toggleCard('tamper')}
          complete={!!state.tamp}
          icon={<IconDisc />}
          locked={isLocked('tamper')}
        >
          <p className="sc-card__desc">So we can hold tamp steady from shot to shot.</p>

          <Field label={t('setup.tamperType')}>
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
            <Field label={t('setup.tamperPressure')}>
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
                    const val = Number(prompt(t('setup.customPrompt'), String(springPressure)))
                    if (val > 0) setSpringPressure(val)
                  }}
                  type="button"
                >
                  {t('setup.tamperCustom')}
                </button>
              </div>
              {![10, 15, 20, 25, 30].includes(springPressure) && (
                <p className="sc-hint">{t('setup.tamperPressureHint', { kg: springPressure })}</p>
              )}
            </Field>
          )}

          {tampType === 'automatic' && (
            <Field label={t('setup.tamperPressure')}>
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
                    const val = Number(prompt(t('setup.customPrompt'), String(autoPressure)))
                    if (val > 0) setAutoPressure(val)
                  }}
                  type="button"
                >
                  {t('setup.tamperCustom')}
                </button>
              </div>
              {![10, 15, 20, 25, 30].includes(autoPressure) && (
                <p className="sc-hint">{t('setup.tamperPressureHint', { kg: autoPressure })}</p>
              )}
            </Field>
          )}

          {tampType === 'manual' && (
            <p className="sc-hint">{t('setup.tamperManualHint')}</p>
          )}
        </Card>

        {/* ── 5. Beans ── */}
        <Card
          title={t('setup.cardBeans')}
          open={openCards.beans}
          onToggle={() => toggleCard('beans')}
          complete={!!state.beans?.brand}
          icon={<IconLeaf />}
          locked={isLocked('beans')}
        >
          <p className="sc-card__desc">{t('setup.beansDesc')}</p>

          <Field label={t('setup.beanRoaster')}>
            <input
              list="bean-roaster-list"
              type="text"
              className="sc-input"
              placeholder={t('setup.beanRoasterPlaceholder')}
              value={beanBrand}
              onChange={(e) => setBeanBrand(e.target.value)}
              onBlur={() => dispatchBeans({ brand: beanBrand })}
            />
            <datalist id="bean-roaster-list">
              {BEAN_ROASTERS.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </Field>

          <Field label={t('setup.fieldType')}>
            <select
              className="sc-select"
              value={beanType}
              onChange={(e) => { setBeanType(e.target.value); dispatchBeans({ type: e.target.value }) }}
            >
              <option value="">{t('setup.selectType')}</option>
              {BEAN_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Field>

          <Field label={t('setup.beanRoastDate')}>
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
                <RoastAgeDisplay days={beanAgeDays} t={t} />
              )}
            </div>
            {beanAgeDays !== null && (
              <p className="sc-bean-age-sub">
                {beanAgeDays === 0 ? t('setup.roastedToday') : t(beanAgeDays === 1 ? 'setup.daysSinceRoast' : 'setup.daysSinceRoastPlural', { days: beanAgeDays })}
              </p>
            )}
          </Field>

          <Field label={t('setup.beanRoastLevel')}>
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
                  {t(rl.labelKey)}
                </button>
              ))}
            </div>
          </Field>

          <button className="sc-new-beans-btn" onClick={handleNewBeans} type="button">
            {t('setup.newBeans')}
          </button>
        </Card>

        {/* ── 6. Maintenance ── */}
        <Card
          title={t('setup.cardMaintenance')}
          open={openCards.maintenance}
          onToggle={() => toggleCard('maintenance')}
          complete={!!(state.maintenance.lastBackflush || state.maintenance.lastDescale || state.maintenance.lastGrinderClean)}
          icon={<IconClock />}
        >
          <p className="sc-card__desc">{t('setup.maintenanceDesc')}</p>

          <MaintenanceRow
            label={t('setup.maintBackflush')}
            lastDate={state.maintenance.lastBackflush}
            intervalDays={BACKFLUSH_INTERVAL_DAYS}
            onDateChange={(v) => setMaintenanceDate('lastBackflush', v)}
            onToday={() => setMaintenanceDate('lastBackflush', TODAY_ISO)}
            t={t}
          />
          <MaintenanceRow
            label={t('setup.maintDescale')}
            lastDate={state.maintenance.lastDescale}
            intervalDays={DESCALE_INTERVAL_DAYS}
            onDateChange={(v) => setMaintenanceDate('lastDescale', v)}
            onToday={() => setMaintenanceDate('lastDescale', TODAY_ISO)}
            t={t}
          />
          <MaintenanceRow
            label={t('setup.maintGrinderClean')}
            lastDate={state.maintenance.lastGrinderClean}
            intervalDays={GRINDER_CLEAN_INTERVAL_DAYS}
            onDateChange={(v) => setMaintenanceDate('lastGrinderClean', v)}
            onToday={() => setMaintenanceDate('lastGrinderClean', TODAY_ISO)}
            t={t}
          />
        </Card>

        {/* ── 7. Privacy ── */}
        <Card
          title={t('setup.cardPrivacy')}
          open={openCards.privacy}
          onToggle={() => toggleCard('privacy')}
          complete={true}
          icon={<IconShield />}
        >
          <div className="sc-privacy-row">
            <div className="sc-privacy-text">
              <span className="sc-privacy-label">{t('setup.privacyLabel')}</span>
              <span className="sc-privacy-sub">{t('setup.privacySub')}</span>
            </div>
            <button
              className={`sc-toggle${sharingOn ? ' sc-toggle--on' : ''}`}
              role="switch"
              aria-checked={sharingOn}
              aria-label={t('setup.privacyLabel')}
              onClick={handleSharingToggle}
              type="button"
            >
              <span className="sc-toggle__thumb" />
            </button>
          </div>
          <a
            className="sc-privacy-link"
            href="/privacy.html"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('setup.privacyPolicyLink')} →
          </a>
        </Card>

      </div>

      {/* Saved toast */}
      <div className={`sc-toast${toastVisible ? ' sc-toast--visible' : ''}`} aria-live="polite" aria-atomic="true">
        {t('setup.toastSaved')}
      </div>

      {/* ── Setup Wizard ── */}
      {wizardOpen && (
        <div className="wz-backdrop" role="dialog" aria-modal="true" aria-label={t('wizard.ariaLabel')}>
          <div className="wz-sheet">

            {/* Header */}
            <div className="wz-header">
              <button className="wz-close" onClick={() => setWizardOpen(false)} type="button" aria-label={t('modal.close')}>✕</button>
              <div className="wz-steps">
                {WIZARD_STEP_KEYS.map((labelKey, i) => (
                  <div key={labelKey} className={`wz-step${i === wizardStep ? ' wz-step--active' : i < wizardStep ? ' wz-step--done' : ''}`}>
                    <span className="wz-step__dot" />
                    <span className="wz-step__label">{t(labelKey)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Step content */}
            <div className="wz-body">

              {wizardStep === 0 && (
                <>
                  <h2 className="wz-title">{t('wizard.step1Title')}</h2>
                  <p className="wz-sub">{t('wizard.step1Sub')}</p>
                  <Field label={t('setup.fieldBrand')}>
                    <select className="sc-select" value={machineBrand} onChange={handleMachineBrandChange}>
                      <option value="">{t('setup.selectBrand')}</option>
                      {MACHINE_BRANDS.map((b) => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </Field>
                  <Field label={t('setup.fieldModel')}>
                    {machineModelOther || machineModelOptions.length === 0 ? (
                      <input type="text" className="sc-input" placeholder={t('setup.modelPlaceholder')}
                        value={machineModel} onChange={(e) => setMachineModel(e.target.value)}
                        onBlur={() => machineBrand && dispatchMachine({ model: machineModel })} />
                    ) : (
                      <select className="sc-select" value={machineModel} onChange={handleMachineModelChange}>
                        <option value="">{t('setup.selectModel')}</option>
                        {machineModelOptions.map((m) => <option key={m} value={m}>{m}</option>)}
                        <option value={OTHER}>{t('setup.other')}</option>
                      </select>
                    )}
                  </Field>
                  <Field label={t('setup.basketSize')}>
                    <input type="number" className="sc-input" min={14} max={24} step={0.1}
                      value={basketSize} onChange={(e) => setBasketSize(Number(e.target.value))} />
                  </Field>
                </>
              )}

              {wizardStep === 1 && (
                <>
                  <h2 className="wz-title">{t('wizard.step2Title')}</h2>
                  <p className="wz-sub">{t('wizard.step2Sub')}</p>
                  <Field label={t('setup.fieldType')}>
                    <div className="sc-option-group">
                      <button className={`sc-option-btn${grinderBuiltIn ? ' sc-option-btn--active' : ''}`}
                        onClick={() => setGrinderBuiltIn(true)} type="button">{t('setup.builtIn')}</button>
                      <button className={`sc-option-btn${!grinderBuiltIn ? ' sc-option-btn--active' : ''}`}
                        onClick={() => setGrinderBuiltIn(false)} type="button">{t('setup.standalone')}</button>
                    </div>
                  </Field>
                  {!grinderBuiltIn && (
                    <>
                      <Field label={t('setup.fieldBrand')}>
                        <select className="sc-select" value={grinderBrand} onChange={handleGrinderBrandChange}>
                          <option value="">{t('setup.selectBrand')}</option>
                          {GRINDER_BRANDS.filter((b) => b !== 'Built-in').map((b) => <option key={b} value={b}>{b}</option>)}
                        </select>
                      </Field>
                      <Field label={t('setup.fieldModel')}>
                        {grinderModelOther || grinderModelOptions.length === 0 ? (
                          <input type="text" className="sc-input" placeholder={t('setup.modelPlaceholder')}
                            value={grinderModel} onChange={(e) => setGrinderModel(e.target.value)} />
                        ) : (
                          <select className="sc-select" value={grinderModel} onChange={handleGrinderModelChange}>
                            <option value="">{t('setup.selectModel')}</option>
                            {grinderModelOptions.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
                            <option value={OTHER}>{t('setup.other')}</option>
                          </select>
                        )}
                      </Field>
                      <div className="sc-row">
                        <Field label={t('setup.minSetting')}>
                          <input type="number" className="sc-input" min={0} step={1}
                            value={grinderMin} onChange={(e) => setGrinderMin(Number(e.target.value))} />
                        </Field>
                        <Field label={t('setup.maxSetting')}>
                          <input type="number" className="sc-input" min={1} step={1}
                            value={grinderMax} onChange={(e) => setGrinderMax(Number(e.target.value))} />
                        </Field>
                      </div>
                    </>
                  )}
                </>
              )}

              {wizardStep === 2 && (
                <>
                  <h2 className="wz-title">{t('wizard.step3Title')}</h2>
                  <p className="wz-sub">{t('wizard.step3Sub')}</p>
                  <Field label={t('setup.fieldType')}>
                    <div className="sc-option-group">
                      {tampOptions.map(({ type: t, icon, label }) => (
                        <button key={t}
                          className={`sc-option-btn sc-tamp-btn${tampType === t ? ' sc-option-btn--active' : ''}`}
                          onClick={() => { setTampType(t); dispatchTamp({ type: t }) }} type="button">
                          <span className="sc-tamp-btn__icon">{icon}</span>
                          <span>{label}</span>
                        </button>
                      ))}
                    </div>
                  </Field>
                  {tampType === 'spring' && (
                    <Field label={t('wizard.springPressure')}>
                      <div className="sc-pressure-presets">
                        {[10, 15, 20, 25, 30].map((kg) => (
                          <button key={kg} className={`sc-pressure-btn${springPressure === kg ? ' sc-option-btn--active' : ''}`}
                            onClick={() => setSpringPressure(kg)} type="button">{kg} kg</button>
                        ))}
                      </div>
                    </Field>
                  )}
                  {tampType === 'automatic' && (
                    <Field label={t('wizard.autoPressure')}>
                      <div className="sc-pressure-presets">
                        {[10, 15, 20, 25, 30].map((kg) => (
                          <button key={kg} className={`sc-pressure-btn${autoPressure === kg ? ' sc-option-btn--active' : ''}`}
                            onClick={() => setAutoPressure(kg)} type="button">{kg} kg</button>
                        ))}
                      </div>
                    </Field>
                  )}
                  {tampType === 'manual' && (
                    <p className="sc-hint">Set tamp per shot on the Brew screen.</p>
                  )}
                </>
              )}

              {wizardStep === 3 && (
                <>
                  <h2 className="wz-title">{t('wizard.step4Title')}</h2>
                  <p className="wz-sub">{t('wizard.step4Sub')}</p>
                  <Field label={t('setup.beanRoaster')}>
                    <input list="wz-bean-roaster-list" type="text" className="sc-input" placeholder={t('setup.beanRoasterPlaceholder')}
                      value={beanBrand} onChange={(e) => setBeanBrand(e.target.value)}
                      onBlur={() => dispatchBeans({ brand: beanBrand })} />
                    <datalist id="wz-bean-roaster-list">
                      {BEAN_ROASTERS.map((r) => <option key={r} value={r} />)}
                    </datalist>
                  </Field>
                  <Field label={t('setup.fieldType')}>
                    <select className="sc-select" value={beanType}
                      onChange={(e) => { setBeanType(e.target.value); dispatchBeans({ type: e.target.value }) }}>
                      <option value="">{t('setup.selectType')}</option>
                      {BEAN_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </Field>
                  <Field label={t('setup.beanRoastDate')}>
                    <div className="sc-date-row">
                      <input type="date" className="sc-input sc-input--date" value={toDateInputValue(roastDate)} max={TODAY_ISO}
                        onChange={(e) => { const v = e.target.value || null; setRoastDate(v); dispatchBeans({ roastDate: v, beanAge: daysSince(v) }) }} />
                      {beanAgeDays !== null && <RoastAgeDisplay days={beanAgeDays} t={t} />}
                    </div>
                  </Field>
                  <Field label={t('setup.beanRoastLevel')}>
                    <div className="sc-roast-group">
                      {ROAST_LEVELS.map((rl) => (
                        <button key={rl.value}
                          className={`sc-roast-btn ${roastTintClass(rl.value)}${roastLevel === rl.value ? ' sc-roast-btn--active' : ''}`}
                          onClick={() => { setRoastLevel(rl.value); dispatchBeans({ roastLevel: rl.value }) }} type="button">
                          {t(rl.labelKey)}
                        </button>
                      ))}
                    </div>
                  </Field>
                </>
              )}

            </div>

            {/* Footer nav */}
            <div className="wz-footer">
              {wizardStep > 0 ? (
                <button className="wz-btn wz-btn--back" onClick={wizardBack} type="button">{t('wizard.back')}</button>
              ) : (
                <div />
              )}
              <button className="wz-btn wz-btn--next" onClick={wizardNext} type="button">
                {wizardStep < 3 ? t('wizard.next') : t('wizard.done')}
              </button>
            </div>

          </div>
        </div>
      )}

      <PremiumModal
        open={premiumTrigger !== null}
        onClose={() => setPremiumTrigger(null)}
        trigger={premiumTrigger}
        isSignedIn={!!state.userId}
        onSignInRequired={onSignIn}
      />

      <style>{`
        /* ── Screen ── */
        .sc-screen {
          padding: 4px 16px 32px;
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
          gap: 10px;
          background: transparent;
          border: none;
          padding: 4px 4px 10px;
          margin-bottom: 6px;
        }

        .sc-profile__dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--accent-green);
          flex-shrink: 0;
          box-shadow: 0 0 0 2.5px rgba(107, 142, 92, 0.18);
        }

        .sc-profile__text {
          font-size: 12px;
          font-weight: 600;
          color: var(--text-tertiary);
          letter-spacing: 0.5px;
          text-transform: uppercase;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        /* Progress banner: a real wizard launcher, not a notification strip. */
        .sc-profile--banner {
          display: grid;
          grid-template-columns: 1fr auto;
          grid-template-rows: auto auto;
          align-items: center;
          column-gap: 12px;
          row-gap: 4px;
          width: 100%;
          background: linear-gradient(180deg, var(--accent-green) 0%, #5C7E4F 100%);
          border: none;
          padding: 14px 18px;
          border-radius: 14px;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
          text-align: left;
          box-shadow: 0 1px 2px rgba(60, 40, 20, 0.04), 0 8px 18px rgba(107, 142, 92, 0.22);
          transition: transform 0.1s ease, box-shadow 0.15s ease;
          position: relative;
          overflow: hidden;
        }
        .sc-profile--banner::before {
          content: '';
          position: absolute;
          inset: 0;
          background: radial-gradient(120% 80% at 100% 0%, rgba(255, 255, 255, 0.16) 0%, transparent 55%);
          pointer-events: none;
        }
        .sc-profile--banner:hover {
          box-shadow: 0 2px 4px rgba(60, 40, 20, 0.06), 0 12px 24px rgba(107, 142, 92, 0.28);
          transform: translateY(-1px);
        }
        .sc-profile--banner:active { transform: scale(0.985); }

        .sc-profile__banner-eyebrow {
          grid-column: 1;
          grid-row: 1;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 1.4px;
          text-transform: uppercase;
          color: rgba(255, 255, 255, 0.78);
          line-height: 1;
        }
        .sc-profile__banner-text {
          grid-column: 1;
          grid-row: 2;
          font-size: 16px;
          font-weight: 700;
          color: #FFFFFF;
          letter-spacing: 0.1px;
          line-height: 1.25;
        }
        .sc-profile__banner-cta {
          grid-column: 2;
          grid-row: 1 / span 2;
          align-self: center;
          font-size: 13px;
          font-weight: 700;
          color: #FFFFFF;
          background: rgba(255, 255, 255, 0.18);
          padding: 8px 14px;
          border-radius: 9999px;
          letter-spacing: 0.2px;
          white-space: nowrap;
        }

        /* Empty state hero */
        .sc-profile--empty {
          background: linear-gradient(180deg, #FDFBF7 0%, var(--white) 100%);
          border: 1px solid var(--border-light);
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          gap: 10px;
          padding: 32px 24px 28px;
          box-shadow: 0 1px 3px rgba(60, 40, 20, 0.06), 0 8px 24px rgba(60, 40, 20, 0.05);
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

        /* Sleek full-width CTA — sibling of the BREW button on the brew tab,
           same gradient + copper hairline so the whole app speaks one language. */
        .sc-profile-cta {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          height: clamp(50px, 7.5vh, 64px);
          font-family: var(--font-primary);
          font-size: clamp(14px, 2vh, 16px);
          font-weight: 700;
          letter-spacing: 3px;
          text-transform: uppercase;
          border-radius: 9999px;
          background:
            radial-gradient(120% 100% at 50% 0%, rgba(255,255,255,0.16), transparent 55%),
            linear-gradient(180deg, #84A571 0%, #6B8E5C 55%, #587D49 100%);
          color: var(--white);
          border: 1.5px solid rgba(184, 116, 74, 0.45);
          cursor: pointer;
          transition: transform 0.12s ease, box-shadow 0.22s ease, filter 0.18s ease;
          -webkit-tap-highlight-color: transparent;
          box-shadow:
            inset 0 1.5px 0 rgba(255, 255, 255, 0.28),
            inset 0 -2px 0 rgba(40, 60, 30, 0.20),
            0 0 0 1px rgba(184, 116, 74, 0.18),
            0 2px 4px rgba(60, 40, 20, 0.10),
            0 10px 24px rgba(88, 125, 73, 0.30);
          margin: 4px 0;
        }
        .sc-profile-cta:hover { filter: brightness(1.04); }
        .sc-profile-cta:active { transform: scale(0.985); filter: brightness(0.96); }

        .sc-profile__cta-btn {
          margin-top: 10px;
          display: inline-flex;
          align-items: center;
          font-size: 15px;
          font-weight: 700;
          padding: 13px 28px;
          border-radius: 999px;
          background: var(--accent-green);
          color: var(--white);
          border: none;
          cursor: pointer;
          transition: background 0.18s ease, transform 0.12s ease, box-shadow 0.18s ease;
          -webkit-tap-highlight-color: transparent;
          letter-spacing: 0.2px;
          box-shadow: 0 2px 8px rgba(60, 40, 20, 0.10), 0 8px 22px rgba(107, 142, 92, 0.28);
        }

        .sc-profile__cta-btn:active {
          background: #5C7E4D;
          transform: scale(0.97);
          box-shadow: 0 1px 4px rgba(60, 40, 20, 0.10), 0 3px 10px rgba(107, 142, 92, 0.22);
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
          gap: clamp(6px, 1.2vh, 12px);
        }

        /* ── Card ── */
        .sc-card {
          background: var(--white);
          border-radius: 16px;
          border: 1px solid var(--border-light);
          box-shadow: 0 1px 3px rgba(60, 40, 20, 0.05), 0 4px 12px rgba(60, 40, 20, 0.04);
          overflow: hidden;
        }

        .sc-card__header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          padding: clamp(9px, 1.6vh, 16px) clamp(14px, 4vw, 20px);
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
          gap: 12px;
        }

        .sc-card__header-right {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-shrink: 0;
        }

        .sc-card__icon {
          color: var(--copper);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          width: clamp(26px, 4.4vh, 36px);
          height: clamp(26px, 4.4vh, 36px);
          border-radius: 10px;
          background: rgba(184, 116, 74, 0.10);
          border: 1px solid rgba(184, 116, 74, 0.18);
        }

        .sc-card__title {
          font-size: clamp(13px, 2vh, 16px);
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
          background: var(--accent-green);
          border-color: var(--accent-green);
          box-shadow: 0 0 0 2px rgba(107, 142, 92, 0.18);
        }

        /* Premium-locked card: copper badge replaces the complete-dot */
        .sc-card--locked .sc-card__title { color: var(--text-secondary); }
        .sc-card--locked .sc-card__icon  { opacity: 0.55; }
        .sc-card__premium-badge {
          font-size: 9px;
          font-weight: 800;
          letter-spacing: 1.2px;
          text-transform: uppercase;
          color: var(--copper-deep);
          background: rgba(184, 116, 74, 0.14);
          border: 1px solid rgba(184, 116, 74, 0.32);
          padding: 3px 8px;
          border-radius: 9999px;
          line-height: 1;
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
          box-shadow: 0 0 0 3px rgba(107, 142, 92,0.1);
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
          box-shadow: 0 0 0 3px rgba(107, 142, 92,0.1);
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
          box-shadow: 0 0 0 3px rgba(107, 142, 92,0.12);
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
          top: calc(var(--safe-top) + 70px);
          right: 16px;
          transform: translateY(-8px);
          background: rgba(26,26,26,0.92);
          color: #fff;
          font-size: 12px;
          font-weight: 600;
          padding: 6px 14px;
          border-radius: 999px;
          pointer-events: none;
          opacity: 0;
          transition: opacity 0.2s ease, transform 0.2s ease;
          white-space: nowrap;
          backdrop-filter: blur(6px);
          -webkit-backdrop-filter: blur(6px);
          z-index: 100;
          letter-spacing: 0.1px;
          box-shadow: 0 4px 14px rgba(0,0,0,0.18);
        }

        .sc-toast--visible {
          opacity: 1;
          transform: translateY(0);
        }

        /* ── Privacy row ── */
        .sc-privacy-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
        }

        .sc-privacy-text {
          display: flex;
          flex-direction: column;
          gap: 3px;
          flex: 1;
          min-width: 0;
        }

        .sc-privacy-label {
          font-size: 14px;
          font-weight: 600;
          color: var(--text-primary);
          line-height: 1.3;
        }

        .sc-privacy-sub {
          font-size: 12px;
          color: var(--text-tertiary);
          line-height: 1.45;
        }

        .sc-privacy-link {
          display: inline-block;
          margin-top: 12px;
          font-size: 13px;
          font-weight: 600;
          color: var(--copper);
          text-decoration: none;
          letter-spacing: 0.1px;
        }
        .sc-privacy-link:hover { color: var(--copper-deep); }
        .sc-privacy-link:active { transform: scale(0.97); }

        /* ── Toggle switch ── */
        .sc-toggle {
          position: relative;
          width: 44px;
          height: 26px;
          border-radius: 999px;
          border: none;
          background: #D1D5DB;
          cursor: pointer;
          flex-shrink: 0;
          padding: 0;
          transition: background 0.2s ease;
          -webkit-tap-highlight-color: transparent;
        }

        .sc-toggle--on {
          background: var(--accent-green);
        }

        .sc-toggle__thumb {
          position: absolute;
          top: 3px;
          left: 3px;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: #fff;
          box-shadow: 0 1px 3px rgba(0,0,0,0.2);
          transition: transform 0.2s ease;
          pointer-events: none;
        }

        .sc-toggle--on .sc-toggle__thumb {
          transform: translateX(18px);
        }

        /* ── Wizard ── */
        .wz-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.55);
          backdrop-filter: blur(4px);
          -webkit-backdrop-filter: blur(4px);
          z-index: 200;
          display: flex;
          align-items: flex-end;
        }

        .wz-sheet {
          background: var(--white);
          border-radius: 24px 24px 0 0;
          width: 100%;
          max-height: 92vh;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          animation: wz-slide-up 0.28s cubic-bezier(0.32, 0.72, 0, 1);
        }

        @keyframes wz-slide-up {
          from { transform: translateY(100%); }
          to   { transform: translateY(0); }
        }

        .wz-header {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 18px 20px 14px;
          border-bottom: 1px solid var(--border-light);
          flex-shrink: 0;
        }

        .wz-close {
          font-size: 16px;
          color: var(--text-tertiary);
          background: none;
          border: none;
          cursor: pointer;
          padding: 4px;
          line-height: 1;
          flex-shrink: 0;
          -webkit-tap-highlight-color: transparent;
        }

        .wz-steps {
          display: flex;
          justify-content: space-between;
          gap: 4px;
          flex: 1;
          align-items: center;
          min-width: 0;
        }

        .wz-step {
          display: flex;
          align-items: center;
          gap: 4px;
          opacity: 0.7;
          transition: opacity 0.2s ease;
          min-width: 0;
        }

        .wz-step--active {
          opacity: 1;
        }

        .wz-step--done {
          opacity: 0.85;
        }

        .wz-step__dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--text-tertiary);
          flex-shrink: 0;
          transition: background 0.2s ease;
        }

        .wz-step--active .wz-step__dot {
          background: var(--accent-green);
          width: 14px;
          border-radius: 4px;
        }

        .wz-step--done .wz-step__dot {
          background: var(--accent-green);
        }

        .wz-step__label {
          font-size: 10px;
          font-weight: 700;
          color: var(--text-tertiary);
          letter-spacing: 0.4px;
          text-transform: uppercase;
          white-space: nowrap;
        }

        .wz-step--active .wz-step__label {
          color: var(--accent-green);
        }

        .wz-step--done .wz-step__label {
          color: var(--accent-green);
        }

        .wz-body {
          padding: 20px 20px 8px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 16px;
          flex: 1;
        }

        .wz-title {
          font-size: 22px;
          font-weight: 800;
          color: var(--text-primary);
          margin: 0;
          line-height: 1.2;
        }

        .wz-sub {
          font-size: 13px;
          color: var(--text-tertiary);
          line-height: 1.5;
          margin: -6px 0 4px;
        }

        .wz-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 20px calc(16px + env(safe-area-inset-bottom));
          border-top: 1px solid var(--border-light);
          gap: 12px;
          flex-shrink: 0;
        }

        .wz-btn {
          font-size: 15px;
          font-weight: 700;
          padding: 13px 24px;
          border-radius: 999px;
          border: none;
          cursor: pointer;
          transition: opacity 0.15s ease, transform 0.1s ease;
          -webkit-tap-highlight-color: transparent;
          letter-spacing: 0.1px;
        }

        .wz-btn:active {
          opacity: 0.82;
          transform: scale(0.97);
        }

        .wz-btn--back {
          background: var(--off-white);
          color: var(--text-secondary);
        }

        .wz-btn--next {
          background: var(--accent-green);
          color: #fff;
          flex: 1;
        }
      `}</style>
    </div>
  )
}
