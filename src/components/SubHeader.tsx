import type { AppTab, BrewmieState } from '../types'

interface SubHeaderProps {
  activeTab: AppTab
  state: BrewmieState
  weather?: { temp: number; humidity: number } | null
}

function getBrewMainLine(state: BrewmieState): string {
  const hour = new Date().getHours()
  const shots = state.shots
  const lastScore = shots[0]?.score ?? null

  if (shots.length === 0) {
    if (hour < 12) return 'Morning. Let\'s dial in.'
    if (hour < 17) return 'Time for a shot.'
    return 'Evening shot time.'
  }

  if (lastScore !== null) {
    if (lastScore >= 90) return `Last shot scored ${lastScore}. Nailed it.`
    if (lastScore >= 80) return `Last shot: ${lastScore}. Getting there.`
    if (lastScore >= 70) return `Last shot: ${lastScore}. Room to improve.`
    return `Last shot: ${lastScore}. Let's fix that.`
  }

  return `Shot ${shots.length + 1} incoming.`
}

function getBrewSubLine(state: BrewmieState, weather?: { temp: number; humidity: number } | null): string | null {
  const parts: string[] = []

  if (state.beans?.brand) {
    const roastDate = state.beans.roastDate
    if (roastDate) {
      const days = Math.floor((Date.now() - new Date(roastDate).getTime()) / 86400000)
      if (days >= 0) {
        if (days <= 5) parts.push(`${state.beans.brand} · Day ${days} — still resting`)
        else if (days <= 21) parts.push(`${state.beans.brand} · Day ${days}`)
        else if (days <= 30) parts.push(`${state.beans.brand} · Day ${days} — use soon`)
        else parts.push(`${state.beans.brand} · Day ${days} — getting stale`)
      } else {
        parts.push(state.beans.brand)
      }
    } else {
      parts.push(state.beans.brand)
    }
  }

  if (weather) {
    const humidityNote = weather.humidity > 70 ? ' · humid, grind coarser' : weather.humidity < 40 ? ' · dry, grind finer' : ''
    parts.push(`${weather.temp}°C · ${weather.humidity}% RH${humidityNote}`)
  }

  return parts.length > 0 ? parts.join(' — ') : null
}

function countIncompleteSections(state: BrewmieState): number {
  let incomplete = 0
  if (!state.machine?.brand) incomplete++
  if (!state.grinder?.brand) incomplete++
  if (!state.tamp) incomplete++
  if (!state.beans?.brand) incomplete++
  return incomplete
}

export function SubHeader({ activeTab, state, weather }: SubHeaderProps) {
  let mainLine: string
  let subLine: string | null = null
  let subLineColor: 'default' | 'green' | 'gold' | 'amber' = 'default'

  if (activeTab === 'brew') {
    mainLine = getBrewMainLine(state)
    subLine = getBrewSubLine(state, weather)
    if (subLine?.includes('stale') || subLine?.includes('use soon')) subLineColor = 'amber'
  } else if (activeTab === 'setup') {
    mainLine = 'Your equipment profile'
    const incomplete = countIncompleteSections(state)
    if (incomplete === 0) {
      subLine = 'Ready to dial in.'
      subLineColor = 'green'
    } else {
      subLine = `Incomplete — ${incomplete} section${incomplete !== 1 ? 's' : ''} left`
      subLineColor = 'gold'
    }
  } else {
    const total = state.shots.length
    if (total === 0) {
      mainLine = 'Pull your first shot.'
    } else if (total < 5) {
      mainLine = `${total} shot${total !== 1 ? 's' : ''} logged. Keep going.`
    } else {
      const avg = Math.round(state.shots.slice(0, 5).reduce((s, sh) => s + (sh.score ?? 0), 0) / 5)
      mainLine = `${total} shots tracked.`
      subLine = `5-shot average: ${avg}`
    }
  }

  return (
    <div className="subheader">
      <span className="subheader__main">{mainLine}</span>
      {subLine && (
        <span
          className={`subheader__sub${subLineColor !== 'default' ? ` subheader__sub--${subLineColor}` : ''}`}
        >
          {subLine}
        </span>
      )}

      <style>{`
        .subheader {
          display: flex;
          flex-direction: column;
          padding: 7px 20px 8px;
          background: var(--off-white);
          border-bottom: 1px solid var(--border-light);
          flex-shrink: 0;
          user-select: none;
        }

        .subheader__main {
          font-family: var(--font-primary);
          font-size: 14px;
          font-weight: 600;
          color: var(--text-primary);
          line-height: 1.3;
        }

        .subheader__sub {
          font-family: var(--font-primary);
          font-size: 11px;
          font-weight: 400;
          color: var(--text-tertiary);
          margin-top: 2px;
          line-height: 1.3;
        }

        .subheader__sub--green {
          color: var(--accent-green);
        }

        .subheader__sub--gold {
          color: var(--gold-dark);
        }

        .subheader__sub--amber {
          color: #D97706;
        }
      `}</style>
    </div>
  )
}
