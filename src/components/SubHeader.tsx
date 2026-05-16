import type { AppTab, BrewmieState } from '../types'
import { useTranslation } from '../hooks/useTranslation'
import type { TParams } from '../lib/i18n'

interface SubHeaderProps {
  activeTab: AppTab
  state: BrewmieState
  weather?: { temp: number; humidity: number } | null
}

type T = (key: string, params?: TParams) => string

function getBrewMainLine(state: BrewmieState, t: T): string {
  const hour = new Date().getHours()
  const shots = state.shots
  const lastScore = shots[0]?.score ?? null

  if (shots.length === 0) {
    if (hour < 12) return t('subheader.morning')
    if (hour < 17) return t('subheader.afternoon')
    return t('subheader.evening')
  }

  if (lastScore !== null) {
    if (lastScore >= 90) return t('subheader.lastNailed', { score: lastScore })
    if (lastScore >= 80) return t('subheader.lastGettingThere', { score: lastScore })
    if (lastScore >= 70) return t('subheader.lastRoom', { score: lastScore })
    return t('subheader.lastFix', { score: lastScore })
  }

  return t('subheader.shotIncoming', { n: shots.length + 1 })
}

function getBrewSubLine(state: BrewmieState, t: T, weather?: { temp: number; humidity: number } | null): string | null {
  const parts: string[] = []

  if (state.beans?.brand) {
    const roastDate = state.beans.roastDate
    if (roastDate) {
      const days = Math.floor((Date.now() - new Date(roastDate).getTime()) / 86400000)
      if (days >= 0) {
        if (days <= 5) parts.push(t('subheader.beanResting', { brand: state.beans.brand, days }))
        else if (days <= 21) parts.push(t('subheader.beanDay', { brand: state.beans.brand, days }))
        else if (days <= 30) parts.push(t('subheader.beanUseSoon', { brand: state.beans.brand, days }))
        else parts.push(t('subheader.beanStale', { brand: state.beans.brand, days }))
      } else {
        parts.push(state.beans.brand)
      }
    } else {
      parts.push(state.beans.brand)
    }
  }

  if (weather) {
    let key = 'subheader.weatherNeutral'
    if (weather.humidity > 70) key = 'subheader.weatherHumid'
    else if (weather.humidity < 40) key = 'subheader.weatherDry'
    parts.push(t(key, { temp: weather.temp, humidity: weather.humidity }))
  }

  return parts.length > 0 ? parts.join(' · ') : null
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
  const { t } = useTranslation()
  let mainLine: string
  let subLine: string | null = null
  let subLineColor: 'default' | 'green' | 'gold' | 'amber' = 'default'

  if (activeTab === 'brew') {
    mainLine = getBrewMainLine(state, t)
    subLine = getBrewSubLine(state, t, weather)
    if (subLine?.includes('stale') || subLine?.includes('use soon')) subLineColor = 'amber'
  } else if (activeTab === 'setup') {
    mainLine = t('subheader.yourKit')
    const incomplete = countIncompleteSections(state)
    if (incomplete === 0) {
      subLine = t('subheader.allSet')
      subLineColor = 'green'
    } else {
      subLine = t(incomplete === 1 ? 'subheader.sectionsToGo' : 'subheader.sectionsToGoPlural', { count: incomplete })
      subLineColor = 'default'
    }
  } else {
    const total = state.shots.length
    if (total === 0) {
      mainLine = t('subheader.pullFirst')
    } else if (total < 5) {
      mainLine = t(total === 1 ? 'subheader.shotsLogged' : 'subheader.shotsLoggedPlural', { count: total })
    } else {
      const avg = Math.round(state.shots.slice(0, 5).reduce((s, sh) => s + (sh.score ?? 0), 0) / 5)
      mainLine = t(total === 1 ? 'subheader.shotsTracked' : 'subheader.shotsTrackedPlural', { count: total })
      subLine = t('subheader.fiveShotAvg', { avg })
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
          position: relative;
          display: flex;
          flex-direction: column;
          padding: 9px 20px 10px 28px;
          background: linear-gradient(180deg, #F2EDE4 0%, var(--off-white) 100%);
          border-bottom: 1px solid var(--border-light);
          flex-shrink: 0;
          user-select: none;
        }

        .subheader::before {
          content: '';
          position: absolute;
          left: 16px;
          top: 50%;
          transform: translateY(-50%);
          width: 4px;
          height: 22px;
          border-radius: 2px;
          background: var(--copper);
          opacity: 0.85;
        }

        .subheader__main {
          font-family: var(--font-primary);
          font-size: 13.5px;
          font-weight: 600;
          color: var(--text-primary);
          line-height: 1.3;
          letter-spacing: 0.1px;
        }

        .subheader__sub {
          font-family: var(--font-primary);
          font-size: 11.5px;
          font-weight: 500;
          color: var(--text-tertiary);
          margin-top: 1px;
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
