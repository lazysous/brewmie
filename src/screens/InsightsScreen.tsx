import React from 'react'
import { createPortal } from 'react-dom'
import type { BrewmieState, AppAction, ShotEntry } from '../types'
import { useState } from 'react'
import { useTranslation } from '../hooks/useTranslation'
import { useTier } from '../hooks/useTier'
import { PremiumModal } from '../components/PremiumModal'

// ─── Computation helpers ───────────────────────────────────────────────────────

function groupShotsByDate(shots: ShotEntry[]): Map<string, ShotEntry[]> {
  const map = new Map<string, ShotEntry[]>()
  for (const shot of shots) {
    const date = shot.timestamp.slice(0, 10)
    const group = map.get(date) ?? []
    group.push(shot)
    map.set(date, group)
  }
  return map
}

function getFirstShots(shots: ShotEntry[]): ShotEntry[] {
  const byDate = groupShotsByDate(shots)
  const result: ShotEntry[] = []
  for (const group of byDate.values()) {
    // shots are stored newest-first; earliest shot on each date has the oldest timestamp
    const sorted = [...group].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    )
    result.push(sorted[0])
  }
  return result
}

function avgScore(shots: ShotEntry[]): number | null {
  const rated = shots.filter((s): s is ShotEntry & { score: number } => s.score !== null)
  if (rated.length === 0) return null
  return rated.reduce((sum, s) => sum + s.score, 0) / rated.length
}

function optimalGrind(shots: ShotEntry[]): number | null {
  const highScoring = shots.filter((s) => s.score !== null && s.score >= 85)
  if (highScoring.length === 0) return null

  // Count frequency of each grind setting (rounded to 1 decimal)
  const freq = new Map<number, number>()
  for (const s of highScoring) {
    const key = Math.round(s.inputGrind * 10) / 10
    freq.set(key, (freq.get(key) ?? 0) + 1)
  }

  // Find maximum frequency
  let maxCount = 0
  for (const count of freq.values()) {
    if (count > maxCount) maxCount = count
  }

  // If there's a clear winner (appears more than once OR is the only option)
  const winners: number[] = []
  for (const [grind, count] of freq.entries()) {
    if (count === maxCount) winners.push(grind)
  }

  if (winners.length === 1) return winners[0]

  // No clear winner -- return average
  const total = highScoring.reduce((sum, s) => sum + s.inputGrind, 0)
  return Math.round((total / highScoring.length) * 10) / 10
}

function stdDev(values: number[]): number {
  if (values.length === 0) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

function consistencyKey(shots: ShotEntry[]): string {
  const rated = shots.filter((s): s is ShotEntry & { score: number } => s.score !== null)
  if (rated.length < 2) return 'insights.consistencyNoData'
  const sd = stdDev(rated.map((s) => s.score))
  if (sd <= 3) return 'insights.consistencyHigh'
  if (sd <= 6) return 'insights.consistencyMedium'
  return 'insights.consistencyLow'
}

// ─── Days of dialling in ──────────────────────────────────────────────────────

function dialInDays(shots: ShotEntry[]): number | null {
  if (shots.length < 2) return null
  const timestamps = shots.map((s) => new Date(s.timestamp).getTime())
  const first = Math.min(...timestamps)
  const last = Math.max(...timestamps)
  const days = Math.round((last - first) / (1000 * 60 * 60 * 24))
  return days > 0 ? days : null
}

// ─── Score pill colour helper ──────────────────────────────────────────────────

function scorePillStyle(score: number | null): React.CSSProperties {
  if (score === null) return { background: '#E0E0E0', color: '#6A6A6A' }
  if (score >= 95) return { background: '#FFD700', color: '#6B4E00' }
  if (score >= 85) return { background: '#6B8E5C', color: '#FFFFFF' }
  if (score >= 70) return { background: '#9A9A9A', color: '#FFFFFF' }
  return { background: '#8B1A1A', color: '#FFFFFF' }
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function adjustmentLabel(shot: ShotEntry): { textKey: string; positive: boolean; neutral: boolean } {
  if (shot.grindAdjust === null || shot.grindAdjust === undefined) {
    return { textKey: 'insights.adjOnTarget', positive: false, neutral: true }
  }
  if (shot.grindAdjust < 0) return { textKey: 'insights.adjGrindDown', positive: false, neutral: false }
  if (shot.grindAdjust > 0) return { textKey: 'insights.adjGrindUp', positive: true, neutral: false }
  return { textKey: 'insights.adjOnTarget', positive: false, neutral: true }
}

// ─── Skeleton placeholder ─────────────────────────────────────────────────────

function StatSkeleton() {
  return (
    <span
      className="ix-stat-skeleton"
      aria-hidden="true"
    />
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

interface InsightsScreenProps {
  state: BrewmieState
  dispatch: React.Dispatch<AppAction>
  onSignIn: () => void
}

// ── Shot edit bottom-sheet ──────────────────────────────────────────────────
// Lets the user retag taste + correct actuals on any historical shot. Saved
// updates flow through UPDATE_SHOT, which the algorithm picks up next time
// personalTimeWindow recomputes from state.shots.
function ShotEditSheet({
  shot, t, onClose, onSave, onDelete,
}: {
  shot: ShotEntry
  t: (k: string, p?: Record<string, string | number>) => string
  onClose: () => void
  onSave: (updates: Partial<ShotEntry>) => void
  onDelete: () => void
}) {
  const [crema, setCrema] = useState<'thin' | 'normal' | 'thick' | null>(shot.crema)
  const [flavor, setFlavor] = useState<'sour' | 'balanced' | 'bitter' | null>(shot.tasteFlavor)
  const [strength, setStrength] = useState<'weak' | 'perfect' | 'strong' | null>(shot.tasteStrength)
  const [actualTime, setActualTime] = useState<string>(shot.actualTime !== null ? String(shot.actualTime) : '')
  const [actualVolume, setActualVolume] = useState<string>(shot.actualVolume !== null ? String(shot.actualVolume) : '')

  function handleSave() {
    const updates: Partial<ShotEntry> = {
      crema,
      tasteFlavor: flavor,
      tasteStrength: strength,
    }
    const t1 = parseFloat(actualTime)
    if (Number.isFinite(t1)) updates.actualTime = Math.round(t1 * 10) / 10
    const v1 = parseFloat(actualVolume)
    if (Number.isFinite(v1)) updates.actualVolume = Math.round(v1 * 10) / 10
    onSave(updates)
  }

  return createPortal(
    <div className="ix-sheet-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="ix-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="ix-sheet__header">
          <span className="ix-sheet__title">{t('insights.editShot')}</span>
          <button className="ix-sheet__close" type="button" onClick={onClose} aria-label={t('common.close')}>×</button>
        </div>
        <div className="ix-sheet__body">

          <div className="ix-edit-row">
            <label className="ix-edit-row__label">{t('insights.editTime')}</label>
            <input
              className="ix-edit-row__input"
              type="text" inputMode="decimal"
              value={actualTime}
              onChange={(e) => /^[0-9.]*$/.test(e.target.value) && setActualTime(e.target.value)}
            />
            <span className="ix-edit-row__unit">s</span>
          </div>

          <div className="ix-edit-row">
            <label className="ix-edit-row__label">{t('insights.editVolume')}</label>
            <input
              className="ix-edit-row__input"
              type="text" inputMode="decimal"
              value={actualVolume}
              onChange={(e) => /^[0-9.]*$/.test(e.target.value) && setActualVolume(e.target.value)}
            />
            <span className="ix-edit-row__unit">ml</span>
          </div>

          <div className="ix-edit-group">
            <span className="ix-edit-group__label">{t('rating.crema')}</span>
            <div className="ix-edit-pills">
              {(['thin', 'normal', 'thick'] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`ix-edit-pill${crema === c ? ' ix-edit-pill--on' : ''}`}
                  onClick={() => setCrema(crema === c ? null : c)}
                >
                  {t(`crema.${c}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="ix-edit-group">
            <span className="ix-edit-group__label">{t('insights.editTaste')}</span>
            <div className="ix-edit-pills">
              {(['sour', 'balanced', 'bitter'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`ix-edit-pill${flavor === f ? ' ix-edit-pill--on' : ''}`}
                  onClick={() => setFlavor(flavor === f ? null : f)}
                >
                  {t(`taste.${f}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="ix-edit-group">
            <span className="ix-edit-group__label">{t('insights.editStrength')}</span>
            <div className="ix-edit-pills">
              {(['weak', 'perfect', 'strong'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`ix-edit-pill${strength === s ? ' ix-edit-pill--on' : ''}`}
                  onClick={() => setStrength(strength === s ? null : s)}
                >
                  {t(`taste.${s}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="ix-edit-actions">
            <button type="button" className="ix-edit-delete" onClick={onDelete}>
              {t('insights.deleteShot')}
            </button>
            <button type="button" className="ix-edit-save" onClick={handleSave}>
              {t('common.save')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

export function InsightsScreen({ state, dispatch, onSignIn }: InsightsScreenProps) {
  const { t } = useTranslation()
  const tier = useTier(state)
  const isFree = tier === 'free'
  const [premiumTrigger, setPremiumTrigger] = useState<'history' | 'benchmarks' | 'export' | null>(null)

  // Free tier sees only shots in the last 30 days.
  const allShots = state.shots
  const totalShotCount = allShots.length
  const cutoffMs = Date.now() - 30 * 24 * 60 * 60 * 1000
  const visibleShots = isFree
    ? allShots.filter((s) => new Date(s.timestamp).getTime() >= cutoffMs)
    : allShots
  const hiddenByFreeCap = isFree ? totalShotCount - visibleShots.length : 0

  const shots = visibleShots
  const shotCount = shots.length

  // ── Stat computations ──────────────────────────────────────────────────────

  const firstShots = getFirstShots(shots)
  const firstShotAvg = avgScore(firstShots)

  // Follow-up shots: all non-first shots on days that have 2+ shots
  const byDate = groupShotsByDate(shots)
  const followUpShots: ShotEntry[] = []
  for (const group of byDate.values()) {
    if (group.length >= 2) {
      const sorted = [...group].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      )
      followUpShots.push(...sorted.slice(1))
    }
  }
  const followUpAvg = avgScore(followUpShots)

  const optGrind = optimalGrind(shots)

  // ── Days of dialling in ────────────────────────────────────────────────────

  void dialInDays(shots)

  // ── Benchmarks ────────────────────────────────────────────────────────────

  // Premium gates benchmarks. Free users see the lock regardless of shot count.
  const benchmarksUnlocked = !isFree && shotCount >= 10
  const shotsToGo = Math.max(0, 10 - shotCount)

  const topShots = shots.filter((s) => s.score !== null && s.score >= 85)

  let timeWindowLabel = '--'
  let timeMedianLabel = ''
  if (topShots.length > 0) {
    const times = topShots
      .filter((s) => s.actualTime !== null)
      .map((s) => s.actualTime as number)
      .sort((a, b) => a - b)
    if (times.length > 0) {
      const tMin = Math.round(times[0])
      const tMax = Math.round(times[times.length - 1])
      timeWindowLabel = tMin === tMax ? `${tMin}s` : `${tMin}–${tMax}s`
      const median = times[Math.floor(times.length / 2)]
      timeMedianLabel = `median ${Math.round(median)}s`
    }
  }

  const consistency = t(consistencyKey(shots))

  // ── Richer benchmarks data ────────────────────────────────────────────────

  // Sweet spot recipe — average of the top-scoring shots.
  type SweetSpot = {
    grind: number; dose: number; volume: number; time: number; ratio: number; n: number
    bestBeanAge: number | null    // median days off roast across top shots
  }
  let sweetSpot: SweetSpot | null = null
  if (topShots.length > 0) {
    const valid = topShots.filter((s) => s.actualVolume !== null && s.actualTime !== null)
    if (valid.length > 0) {
      const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
      const med = (xs: number[]) => {
        const s = [...xs].sort((a, b) => a - b)
        const m = Math.floor(s.length / 2)
        return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
      }
      const grind = avg(valid.map((s) => s.inputGrind))
      const dose = avg(valid.map((s) => s.inputDose))
      const volume = avg(valid.map((s) => s.actualVolume as number))
      const time = avg(valid.map((s) => s.actualTime as number))
      const ages = valid.map((s) => s.beanAge).filter((a): a is number => typeof a === 'number')
      sweetSpot = {
        grind: Math.round(grind * 2) / 2,
        dose: Math.round(dose * 10) / 10,
        volume: Math.round(volume),
        time: Math.round(time),
        ratio: dose > 0 ? volume / dose : 0,
        n: valid.length,
        bestBeanAge: ages.length >= 2 ? Math.round(med(ages)) : null,
      }
    }
  }

  // Personal best.
  const scoredShots = shots.filter((s) => s.score !== null) as (ShotEntry & { score: number })[]
  const personalBest = scoredShots.length > 0
    ? scoredShots.reduce((best, s) => (s.score > best.score ? s : best), scoredShots[0])
    : null

  // This week — last 7 days.
  const weekAgo = Date.now() - 7 * 86400000
  const thisWeekShots = shots.filter((s) => new Date(s.timestamp).getTime() >= weekAgo)
  const thisWeekScored = thisWeekShots.filter((s) => s.score !== null) as (ShotEntry & { score: number })[]
  const thisWeekAvg = thisWeekScored.length > 0
    ? Math.round(thisWeekScored.reduce((a, s) => a + s.score, 0) / thisWeekScored.length)
    : null

  // Days active — distinct YYYY-MM-DD count.
  const distinctDays = new Set(shots.map((s) => s.timestamp.slice(0, 10))).size

  // Consistency value (numeric) — for the bar fill. Inverts std dev of recent
  // 10 scores into a 0–100 "steadiness" reading.
  const recentScored = scoredShots.slice(0, 10)
  let consistencyPct = 0
  if (recentScored.length >= 3) {
    const mean = recentScored.reduce((a, s) => a + s.score, 0) / recentScored.length
    const variance = recentScored.reduce((a, s) => a + Math.pow(s.score - mean, 2), 0) / recentScored.length
    const sd = Math.sqrt(variance)
    consistencyPct = Math.round(Math.max(0, Math.min(100, 100 - sd * 3)))
  }

  const formatShotDate = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  }

  // ── Handlers ──────────────────────────────────────────────────────────────

  // CSV export — Title Case headers, ISO dates, clean column order matching
  // the field names the app uses. Premium-gated.
  async function handleExportCsv() {
    if (shots.length === 0) return
    if (isFree) { setPremiumTrigger('export'); return }
    const cols: { key: keyof ShotEntry; label: string }[] = [
      { key: 'timestamp',     label: 'Timestamp' },
      { key: 'inputGrind',    label: 'Grind' },
      { key: 'inputDose',     label: 'Dose (g)' },
      { key: 'inputTamp',     label: 'Tamp' },
      { key: 'targetVolume',  label: 'Target Volume (ml)' },
      { key: 'targetTime',    label: 'Target Time (s)' },
      { key: 'actualVolume',  label: 'Actual Volume (ml)' },
      { key: 'actualTime',    label: 'Actual Time (s)' },
      { key: 'score',         label: 'Score' },
      { key: 'crema',         label: 'Crema' },
      { key: 'tasteFlavor',   label: 'Flavour' },
      { key: 'tasteStrength', label: 'Strength' },
      { key: 'grindAdjust',   label: 'Grind Adjust' },
      { key: 'doseAdjust',    label: 'Dose Adjust' },
      { key: 'tampAdjust',    label: 'Tamp Adjust' },
      { key: 'beanAge',       label: 'Bean Age (days)' },
      { key: 'roastLevel',    label: 'Roast Level' },
      { key: 'temp',          label: 'Ambient Temp (°C)' },
      { key: 'humidity',      label: 'Humidity (%)' },
    ]
    const titleCase = (s: string) => s.replace(/(^|[\s-])([a-z])/g, (_, b, c) => b + c.toUpperCase())
    const escape = (v: unknown): string => {
      if (v === null || v === undefined) return ''
      let s = String(v)
      if (typeof v === 'string' && /^(sour|balanced|bitter|weak|perfect|strong|thin|normal|thick|light|medium|medium-light|medium-dark|dark)$/.test(v)) {
        s = titleCase(v)
      }
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const sorted = [...shots].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )
    const rows = sorted.map((s) =>
      cols.map(({ key }) => escape((s as unknown as Record<string, unknown>)[key])).join(',')
    )
    const csv = [cols.map((c) => c.label).join(','), ...rows].join('\n')
    const filename = `brewmie-shots-${new Date().toISOString().slice(0, 10)}.csv`

    // Native (iOS/Android): write to cache then open the OS share sheet so
    // the user can mail, save to Files / Drive, or AirDrop.
    if ((await import('@capacitor/core')).Capacitor.isNativePlatform()) {
      try {
        const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
        const { Share } = await import('@capacitor/share')
        const written = await Filesystem.writeFile({
          path: filename,
          data: csv,
          directory: Directory.Cache,
          encoding: Encoding.UTF8,
        })
        await Share.share({
          title: 'Brewmie shots',
          text: 'Your Brewmie shot log',
          url: written.uri,
          dialogTitle: 'Save or send your shots',
        })
      } catch {
        // User cancelled or plugin unavailable — silent.
      }
      return
    }

    // Web fallback: trigger a download via Blob URL.
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleClearShots() {
    if (!window.confirm(t('insights.confirmClear'))) return
    for (const shot of shots) {
      dispatch({ type: 'DELETE_SHOT', payload: shot.id })
    }
  }

  // ── Shots (newest first). Limit visible to 3; "View all" opens the modal.

  const allShotsSorted = [...shots]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  const recentShots = allShotsSorted.slice(0, 3)
  const [allShotsOpen, setAllShotsOpen] = useState(false)
  const [editingShotId, setEditingShotId] = useState<string | null>(null)
  const editingShot = editingShotId ? shots.find((s) => s.id === editingShotId) ?? null : null

  // ── 100-shot club progress ─────────────────────────────────────────────────

  const shotClubPct = Math.min(100, (shotCount / 100) * 100)

  // ─── Render ───────────────────────────────────────────────────────────────

  // Reusable row renderer: used in both the recent (3) and the View-all modal.
  function renderShotRow(shot: ShotEntry, idx: number, listLength: number) {
    const adj = adjustmentLabel(shot)
    const beanLabel = state.beans?.brand ?? formatDate(shot.timestamp)
    const params = [
      `${shot.inputDose}g`,
      `${shot.actualVolume ?? shot.targetVolume}ml`,
      `${shot.actualTime ?? shot.targetTime}s`,
      `grind ${shot.inputGrind}`,
    ].join(' · ')
    const isExcellent = shot.score !== null && shot.score >= 85
    const isEvenRow = idx % 2 === 1
    return (
      <button
        key={shot.id}
        type="button"
        className="ix-shot-row"
        onClick={() => setEditingShotId(shot.id)}
        style={{
          borderBottom: idx < listLength - 1 ? '1px solid var(--border-light)' : 'none',
          background: isExcellent
            ? 'rgba(107, 142, 92, 0.02)'
            : isEvenRow
            ? 'var(--cream)'
            : undefined,
        }}
      >
        <span className="ix-score-pill" style={scorePillStyle(shot.score)}>
          {shot.score !== null ? shot.score : '–'}
        </span>
        <span className="ix-shot-row__bean">{beanLabel}</span>
        <span className="ix-shot-row__params">{params}</span>
        <span
          className="ix-adj-badge"
          style={{
            color: adj.neutral ? '#6A9A6A' : adj.positive ? '#6B8E5C' : '#8B1A1A',
            background: adj.neutral
              ? 'rgba(107, 142, 92, 0.07)'
              : adj.positive
              ? 'rgba(107, 142, 92, 0.1)'
              : 'rgba(139, 26, 26, 0.08)',
          }}
        >
          {t(adj.textKey)}
        </span>
      </button>
    )
  }

  return (
    <div className="ix-screen">

      {/* Stats Grid */}
      <div className="ix-stats-grid">

        {/* First Shot Avg */}
        <div className="ix-stat-card">
          <span className="ix-stat-card__value">
            {firstShotAvg !== null ? firstShotAvg.toFixed(1) : <StatSkeleton />}
          </span>
          <span className="ix-stat-card__label">{t('insights.firstShotAvg')}</span>
        </div>

        {/* Follow-up Avg */}
        <div className="ix-stat-card">
          <span className="ix-stat-card__value">
            {followUpAvg !== null ? followUpAvg.toFixed(1) : <StatSkeleton />}
          </span>
          <span className="ix-stat-card__label">{t('insights.followUpAvg')}</span>
        </div>

        {/* Optimal Grind */}
        <div className="ix-stat-card">
          <span className="ix-stat-card__value">
            {optGrind !== null ? optGrind : <StatSkeleton />}
          </span>
          <span className="ix-stat-card__label">{t('insights.optimalGrind')}</span>
        </div>

        {/* Total Shots + 100-shot club */}
        <div className="ix-stat-card">
          <span className="ix-stat-card__value">{shotCount}</span>
          <span className="ix-stat-card__label">{t('insights.totalShots')}</span>
          {shotCount > 0 && (
            <div className="ix-shot-club-bar" title={t('insights.shotClubTooltip', { count: shotCount })}>
              <div
                className="ix-shot-club-bar__fill"
                style={{ width: `${shotClubPct}%` }}
              />
            </div>
          )}
        </div>

      </div>

      {/* Recent Performance */}
      <div className="ix-card">
        <div className="ix-card__header">
          <span className="ix-card__title">{t('insights.recentPerformance')}</span>
          {shotCount > 0 && (
            <button className="ix-ghost-btn" onClick={handleClearShots}>
              {t('insights.clear')}
            </button>
          )}
        </div>

        {recentShots.length === 0 ? (
          <div className="ix-empty-state">
            {/* Simple coffee cup SVG */}
            <svg className="ix-empty-state__icon" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M10 20h44l-4 28H14L10 20Z" stroke="#C0C0C0" strokeWidth="2.5" strokeLinejoin="round" fill="none"/>
              <path d="M48 26h6a6 6 0 0 1 0 12h-6" stroke="#C0C0C0" strokeWidth="2.5" strokeLinecap="round" fill="none"/>
              <path d="M22 14c0-4 6-4 6-8" stroke="#C0C0C0" strokeWidth="2" strokeLinecap="round"/>
              <path d="M32 14c0-4 6-4 6-8" stroke="#C0C0C0" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <p className="ix-empty-state__heading">{t('insights.emptyHeading')}</p>
          </div>
        ) : (
          <>
            <div className="ix-shot-list">
              {recentShots.map((shot, idx) => renderShotRow(shot, idx, recentShots.length))}
            </div>
            {allShotsSorted.length > recentShots.length && (
              <button
                className="ix-view-all-btn"
                type="button"
                onClick={() => setAllShotsOpen(true)}
              >
                {t('insights.viewAll', { count: allShotsSorted.length })}
              </button>
            )}
          </>
        )}
      </div>

      {/* Personal Benchmarks */}
      <div className="ix-card">
        <div className="ix-card__header">
          <span className="ix-card__title">{t('insights.personalBenchmarks')}</span>
        </div>

        {!benchmarksUnlocked ? (
          <button
            type="button"
            className="ix-locked"
            onClick={() => isFree ? setPremiumTrigger('benchmarks') : undefined}
            style={{ width: '100%', cursor: isFree ? 'pointer' : 'default', background: 'none', border: 'none', textAlign: 'center', padding: 0 }}
          >
            {/* Padlock SVG */}
            <svg className="ix-locked__icon" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="6" y="14" width="20" height="14" rx="3" stroke="#9A9A9A" strokeWidth="2" fill="none"/>
              <path d="M10 14v-4a6 6 0 0 1 12 0v4" stroke="#9A9A9A" strokeWidth="2" strokeLinecap="round" fill="none"/>
              <circle cx="16" cy="21" r="2" fill="#9A9A9A"/>
            </svg>
            <p className="ix-locked__heading">{isFree ? t('tierLock.benchmarksLocked') : t('insights.unlockAt10')}</p>
            <div className="ix-locked__progress-wrap">
              <div className="ix-locked__progress-bar">
                <div
                  className="ix-locked__progress-fill"
                  style={{ width: `${(shotCount / 10) * 100}%` }}
                />
                {/* Shimmer on unfilled portion */}
                <div
                  className="ix-progress-shimmer"
                  style={{ left: `${(shotCount / 10) * 100}%` }}
                />
              </div>
              <span className="ix-locked__progress-label">{t('insights.toGo', { count: shotsToGo })}</span>
            </div>
          </button>
        ) : (
          <div className="ix-bench">
            {/* Hero tile — the sweet-spot recipe in full */}
            <div className="ix-bench__hero">
              <span className="ix-bench__eyebrow">{t('insights.sweetSpotEyebrow')}</span>
              {sweetSpot ? (
                <>
                  <div className="ix-bench__recipe">
                    <span className="ix-bench__recipe-num">{sweetSpot.dose}</span>
                    <span className="ix-bench__recipe-unit">g in</span>
                    <span className="ix-bench__recipe-sep">·</span>
                    <span className="ix-bench__recipe-num">{sweetSpot.volume}</span>
                    <span className="ix-bench__recipe-unit">ml out</span>
                    <span className="ix-bench__recipe-sep">·</span>
                    <span className="ix-bench__recipe-num">{sweetSpot.time}</span>
                    <span className="ix-bench__recipe-unit">s</span>
                  </div>
                  <div className="ix-bench__chips">
                    <span className="ix-bench__chip"><strong>{sweetSpot.grind}</strong> {t('insights.bestGrindLabel')}</span>
                    <span className="ix-bench__chip"><strong>1:{sweetSpot.ratio.toFixed(1)}</strong> {t('insights.ratioLabel')}</span>
                    {sweetSpot.bestBeanAge !== null && (
                      <span className="ix-bench__chip"><strong>{sweetSpot.bestBeanAge}d</strong> {t('insights.offRoastLabel')}</span>
                    )}
                    <span className="ix-bench__chip ix-bench__chip--muted">{t('insights.fromNShots', { n: sweetSpot.n })}</span>
                  </div>
                </>
              ) : (
                <p className="ix-bench__empty">{t('insights.noTopShots')}</p>
              )}
            </div>

            {/* 2x2 stat tiles */}
            <div className="ix-bench__grid">
              <div className="ix-bench__tile">
                <span className="ix-bench__tile-label">{t('insights.personalBest')}</span>
                <span className="ix-bench__tile-value ix-bench__tile-value--sage">
                  {personalBest ? personalBest.score : '–'}
                </span>
                <span className="ix-bench__tile-sub">
                  {personalBest ? formatShotDate(personalBest.timestamp) : t('insights.noShotsYet')}
                </span>
              </div>

              <div className="ix-bench__tile">
                <span className="ix-bench__tile-label">{t('insights.consistencyScore')}</span>
                <span className="ix-bench__tile-value ix-bench__tile-value--copper">{consistencyPct || '–'}</span>
                <div className="ix-bench__bar" aria-hidden="true">
                  <div className="ix-bench__bar-fill" style={{ width: `${consistencyPct}%` }} />
                </div>
                <span className="ix-bench__tile-sub">{consistency}</span>
              </div>

              <div className="ix-bench__tile">
                <span className="ix-bench__tile-label">{t('insights.thisWeek')}</span>
                <span className="ix-bench__tile-value ix-bench__tile-value--sage">{thisWeekShots.length}</span>
                <span className="ix-bench__tile-sub">
                  {thisWeekAvg !== null ? t('insights.avgScore', { score: thisWeekAvg }) : t('insights.noShotsYet')}
                </span>
              </div>

              <div className="ix-bench__tile">
                <span className="ix-bench__tile-label">{t('insights.timeWindow')}</span>
                <span className="ix-bench__tile-value ix-bench__tile-value--copper">{timeWindowLabel}</span>
                <span className="ix-bench__tile-sub">{timeMedianLabel || t('insights.noShotsYet')}</span>
              </div>
            </div>

            <div className="ix-bench__footnote">
              {t('insights.daysActive', { count: distinctDays })}
            </div>
          </div>
        )}
      </div>

      {/* Export history (premium — gated on native, open on web while testing) */}
      {!isFree && shots.length > 0 && (
        <button
          type="button"
          className="ix-export-btn"
          onClick={handleExportCsv}
        >
          {t('insights.exportCsv')}
        </button>
      )}

      {/* Free-tier history cap tease */}
      {isFree && hiddenByFreeCap > 0 && (
        <button
          type="button"
          className="ix-history-cap"
          onClick={() => setPremiumTrigger('history')}
        >
          <span className="ix-history-cap__text">
            {t('tierLock.historyMore')}
          </span>
          <span className="ix-history-cap__count">+{hiddenByFreeCap}</span>
        </button>
      )}

      {/* All shots — full scrollable list, each row tap-to-edit. Portaled so
          the sheet's fixed position is viewport-relative and covers BottomNav. */}
      {allShotsOpen && createPortal(
        <div className="ix-sheet-backdrop" role="dialog" aria-modal="true" onClick={() => setAllShotsOpen(false)}>
          <div className="ix-sheet ix-sheet--tall" onClick={(e) => e.stopPropagation()}>
            <div className="ix-sheet__header">
              <span className="ix-sheet__title">{t('insights.allShotsTitle', { count: allShotsSorted.length })}</span>
              <button className="ix-sheet__close" type="button" onClick={() => setAllShotsOpen(false)} aria-label={t('common.close')}>×</button>
            </div>
            <div className="ix-sheet__body ix-sheet__body--scroll">
              <div className="ix-shot-list">
                {allShotsSorted.map((shot, idx) => renderShotRow(shot, idx, allShotsSorted.length))}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Edit shot — taste + actuals, save -> UPDATE_SHOT */}
      {editingShot && (
        <ShotEditSheet
          shot={editingShot}
          t={t}
          onClose={() => setEditingShotId(null)}
          onSave={(updates) => {
            dispatch({ type: 'UPDATE_SHOT', payload: { id: editingShot.id, updates } })
            setEditingShotId(null)
          }}
          onDelete={() => {
            if (window.confirm(t('insights.confirmDeleteShot'))) {
              dispatch({ type: 'DELETE_SHOT', payload: editingShot.id })
              setEditingShotId(null)
            }
          }}
        />
      )}

      <PremiumModal
        open={premiumTrigger !== null}
        onClose={() => setPremiumTrigger(null)}
        trigger={premiumTrigger}
        isSignedIn={!!state.userId}
        onSignInRequired={onSignIn}
      />

      {/* Footer */}
      <div className="ix-footer">
        <a
          href="https://lazysous.app"
          target="_blank"
          rel="noopener noreferrer"
          className="ix-footer__pill"
        >
          <img
            src="./assets/lazysous-logo.png"
            alt="Lazy Sous"
            className="ix-footer__logo"
          />
          <div className="ix-footer__text">
            <span className="ix-footer__dinner">{t('insights.footerDinner')}</span>
            <span className="ix-footer__cta">{t('insights.footerCta')}</span>
          </div>
        </a>
        <p className="ix-footer__copy">{t('insights.footerCopy', { year: new Date().getFullYear() })}</p>
      </div>

      <style>{`
        /* ── Screen wrapper ─────────────────────────────────────────────── */
        .ix-screen {
          padding-bottom: 24px;
        }

        /* ── Page header ────────────────────────────────────────────────── */
        .ix-page-header {
          padding: 20px 16px 12px;
        }

        .ix-page-header__title {
          font-family: var(--font-brand);
          font-size: 22px;
          font-weight: 600;
          color: var(--text-primary);
          letter-spacing: 0;
          line-height: 1.2;
          margin-bottom: 6px;
        }

        /* Thin editorial rule below title */
        .ix-page-header__rule {
          width: 32px;
          height: 2px;
          background: var(--accent-green);
          border-radius: 1px;
          margin-bottom: 8px;
        }

        .ix-page-header__count {
          font-size: 13px;
          color: var(--text-tertiary);
          margin-top: 0;
        }

        /* ── Stats grid ─────────────────────────────────────────────────── */
        .ix-stats-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0;
          margin: 0 16px 14px;
          background: var(--white);
          border: 1px solid var(--border-light);
          border-radius: 16px;
          box-shadow: 0 1px 3px rgba(60, 40, 20, 0.06), 0 6px 18px rgba(60, 40, 20, 0.05);
          overflow: hidden;
        }

        .ix-stat-card {
          background: var(--white);
          border-radius: 0;
          box-shadow: none;
          padding: clamp(10px, 1.8vh, 18px) clamp(12px, 3vw, 18px) clamp(8px, 1.5vh, 16px);
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 4px;
          border-right: 1px solid var(--border-light);
          border-bottom: 1px solid var(--border-light);
        }
        .ix-stat-card:nth-child(2n) { border-right: none; }
        .ix-stat-card:nth-last-child(-n+2) { border-bottom: none; }

        .ix-stat-card__value {
          font-family: var(--font-brand);
          font-size: clamp(28px, 5vh, 44px);
          font-weight: 500;
          color: var(--text-primary);
          line-height: 0.95;
          letter-spacing: -1px;
          display: flex;
          align-items: center;
          min-height: clamp(28px, 4.4vh, 40px);
          font-variant-numeric: tabular-nums;
        }

        /* Skeleton placeholder bar */
        .ix-stat-skeleton {
          display: inline-block;
          width: 40px;
          height: 4px;
          background: var(--border);
          border-radius: 2px;
          margin-top: 14px;
        }

        .ix-stat-card__label {
          font-size: 10px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 1px;
          color: var(--text-tertiary);
          margin-top: 2px;
        }

        .ix-stat-card__sub {
          font-size: 11px;
          color: #9A9A9A;
          margin-top: 2px;
        }

        /* 100-shot club progress bar */
        .ix-shot-club-bar {
          width: 100%;
          height: 4px;
          background: #E8F0E4;
          border-radius: 9999px;
          margin-top: 8px;
          overflow: hidden;
        }

        .ix-shot-club-bar__fill {
          height: 100%;
          background: var(--accent-green);
          border-radius: 9999px;
          transition: width 0.4s ease;
          min-width: 4px;
        }

        /* ── Generic card ───────────────────────────────────────────────── */
        .ix-card {
          background: var(--white);
          border-radius: 16px;
          box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
          padding: clamp(10px, 1.8vh, 18px);
          margin: 0 16px clamp(8px, 1.4vh, 14px);
          overflow: hidden;
        }

        .ix-card__header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 12px;
        }

        .ix-card__title {
          font-size: 13px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.8px;
          color: var(--text-primary);
        }

        /* Ghost clear button */
        .ix-ghost-btn {
          font-family: var(--font-primary);
          font-size: 11px;
          font-weight: 600;
          color: var(--text-tertiary);
          background: transparent;
          border: none;
          cursor: pointer;
          padding: 4px 0;
          transition: color 0.15s ease;
        }

        .ix-ghost-btn:hover {
          color: var(--text-primary);
        }

        /* ── Empty state ────────────────────────────────────────────────── */
        .ix-empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: clamp(4px, 0.8vh, 10px);
          padding: clamp(12px, 2.4vh, 28px) 16px clamp(6px, 1.2vh, 14px);
          text-align: center;
        }

        .ix-empty-state__icon {
          width: clamp(36px, 6.5vh, 60px);
          height: clamp(36px, 6.5vh, 60px);
          opacity: 0.6;
          margin-bottom: 2px;
        }

        .ix-empty-state__heading {
          font-size: 15px;
          font-weight: 600;
          color: var(--text-primary);
        }

        .ix-empty-state__sub {
          font-size: 13px;
          color: var(--text-tertiary);
          max-width: 240px;
          line-height: 1.5;
        }

        /* ── Shot list ──────────────────────────────────────────────────── */
        .ix-shot-list {
          display: flex;
          flex-direction: column;
          margin-top: 8px;
        }

        /* Two-row layout so params have the full card width and never need
           ellipsis. Row 1: score + date (left) and outcome badge (right).
           Row 2: full params, wrap permitted. Whole row is a button so the
           user can tap to open the edit sheet. */
        .ix-shot-row {
          width: 100%;
          background: none;
          border: none;
          font: inherit;
          color: inherit;
          text-align: left;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
          display: grid;
          grid-template-columns: auto 1fr auto;
          column-gap: 10px;
          row-gap: 4px;
          align-items: center;
          padding: clamp(10px, 1.6vh, 16px) 16px;
          border-radius: 0;
          transition: background 0.15s ease;
        }

        .ix-score-pill {
          flex-shrink: 0;
          min-width: 40px;
          text-align: center;
          border-radius: 9999px;
          padding: 5px 8px;
          font-size: 13px;
          font-weight: 800;
          line-height: 1;
          grid-row: 1;
        }

        .ix-shot-row__center {
          min-width: 0;
          display: contents;
        }

        .ix-shot-row__bean {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          grid-row: 1;
          grid-column: 2;
        }

        .ix-shot-row__params {
          font-family: 'SF Mono', 'Fira Code', 'Courier New', monospace;
          font-size: 11.5px;
          color: var(--text-secondary);
          grid-row: 2;
          grid-column: 1 / -1;
          /* Wrap if ever needed, but the full card width usually fits. */
          white-space: normal;
          word-break: keep-all;
          line-height: 1.4;
        }

        .ix-adj-badge {
          flex-shrink: 0;
          font-size: 11px;
          font-weight: 600;
          padding: 3px 8px;
          border-radius: 9999px;
          white-space: nowrap;
          grid-row: 1;
          grid-column: 3;
        }

        /* "View all" pill below the recent-3 list */
        .ix-view-all-btn {
          display: block;
          width: calc(100% - 32px);
          margin: 10px 16px 4px;
          padding: 10px 16px;
          background: transparent;
          border: 1px dashed rgba(184, 116, 74, 0.42);
          color: var(--copper-deep);
          border-radius: 9999px;
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.2px;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
          transition: background 0.15s, border-color 0.15s, color 0.15s;
        }
        .ix-view-all-btn:hover {
          background: rgba(184, 116, 74, 0.06);
          border-color: var(--copper);
        }
        .ix-view-all-btn:active { transform: scale(0.98); }

        /* ── Bottom sheet (All shots + Edit shot) ───────────────────────── */
        .ix-sheet-backdrop {
          position: fixed;
          inset: 0;
          z-index: 110;
          background: rgba(0, 0, 0, 0.5);
          backdrop-filter: blur(4px);
          -webkit-backdrop-filter: blur(4px);
          display: flex;
          align-items: flex-end;
          justify-content: center;
          animation: ix-sheet-fade 0.2s ease-out both;
        }
        @keyframes ix-sheet-fade {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .ix-sheet {
          width: 100%;
          max-width: var(--app-max-width);
          background: var(--white);
          border-radius: 20px 20px 0 0;
          padding: 16px 16px calc(24px + var(--safe-bottom));
          box-shadow: 0 -8px 30px rgba(0, 0, 0, 0.18);
          animation: ix-sheet-up 0.28s cubic-bezier(0.32, 0.72, 0, 1) both;
          max-height: 85vh;
          display: flex;
          flex-direction: column;
        }
        .ix-sheet--tall { max-height: 90vh; }
        @keyframes ix-sheet-up {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        .ix-sheet__header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding-bottom: 14px;
          border-bottom: 1px solid var(--border-light);
        }
        .ix-sheet__title {
          font-family: var(--font-brand);
          font-size: 22px;
          font-weight: 600;
          color: var(--text-primary);
          letter-spacing: -0.3px;
        }
        .ix-sheet__close {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: var(--off-white);
          border: 1px solid var(--border);
          font-size: 18px;
          color: var(--text-secondary);
          cursor: pointer;
          line-height: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          -webkit-tap-highlight-color: transparent;
        }
        .ix-sheet__close:hover { background: var(--border); }
        .ix-sheet__body {
          padding-top: 14px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .ix-sheet__body--scroll {
          overflow-y: auto;
          padding-top: 0;
          gap: 0;
        }

        /* ── Edit shot form ─────────────────────────────────────────────── */
        .ix-edit-row {
          display: grid;
          grid-template-columns: 1fr auto 20px;
          column-gap: 10px;
          align-items: center;
          padding: 10px 0;
          border-bottom: 1px solid var(--border-light);
        }
        .ix-edit-row__label {
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.8px;
          text-transform: uppercase;
          color: var(--text-tertiary);
        }
        .ix-edit-row__input {
          width: 80px;
          font-size: 22px;
          font-weight: 800;
          font-variant-numeric: tabular-nums;
          text-align: right;
          background: transparent;
          border: none;
          padding: 0;
          color: var(--text-primary);
          outline: none;
        }
        .ix-edit-row__input:focus { color: var(--accent-green); }
        .ix-edit-row__unit {
          font-size: 12px;
          color: var(--text-tertiary);
          font-weight: 500;
        }
        .ix-edit-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .ix-edit-group__label {
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.8px;
          text-transform: uppercase;
          color: var(--text-tertiary);
        }
        .ix-edit-pills {
          display: flex;
          gap: 6px;
        }
        .ix-edit-pill {
          flex: 1;
          padding: 9px 4px;
          font-size: 13px;
          font-weight: 600;
          background: var(--off-white);
          border: 1.5px solid var(--border);
          color: var(--text-secondary);
          border-radius: 10px;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
          transition: background 0.15s, border-color 0.15s, color 0.15s;
        }
        .ix-edit-pill--on {
          background: rgba(107, 142, 92, 0.08);
          border-color: var(--accent-green);
          color: var(--accent-green);
        }
        .ix-edit-actions {
          display: flex;
          gap: 10px;
          margin-top: 6px;
        }
        .ix-edit-delete {
          flex: 0 0 auto;
          padding: 12px 18px;
          background: transparent;
          color: #8B1A1A;
          border: 1.5px solid rgba(139, 26, 26, 0.32);
          border-radius: 9999px;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
        }
        .ix-edit-save {
          flex: 1;
          padding: 12px 18px;
          background: var(--accent-green);
          color: #fff;
          border: none;
          border-radius: 9999px;
          font-size: 14px;
          font-weight: 800;
          letter-spacing: 0.6px;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
        }
        .ix-edit-save:hover { background: #5C7E4D; }
        .ix-edit-save:active { transform: scale(0.985); }

        /* ── Footer (Lazy Sous cross-link + copyright) ──────────────────── */
        .ix-footer {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
          padding: 16px 16px 8px;
        }
        .ix-footer__pill {
          display: inline-flex;
          align-items: center;
          gap: 12px;
          background: var(--white);
          border: 1px solid var(--border-light);
          border-radius: 20px;
          padding: 10px 18px 10px 12px;
          text-decoration: none;
          transition: transform 0.15s ease, background 0.15s ease;
          -webkit-tap-highlight-color: transparent;
        }
        .ix-footer__pill:hover { transform: translateY(-1px); background: var(--cream); }
        .ix-footer__logo { height: 28px; width: 28px; flex-shrink: 0; border-radius: 8px; }
        .ix-footer__text { display: flex; flex-direction: column; gap: 1px; }
        .ix-footer__dinner { font-size: 11px; font-weight: 600; color: var(--text-tertiary); letter-spacing: 0.2px; line-height: 1.2; }
        .ix-footer__cta { font-size: 13px; font-weight: 700; color: var(--accent-green); line-height: 1.2; }
        .ix-footer__copy { font-size: 11px; color: var(--text-tertiary); }

        /* ── Benchmarks locked state ────────────────────────────────────── */
        .ix-locked {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
          padding: 12px 0 8px;
          text-align: center;
        }

        .ix-locked__icon {
          width: 40px;
          height: 40px;
          opacity: 0.7;
        }

        .ix-locked__heading {
          font-size: 15px;
          font-weight: 700;
          color: var(--text-primary);
        }

        .ix-locked__progress-wrap {
          width: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
        }

        .ix-locked__progress-bar {
          width: 100%;
          height: 6px;
          background: #E8F0E4;
          border-radius: 9999px;
          overflow: hidden;
          position: relative;
        }

        .ix-locked__progress-fill {
          height: 100%;
          background: var(--accent-green);
          border-radius: 9999px;
          transition: width 0.4s ease;
          min-width: 0;
          position: relative;
          z-index: 1;
        }

        /* Shimmer on the unfilled portion of the progress bar */
        @keyframes ix-shimmer {
          0%   { background-position: -200px 0; }
          100% { background-position:  200px 0; }
        }

        .ix-progress-shimmer {
          position: absolute;
          top: 0;
          right: 0;
          bottom: 0;
          background: linear-gradient(
            90deg,
            var(--accent-green) 0%,
            rgba(107, 142, 92, 0.3) 50%,
            var(--accent-green) 100%
          );
          background-size: 400px 100%;
          animation: ix-shimmer 2s infinite linear;
          border-radius: 9999px;
        }

        .ix-locked__progress-label {
          font-size: 12px;
          color: var(--text-tertiary);
        }

        /* ── Personal Benchmarks: editorial, brand-tinted, data-rich ────── */
        .ix-bench {
          display: flex;
          flex-direction: column;
          gap: 14px;
          padding-top: 8px;
        }

        /* Hero tile — the sweet-spot recipe */
        .ix-bench__hero {
          padding: 16px 18px;
          border-radius: 14px;
          background:
            radial-gradient(120% 80% at 0% 0%, rgba(184, 116, 74, 0.07) 0%, transparent 60%),
            linear-gradient(180deg, #FBF8F1 0%, var(--cream) 100%);
          border: 1px solid rgba(184, 116, 74, 0.18);
        }
        .ix-bench__eyebrow {
          display: block;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 1.8px;
          text-transform: uppercase;
          color: var(--copper-deep);
          margin-bottom: 10px;
        }
        .ix-bench__recipe {
          display: flex;
          align-items: baseline;
          flex-wrap: wrap;
          gap: 6px;
          font-family: var(--font-brand);
          line-height: 1;
          margin-bottom: 12px;
        }
        .ix-bench__recipe-num {
          font-size: clamp(26px, 5.5vh, 36px);
          font-weight: 600;
          color: var(--text-primary);
          font-variant-numeric: tabular-nums;
          letter-spacing: -0.8px;
        }
        .ix-bench__recipe-unit {
          font-size: 13px;
          font-style: italic;
          color: var(--text-tertiary);
          font-weight: 500;
        }
        .ix-bench__recipe-sep {
          font-size: 18px;
          color: rgba(184, 116, 74, 0.55);
          padding: 0 2px;
        }
        .ix-bench__chips {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .ix-bench__chip {
          font-size: 11.5px;
          padding: 5px 10px;
          background: rgba(255, 255, 255, 0.7);
          border: 1px solid rgba(184, 116, 74, 0.22);
          color: var(--text-secondary);
          border-radius: 9999px;
          letter-spacing: 0.1px;
        }
        .ix-bench__chip strong {
          color: var(--copper-deep);
          font-weight: 800;
          font-variant-numeric: tabular-nums;
        }
        .ix-bench__chip--muted {
          background: transparent;
          border-color: var(--border-light);
          color: var(--text-tertiary);
        }
        .ix-bench__empty {
          font-size: 13px;
          color: var(--text-tertiary);
          font-style: italic;
        }

        /* 2x2 tile grid */
        .ix-bench__grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }
        .ix-bench__tile {
          padding: 12px 14px;
          border-radius: 12px;
          background: var(--white);
          border: 1px solid var(--border-light);
          display: flex;
          flex-direction: column;
          gap: 4px;
          min-height: 92px;
        }
        .ix-bench__tile-label {
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 1.4px;
          text-transform: uppercase;
          color: var(--text-tertiary);
        }
        .ix-bench__tile-value {
          font-family: var(--font-brand);
          font-size: clamp(26px, 5vh, 34px);
          font-weight: 600;
          line-height: 1;
          letter-spacing: -1px;
          font-variant-numeric: tabular-nums;
        }
        .ix-bench__tile-value--sage { color: var(--accent-green); }
        .ix-bench__tile-value--copper { color: var(--copper-deep); }
        .ix-bench__tile-sub {
          font-size: 11.5px;
          color: var(--text-tertiary);
          line-height: 1.3;
        }
        .ix-bench__bar {
          width: 100%;
          height: 4px;
          background: var(--border-light);
          border-radius: 9999px;
          overflow: hidden;
          margin-top: 2px;
        }
        .ix-bench__bar-fill {
          height: 100%;
          background: linear-gradient(90deg, var(--copper) 0%, var(--copper-deep) 100%);
          border-radius: 9999px;
          transition: width 0.4s ease;
        }
        .ix-bench__footnote {
          font-size: 11px;
          color: var(--text-tertiary);
          text-align: center;
          letter-spacing: 0.3px;
          margin-top: 2px;
        }

        /* ── Data & Backup card ─────────────────────────────────────────── */
        .ix-data-btns {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
          margin-bottom: 8px;
          margin-top: 8px;
        }

        .ix-data-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          font-family: var(--font-primary);
          font-size: 14px;
          font-weight: 600;
          color: var(--text-primary);
          background: var(--white);
          border: 1.5px solid var(--border);
          border-radius: 12px;
          padding: 12px 16px;
          cursor: pointer;
          transition: background 0.15s ease, border-color 0.15s ease;
          -webkit-tap-highlight-color: transparent;
        }

        .ix-data-btn:hover {
          background: var(--off-white);
          border-color: var(--accent-green);
        }

        .ix-data-btn__icon {
          width: 18px;
          height: 18px;
          flex-shrink: 0;
        }

        /* Export CSV — quiet copper outline pill */
        .ix-export-btn {
          display: block;
          width: calc(100% - 32px);
          margin: 6px 16px;
          padding: 10px 16px;
          background: transparent;
          border: 1px dashed rgba(184, 116, 74, 0.42);
          color: var(--copper-deep);
          border-radius: 9999px;
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.2px;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
          transition: background 0.15s, border-color 0.15s;
        }
        .ix-export-btn:hover {
          background: rgba(184, 116, 74, 0.06);
          border-color: var(--copper);
        }
        .ix-export-btn:active { transform: scale(0.985); }

        .ix-reset-btn {
          width: 100%;
          font-family: var(--font-primary);
          font-size: 14px;
          font-weight: 600;
          color: #8B1A1A;
          background: transparent;
          border: 1.5px solid rgba(139, 26, 26, 0.3);
          border-radius: 12px;
          padding: 12px 16px;
          cursor: pointer;
          transition: background 0.15s ease, border-color 0.15s ease;
          -webkit-tap-highlight-color: transparent;
          margin-bottom: 10px;
        }

        .ix-reset-btn:hover {
          background: #FFF5F5;
          border-color: rgba(139, 26, 26, 0.55);
        }

        .ix-account-delete-note {
          margin-top: 8px;
          font-size: 12px;
          color: var(--text-tertiary);
          text-align: center;
          line-height: 1.5;
        }

        .ix-data-note {
          font-size: 11px;
          font-style: italic;
          color: var(--text-tertiary);
          text-align: center;
          line-height: 1.5;
        }

        /* Free-tier history cap tease */
        .ix-history-cap {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          width: 100%;
          margin: 4px 0 8px;
          padding: 12px 16px;
          background: rgba(184, 116, 74, 0.06);
          border: 1px dashed rgba(184, 116, 74, 0.32);
          border-radius: 12px;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
          text-align: left;
        }
        .ix-history-cap:active { transform: scale(0.995); }
        .ix-history-cap__text {
          font-size: 12px;
          font-weight: 600;
          color: var(--copper-deep);
          letter-spacing: 0.1px;
          line-height: 1.4;
        }
        .ix-history-cap__count {
          font-size: 13px;
          font-weight: 800;
          color: var(--copper-deep);
          background: rgba(184, 116, 74, 0.14);
          padding: 3px 9px;
          border-radius: 9999px;
          font-variant-numeric: tabular-nums;
          flex-shrink: 0;
        }

      `}</style>
    </div>
  )
}
