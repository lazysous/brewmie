import React, { useRef } from 'react'
import type { BrewmieState, AppAction, ShotEntry } from '../types'

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

function bestGrindRange(shots: ShotEntry[]): [number, number] | null {
  const highScoring = shots.filter((s) => s.score !== null && s.score >= 85)
  if (highScoring.length === 0) return null
  const settings = highScoring.map((s) => s.inputGrind)
  return [Math.min(...settings), Math.max(...settings)]
}

function stdDev(values: number[]): number {
  if (values.length === 0) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

function consistencyLabel(shots: ShotEntry[]): string {
  const rated = shots.filter((s): s is ShotEntry & { score: number } => s.score !== null)
  if (rated.length < 2) return 'Not enough data'
  const sd = stdDev(rated.map((s) => s.score))
  if (sd <= 3) return 'High'
  if (sd <= 6) return 'Medium'
  return 'Low'
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
  if (score >= 85) return { background: '#2D5016', color: '#FFFFFF' }
  if (score >= 70) return { background: '#9A9A9A', color: '#FFFFFF' }
  return { background: '#8B1A1A', color: '#FFFFFF' }
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function adjustmentLabel(shot: ShotEntry): { text: string; positive: boolean; neutral: boolean } {
  if (shot.grindAdjust === null || shot.grindAdjust === undefined) {
    return { text: '✓ On target', positive: false, neutral: true }
  }
  if (shot.grindAdjust < 0) return { text: '↓ Grind', positive: false, neutral: false }
  if (shot.grindAdjust > 0) return { text: '↑ Grind', positive: true, neutral: false }
  return { text: '✓ On target', positive: false, neutral: true }
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
}

export function InsightsScreen({ state, dispatch }: InsightsScreenProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const shots = state.shots
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

  const days = dialInDays(shots)

  // ── Benchmarks ────────────────────────────────────────────────────────────

  const benchmarksUnlocked = shotCount >= 10
  const shotsToGo = Math.max(0, 10 - shotCount)

  const grindRange = bestGrindRange(shots)
  const grindRangeLabel =
    grindRange === null
      ? '--'
      : grindRange[0] === grindRange[1]
      ? String(grindRange[0])
      : `${grindRange[0]} – ${grindRange[1]}`

  const topShots = shots.filter((s) => s.score !== null && s.score >= 85)
  let sweetSpotLabel = '--'
  if (topShots.length > 0) {
    const ratios = topShots
      .filter((s) => s.actualVolume !== null && s.inputDose > 0)
      .map((s) => (s.actualVolume as number) / s.inputDose)
    if (ratios.length > 0) {
      const avgRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length
      sweetSpotLabel = `1:${avgRatio.toFixed(1)}`
    }
  }

  let timeWindowLabel = '--'
  if (topShots.length > 0) {
    const times = topShots
      .filter((s) => s.actualTime !== null)
      .map((s) => s.actualTime as number)
    if (times.length > 0) {
      const tMin = Math.round(Math.min(...times))
      const tMax = Math.round(Math.max(...times))
      timeWindowLabel = tMin === tMax ? `${tMin}s` : `${tMin} – ${tMax}s`
    }
  }

  const consistency = consistencyLabel(shots)

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleClearShots() {
    if (!window.confirm('Clear all shot history? This cannot be undone.')) return
    for (const shot of shots) {
      dispatch({ type: 'DELETE_SHOT', payload: shot.id })
    }
  }

  function handleExport() {
    const data = {
      shots: state.shots,
      machine: state.machine,
      grinder: state.grinder,
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `brewmie-insights-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string) as BrewmieState
        dispatch({ type: 'HYDRATE', payload: parsed })
      } catch {
        alert('Invalid file. Please select a valid Brewmie export.')
      }
    }
    reader.readAsText(file)
    // Reset so the same file can be re-imported
    e.target.value = ''
  }

  function handleReset() {
    if (
      !window.confirm(
        'Reset ALL data including machine config, grinder config, and shot history? This cannot be undone.'
      )
    )
      return
    dispatch({ type: 'RESET' })
  }

  // ── Recent shots (last 20, newest first) ──────────────────────────────────

  const recentShots = [...shots]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 20)

  // ── 100-shot club progress ─────────────────────────────────────────────────

  const shotClubPct = Math.min(100, (shotCount / 100) * 100)

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="ix-screen">

      {/* Page header */}
      <div className="ix-page-header">
        <h1 className="ix-page-header__title">Your Coffee Journey</h1>
        {/* Decorative editorial rule */}
        <div className="ix-page-header__rule" aria-hidden="true" />
        <p className="ix-page-header__count">
          {shotCount === 0
            ? '0 shots tracked'
            : days !== null
            ? `${shotCount} shot${shotCount !== 1 ? 's' : ''} tracked · ${days} day${days !== 1 ? 's' : ''} of dialling in`
            : `${shotCount} shot${shotCount !== 1 ? 's' : ''} tracked`}
        </p>
      </div>

      {/* Stats Grid */}
      <div className="ix-stats-grid">

        {/* First Shot Avg */}
        <div className="ix-stat-card">
          <span className="ix-stat-card__value">
            {firstShotAvg !== null ? firstShotAvg.toFixed(1) : <StatSkeleton />}
          </span>
          <span className="ix-stat-card__label">First Shot Avg</span>
        </div>

        {/* Follow-up Avg */}
        <div className="ix-stat-card">
          <span className="ix-stat-card__value">
            {followUpAvg !== null ? followUpAvg.toFixed(1) : <StatSkeleton />}
          </span>
          <span className="ix-stat-card__label">Follow-up Avg</span>
        </div>

        {/* Optimal Grind */}
        <div className="ix-stat-card">
          <span className="ix-stat-card__value">
            {optGrind !== null ? optGrind : <StatSkeleton />}
          </span>
          <span className="ix-stat-card__label">Optimal Grind</span>
          <span className="ix-stat-card__sub">from your best shots</span>
        </div>

        {/* Total Shots + 100-shot club */}
        <div className="ix-stat-card">
          <span className="ix-stat-card__value">{shotCount}</span>
          <span className="ix-stat-card__label">Total Shots</span>
          {shotCount > 0 && (
            <div className="ix-shot-club-bar" title={`${shotCount}/100 shot club`}>
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
          <span className="ix-card__title">Recent Performance</span>
          {shotCount > 0 && (
            <button className="ix-ghost-btn" onClick={handleClearShots}>
              Clear
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
            <p className="ix-empty-state__heading">No shots logged yet</p>
            <p className="ix-empty-state__sub">Pull your first shot and log it on the Brew tab</p>
          </div>
        ) : (
          <div className="ix-shot-list">
            {recentShots.map((shot, idx) => {
              const adj = adjustmentLabel(shot)
              const beanLabel = state.beans?.brand ?? formatDate(shot.timestamp)
              const params = [
                `${shot.inputDose}g`,
                `${shot.actualVolume ?? shot.targetVolume}g`,
                `${shot.actualTime ?? shot.targetTime}s`,
                `grind ${shot.inputGrind}`,
              ].join(' · ')
              const isExcellent = shot.score !== null && shot.score >= 85
              const isEvenRow = idx % 2 === 1
              return (
                <div
                  key={shot.id}
                  className="ix-shot-row"
                  style={{
                    borderBottom: idx < recentShots.length - 1 ? '1px solid var(--border-light)' : 'none',
                    background: isExcellent
                      ? 'rgba(45, 80, 22, 0.02)'
                      : isEvenRow
                      ? 'var(--cream)'
                      : undefined,
                    marginLeft: '-16px',
                    marginRight: '-16px',
                    paddingLeft: '16px',
                    paddingRight: '16px',
                  }}
                >
                  {/* Score pill */}
                  <span className="ix-score-pill" style={scorePillStyle(shot.score)}>
                    {shot.score !== null ? shot.score : '–'}
                  </span>

                  {/* Center: bean/date + params */}
                  <div className="ix-shot-row__center">
                    <span className="ix-shot-row__bean">{beanLabel}</span>
                    <span className="ix-shot-row__params">{params}</span>
                  </div>

                  {/* Adjustment badge */}
                  <span
                    className="ix-adj-badge"
                    style={{
                      color: adj.neutral
                        ? '#6A9A6A'
                        : adj.positive
                        ? '#2D5016'
                        : '#8B1A1A',
                      background: adj.neutral
                        ? 'rgba(45,80,22,0.07)'
                        : adj.positive
                        ? 'rgba(45,80,22,0.1)'
                        : 'rgba(139,26,26,0.08)',
                    }}
                  >
                    {adj.text}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Personal Benchmarks */}
      <div className="ix-card">
        <div className="ix-card__header">
          <span className="ix-card__title">Personal Benchmarks</span>
        </div>

        {!benchmarksUnlocked ? (
          <div className="ix-locked">
            {/* Padlock SVG */}
            <svg className="ix-locked__icon" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="6" y="14" width="20" height="14" rx="3" stroke="#9A9A9A" strokeWidth="2" fill="none"/>
              <path d="M10 14v-4a6 6 0 0 1 12 0v4" stroke="#9A9A9A" strokeWidth="2" strokeLinecap="round" fill="none"/>
              <circle cx="16" cy="21" r="2" fill="#9A9A9A"/>
            </svg>
            <p className="ix-locked__heading">Unlock at 10 shots</p>
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
              <span className="ix-locked__progress-label">{shotsToGo} to go</span>
            </div>
          </div>
        ) : (
          <div className="ix-benchmark-list">
            {(
              [
                { label: 'Best Grind Range', value: grindRangeLabel },
                { label: 'Sweet Spot Ratio', value: sweetSpotLabel },
                { label: 'Optimal Time Window', value: timeWindowLabel },
                { label: 'Consistency Score', value: consistency },
              ] as { label: string; value: string }[]
            ).map(({ label, value }) => (
              <div key={label} className="ix-benchmark-row">
                <span className="ix-benchmark-row__label">{label}</span>
                <span className="ix-benchmark-row__dots" aria-hidden="true" />
                <span className="ix-benchmark-row__value">{value}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Data & Backup */}
      <div className="ix-card">
        <div className="ix-card__header">
          <span className="ix-card__title">Data &amp; Backup</span>
        </div>

        <div className="ix-data-btns">
          <button className="ix-data-btn" onClick={handleExport}>
            <svg className="ix-data-btn__icon" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M10 3v10M6 9l4 4 4-4" stroke="#2D5016" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M3 15h14" stroke="#2D5016" strokeWidth="1.75" strokeLinecap="round"/>
            </svg>
            Export
          </button>
          <button
            className="ix-data-btn"
            onClick={() => fileInputRef.current?.click()}
          >
            <svg className="ix-data-btn__icon" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M10 13V3M6 7l4-4 4 4" stroke="#2D5016" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M3 15h14" stroke="#2D5016" strokeWidth="1.75" strokeLinecap="round"/>
            </svg>
            Import
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          className="visually-hidden"
          onChange={handleImport}
        />

        <button className="ix-reset-btn" onClick={handleReset}>
          Reset All Data
        </button>

        <p className="ix-data-note">
          Your dial-in history lives here. Export it or sign in to keep it safe across devices.
        </p>
      </div>

      {/* Footer */}
      <div className="ix-footer">
        <a
          href="https://lazysous.app"
          target="_blank"
          rel="noopener noreferrer"
          className="ix-footer__pill"
        >
          <img
            src="https://raw.githubusercontent.com/lazysous/logo/main/logo-transparent-white.png"
            alt="Lazy Sous"
            className="ix-footer__logo"
          />
          <div className="ix-footer__text">
            <span className="ix-footer__dinner">What's for dinner?</span>
            <span className="ix-footer__cta">Visit Lazy Sous &rarr;</span>
          </div>
        </a>
        <p className="ix-footer__copy">&copy; {new Date().getFullYear()} Brewmie</p>
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
          width: 40px;
          height: 2px;
          background: var(--gold-dark);
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
          gap: 8px;
          padding: 8px 16px 10px;
        }

        .ix-stat-card {
          background: var(--white);
          border-radius: 16px;
          box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
          padding: 16px;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 2px;
        }

        .ix-stat-card__value {
          font-size: 32px;
          font-weight: 800;
          color: var(--text-primary);
          line-height: 1;
          display: flex;
          align-items: center;
          min-height: 32px;
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
          padding: 16px;
          margin: 0 16px 10px;
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
          gap: 8px;
          padding: 24px 16px 12px;
          text-align: center;
        }

        .ix-empty-state__icon {
          width: 56px;
          height: 56px;
          opacity: 0.6;
          margin-bottom: 4px;
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

        .ix-shot-row {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 16px;
          min-height: 56px;
          border-radius: 0;
          transition: background 0.15s ease;
        }

        .ix-score-pill {
          flex-shrink: 0;
          min-width: 44px;
          text-align: center;
          border-radius: 9999px;
          padding: 5px 8px;
          font-size: 13px;
          font-weight: 800;
          line-height: 1;
        }

        .ix-shot-row__center {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .ix-shot-row__bean {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .ix-shot-row__params {
          font-family: 'SF Mono', 'Fira Code', 'Courier New', monospace;
          font-size: 12px;
          color: var(--text-secondary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .ix-adj-badge {
          flex-shrink: 0;
          font-size: 11px;
          font-weight: 600;
          padding: 3px 8px;
          border-radius: 9999px;
          white-space: nowrap;
        }

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
            rgba(45, 80, 22, 0.3) 50%,
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

        /* ── Benchmark rows (dotted connector) ──────────────────────────── */
        .ix-benchmark-list {
          display: flex;
          flex-direction: column;
          gap: 0;
          margin-top: 8px;
        }

        .ix-benchmark-row {
          display: flex;
          align-items: baseline;
          gap: 4px;
          padding: 11px 0;
          border-bottom: 1px solid var(--border-light);
        }

        .ix-benchmark-row:last-child {
          border-bottom: none;
        }

        .ix-benchmark-row__label {
          font-size: 13px;
          color: var(--text-secondary);
          flex-shrink: 0;
        }

        .ix-benchmark-row__dots {
          flex: 1;
          border-bottom: 1.5px dotted #D0D0D0;
          margin-bottom: 3px;
          min-width: 16px;
        }

        .ix-benchmark-row__value {
          font-size: 14px;
          font-weight: 700;
          color: var(--text-primary);
          flex-shrink: 0;
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

        .ix-data-note {
          font-size: 11px;
          font-style: italic;
          color: var(--text-tertiary);
          text-align: center;
          line-height: 1.5;
        }

        /* ── Footer ─────────────────────────────────────────────────────── */
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
          gap: 10px;
          background: var(--black);
          border-radius: 20px;
          padding: 10px 20px;
          text-decoration: none;
          transition: transform 0.15s ease, box-shadow 0.15s ease;
          -webkit-tap-highlight-color: transparent;
        }

        .ix-footer__pill:hover {
          transform: translateY(-1px);
          box-shadow: var(--shadow-md);
        }

        .ix-footer__logo {
          height: 22px;
          width: auto;
          flex-shrink: 0;
        }

        .ix-footer__text {
          display: flex;
          flex-direction: column;
          gap: 1px;
        }

        .ix-footer__dinner {
          font-size: 12px;
          font-weight: 400;
          color: rgba(255,255,255,0.75);
          line-height: 1.2;
        }

        .ix-footer__cta {
          font-size: 13px;
          font-weight: 700;
          color: var(--gold);
          line-height: 1.2;
        }

        .ix-footer__copy {
          font-size: 11px;
          color: var(--text-tertiary);
        }
      `}</style>
    </div>
  )
}
