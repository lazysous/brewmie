import React from 'react'
import type { AppTab, BrewmieState, AppAction } from '../types'
import { signOut } from '../lib/supabase'
import { useTranslation } from '../hooks/useTranslation'
import type { TParams } from '../lib/i18n'

interface HeroProps {
  activeTab: AppTab
  state: BrewmieState
  dispatch: React.Dispatch<AppAction>
  weather: { temp: number; humidity: number } | null
  onSignIn: () => void
  onHome: () => void
}

type T = (key: string, params?: TParams) => string

interface HeroCopy {
  big: string
  rest?: string
  status: string | null
  meta: string | null
  accent: 'sage' | 'copper' | 'neutral'
}

function isMachineConfigured(state: BrewmieState): boolean {
  return !!(state.machine?.brand && state.grinder?.brand && state.tamp)
}

function countIncompleteSections(state: BrewmieState): number {
  let n = 0
  if (!state.machine?.brand) n++
  if (!state.grinder?.brand) n++
  if (!state.tamp) n++
  if (!state.beans?.brand) n++
  return n
}

function beanWindow(state: BrewmieState, t: T, includeDay: boolean): { label: string; tone: 'sage' | 'copper' } | null {
  const roast = state.beans?.roastDate
  if (!state.beans?.brand || !roast) return null
  const days = Math.floor((Date.now() - new Date(roast).getTime()) / 86400000)
  if (days < 0) return null
  // When the headline already shows "Day N", omit the day-restating window and only show the qualifier
  if (!includeDay) {
    if (days <= 5) return { label: t('hero.beanRestingShort'), tone: 'copper' }
    if (days <= 21) return { label: t('hero.beanDayShort'), tone: 'sage' }
    if (days <= 30) return { label: t('hero.beanUseSoonShort'), tone: 'copper' }
    return { label: t('hero.beanStaleShort'), tone: 'copper' }
  }
  if (days <= 5) return { label: t('hero.beanResting', { days }), tone: 'copper' }
  if (days <= 21) return { label: t('hero.beanDay', { days }), tone: 'sage' }
  if (days <= 30) return { label: t('hero.beanUseSoon', { days }), tone: 'copper' }
  return { label: t('hero.beanStale', { days }), tone: 'copper' }
}

function weatherLabel(weather: HeroProps['weather'], t: T): string | null {
  if (!weather) return null
  let key = 'hero.weatherNeutral'
  if (weather.humidity > 70) key = 'hero.weatherHumid'
  else if (weather.humidity < 40) key = 'hero.weatherDry'
  return t(key, { temp: weather.temp, humidity: weather.humidity })
}

function brewCopy(state: BrewmieState, weather: HeroProps['weather'], t: T): HeroCopy {
  const shots = state.shots
  const last = shots[0]
  const beans = state.beans

  // Big line
  let big = ''
  let rest: string | undefined
  if (shots.length === 0) {
    big = t('hero.brewFirst')
  } else if (beans?.brand) {
    big = beans.brand
    rest = t('hero.dayN', { n: beans.roastDate ? Math.max(0, Math.floor((Date.now() - new Date(beans.roastDate).getTime()) / 86400000)) : 0 })
  } else {
    big = t('hero.shotN', { n: shots.length + 1 })
  }

  // Status line
  let status: string | null = null
  let accent: HeroCopy['accent'] = 'sage'
  if (last && typeof last.score === 'number') {
    const s = last.score
    let tail = ''
    if (s >= 90) { tail = t('hero.statusNailed'); accent = 'sage' }
    else if (s >= 80) { tail = t('hero.statusClose'); accent = 'sage' }
    else if (s >= 70) { tail = t('hero.statusOneTweak'); accent = 'copper' }
    else { tail = t('hero.statusKeepGoing'); accent = 'copper' }
    status = t('hero.statusLastShot', { score: s, tail })
  } else if (shots.length === 0) {
    status = t('hero.statusReady')
    accent = 'copper'
  } else {
    status = t('hero.statusKeepPulling')
    accent = 'sage'
  }

  // Meta line — bean window + weather. Skip restating "Day N" if the headline already shows it.
  const headlineShowsDay = !!rest
  const bw = beanWindow(state, t, !headlineShowsDay)
  const wl = weatherLabel(weather, t)
  const metaParts: string[] = []
  if (bw) metaParts.push(bw.label)
  if (wl) metaParts.push(wl)
  const meta = metaParts.length ? metaParts.join(' · ') : null

  return { big, rest, status, meta, accent }
}

function setupCopy(state: BrewmieState, t: T): HeroCopy {
  const configured = isMachineConfigured(state)
  if (configured && state.beans?.brand) {
    return { big: t('hero.setupAllSetBig'), status: t('hero.setupAllSet'), meta: null, accent: 'sage' }
  }
  if (configured) {
    return { big: t('hero.setupKitOnFile'), status: t('hero.setupAddBeans'), meta: null, accent: 'copper' }
  }
  const incomplete = countIncompleteSections(state)
  if (incomplete === 4) {
    return { big: t('hero.setupEmpty'), status: t('hero.setupEmptySub'), meta: null, accent: 'copper' }
  }
  return {
    big: t('hero.setupYourKit'),
    status: t(incomplete === 1 ? 'hero.setupSectionsToGo' : 'hero.setupSectionsToGoPlural', { count: incomplete }),
    meta: null,
    accent: 'copper',
  }
}

function insightsCopy(state: BrewmieState, t: T): HeroCopy {
  const total = state.shots.length
  if (total === 0) {
    return { big: t('hero.insightsEmpty'), status: t('hero.insightsEmptySub'), meta: null, accent: 'copper' }
  }
  const avg = total >= 5
    ? Math.round(state.shots.slice(0, 5).reduce((s, sh) => s + (sh.score ?? 0), 0) / 5)
    : null
  const big = t('hero.insightsBig')
  const status = total >= 5
    ? t('hero.insightsAvg', { count: total, avg: avg ?? 0 })
    : t(total === 1 ? 'hero.insightsCount' : 'hero.insightsCountPlural', { count: total })
  return { big, status, meta: null, accent: 'sage' }
}

export function Hero({ activeTab, state, dispatch, weather, onSignIn, onHome }: HeroProps) {
  const { t } = useTranslation()

  const copy: HeroCopy =
    activeTab === 'brew' ? brewCopy(state, weather, t)
    : activeTab === 'setup' ? setupCopy(state, t)
    : insightsCopy(state, t)

  const initial = state.displayName
    ? state.displayName.slice(0, 1).toUpperCase()
    : state.userId ? '·' : ''

  const handleSignOut = async () => {
    await signOut()
    dispatch({ type: 'SET_USER', payload: null })
  }

  return (
    <header className={`hero hero--${copy.accent}`} role="banner">
      {/* Top row: wordmark + auth */}
      <div className="hero__top">
        <button
          className="hero__brand"
          onClick={onHome}
          type="button"
          aria-label={t('header.home')}
        >
          <img
            src="/assets/BM-logo-full-white.png"
            alt="Brewmie"
            className="hero__logo"
          />
          <span className="hero__byline">{t('header.byLazySous')}</span>
        </button>

        <div className="hero__auth">
          <button
            className={`hero__barista${state.baristaMode ? ' hero__barista--on' : ''}`}
            onClick={() => dispatch({ type: 'SET_BARISTA_MODE', payload: !state.baristaMode })}
            aria-label={t('barista.toggleOn')}
            title={t('barista.toggleOn')}
            type="button"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M17 8h1a4 4 0 0 1 0 8h-1"/>
              <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/>
              <line x1="6" y1="2" x2="6" y2="4"/>
              <line x1="10" y1="2" x2="10" y2="4"/>
              <line x1="14" y1="2" x2="14" y2="4"/>
            </svg>
          </button>
          {state.userId ? (
            <button
              className="hero__avatar"
              onClick={handleSignOut}
              aria-label={t('header.signOut')}
              title={state.displayName ?? ''}
              type="button"
            >
              <span className="hero__avatar-initial">{initial}</span>
            </button>
          ) : (
            <button className="hero__signin" onClick={onSignIn} type="button">
              {t('header.signIn')}
            </button>
          )}
        </div>
      </div>

      {/* Editorial copy — hidden on the insights tab where the stats grid
          owns the screen and the editorial title would just push content
          down for no payoff. */}
      {activeTab !== 'insights' && (
        <div className="hero__body">
          <h1 className="hero__big">
            {copy.big}
            {copy.rest && <span className="hero__big-rest"> {copy.rest}</span>}
          </h1>
          {copy.meta && <p className="hero__meta">{copy.meta}</p>}
        </div>
      )}

      <div className="hero__rule" aria-hidden="true" />

      <style>{`
        .hero {
          position: relative;
          flex-shrink: 0;
          padding: 0 22px 0;
          background:
            radial-gradient(120% 80% at 0% 0%, rgba(184, 116, 74, 0.06) 0%, transparent 55%),
            linear-gradient(180deg, #FBF8F1 0%, var(--cream) 100%);
          border-bottom: 1px solid var(--border-light);
          user-select: none;
        }

        /* Inverted dark band at the top — bleeds full width past hero padding */
        .hero__top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          height: 52px;
          padding: var(--safe-top) 22px 0;
          margin: 0 -22px 14px;
          background: linear-gradient(180deg, #221C15 0%, #2C261E 100%);
          border-bottom: 1px solid rgba(184, 116, 74, 0.22);
        }

        .hero__brand {
          display: flex;
          align-items: center;
          gap: 10px;
          background: none;
          border: none;
          padding: 0;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
        }
        .hero__brand:active { transform: scale(0.97); }

        .hero__logo {
          height: 28px;
          width: auto;
          display: block;
          object-fit: contain;
        }

        .hero__byline {
          font-family: var(--font-brand);
          font-size: 14px;
          font-style: italic;
          font-weight: 500;
          color: #E5B891;
          letter-spacing: 0.2px;
          line-height: 1;
          /* Optical-centre against the Brewmie wordmark (the cap-height sits
             higher than the geometric centre of the lowercase glyphs). */
          transform: translateY(2px);
        }

        .hero__auth { display: flex; align-items: center; gap: 10px; }

        .hero__barista {
          width: 28px;
          height: 28px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          border: 1px solid rgba(255, 255, 255, 0.22);
          border-radius: 50%;
          color: rgba(255, 255, 255, 0.62);
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
          transition: color 0.18s ease, border-color 0.18s ease, background 0.18s ease;
        }
        .hero__barista:hover { color: #E5B891; border-color: rgba(229, 184, 145, 0.45); }
        .hero__barista--on {
          color: var(--copper);
          border-color: rgba(184, 116, 74, 0.7);
          background: rgba(184, 116, 74, 0.18);
          animation: hbPulse 1.8s ease-out infinite;
        }
        @keyframes hbPulse {
          0%   { box-shadow: 0 0 0 0 rgba(184, 116, 74, 0.5); }
          70%  { box-shadow: 0 0 0 8px rgba(184, 116, 74, 0); }
          100% { box-shadow: 0 0 0 0 rgba(184, 116, 74, 0); }
        }

        .hero__signin {
          font-size: 12px;
          font-weight: 600;
          color: var(--copper);
          background: transparent;
          border: none;
          letter-spacing: 0.3px;
          cursor: pointer;
          padding: 6px 4px;
          -webkit-tap-highlight-color: transparent;
        }
        .hero__signin:active { transform: scale(0.95); }

        .hero__avatar {
          width: 30px;
          height: 30px;
          border-radius: 9999px;
          background: rgba(184, 116, 74, 0.10);
          border: 1.5px solid rgba(184, 116, 74, 0.42);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
        }
        .hero__avatar:active { transform: scale(0.93); }
        .hero__avatar-initial {
          font-size: 12px;
          font-weight: 700;
          color: var(--copper-deep);
        }

        /* Editorial body — scales with viewport height for tablet → phone. */
        .hero__body {
          margin-top: clamp(8px, 2vh, 22px);
          margin-bottom: clamp(0px, 0.4vh, 6px);
          min-height: clamp(40px, 8vh, 72px);
        }

        .hero__big {
          font-family: var(--font-brand);
          font-weight: 600;
          font-size: clamp(24px, 4.4vh, 36px);
          line-height: 1.02;
          letter-spacing: -0.3px;
          color: #221C15;
          margin: 0;
          animation: heroFade 0.32s ease-out both;
        }

        .hero__big-rest {
          color: var(--copper);
          font-style: italic;
          font-weight: 500;
          font-size: clamp(20px, 3.8vh, 30px);
        }

        .hero__status {
          margin-top: clamp(3px, 0.6vh, 8px);
          font-size: clamp(11px, 1.7vh, 14px);
          font-weight: 600;
          letter-spacing: 0.1px;
          line-height: 1.35;
          animation: heroFade 0.36s 0.04s ease-out both;
        }

        .hero--sage .hero__status { color: var(--accent-green); }
        .hero--copper .hero__status { color: var(--copper); }
        .hero--neutral .hero__status { color: var(--text-secondary); }

        .hero__meta {
          margin-top: clamp(4px, 1vh, 12px);
          font-size: clamp(11px, 1.6vh, 13px);
          font-weight: 500;
          color: var(--text-tertiary);
          line-height: 1.4;
          letter-spacing: 0.1px;
          animation: heroFade 0.4s 0.08s ease-out both;
        }

        .hero__rule {
          position: absolute;
          left: 22px;
          right: 22px;
          bottom: 0;
          height: 1px;
          background: linear-gradient(90deg, transparent, var(--border) 25%, var(--border) 75%, transparent);
          opacity: 0.7;
        }
        .hero--sage .hero__rule {
          background: linear-gradient(90deg, transparent, rgba(107, 142, 92, 0.45) 20%, rgba(107, 142, 92, 0.05) 90%, transparent);
        }
        .hero--copper .hero__rule {
          background: linear-gradient(90deg, transparent, rgba(184, 116, 74, 0.45) 20%, rgba(184, 116, 74, 0.05) 90%, transparent);
        }

        @keyframes heroFade {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        /* Very narrow phones (≤360px) — nudge the title down one size step
           regardless of height. */
        @media (max-width: 360px) {
          .hero__big { font-size: clamp(22px, 4vh, 30px); }
          .hero__big-rest { font-size: clamp(18px, 3.4vh, 26px); }
        }
      `}</style>
    </header>
  )
}
