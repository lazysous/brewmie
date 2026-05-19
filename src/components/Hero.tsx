import React from 'react'
import { Capacitor } from '@capacitor/core'
import type { AppTab, BrewmieState, AppAction } from '../types'
import { signOut } from '../lib/supabase'
import { useTranslation } from '../hooks/useTranslation'
import type { TParams } from '../lib/i18n'

// Sign-in is native-only. Web users see no auth UI — the Supabase OAuth flow
// would leak the project URL on the Google consent screen, which destroys the
// install funnel. Native Apple/Google use signInWithIdToken, which doesn't.
const SIGN_IN_AVAILABLE = Capacitor.isNativePlatform()

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

  // Meta line — temp + humidity only, no bean window prefix and no advisory
  // suffix. One clean line.
  const meta = weatherLabel(weather, t)

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
          {state.userId ? (
            <button
              className="hero__signin"
              onClick={handleSignOut}
              aria-label={t('header.signOut')}
              title={state.displayName ?? ''}
              type="button"
            >
              {t('header.signOut')}
            </button>
          ) : SIGN_IN_AVAILABLE ? (
            <button className="hero__signin" onClick={onSignIn} type="button">
              {t('header.signIn')}
            </button>
          ) : null}
        </div>
      </div>

      {/* Editorial title is gone from every tab — direct copy beats decorative
          headers in this product. The recipe card, setup cards, and stats
          grid carry the meaning on their own. Weather meta surfaces inline
          on the brew tab only. */}
      {activeTab === 'brew' && copy.meta && (
        <div className="hero__body hero__body--meta-only">
          <p className="hero__meta">{copy.meta}</p>
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

        /* Inverted dark band at the top — bleeds full width past hero padding.
           box-sizing: border-box means height includes padding, so we use
           min-height + explicit safe-top padding. Content area is ~52pt with
           +12pt breathing room around it; safe-top guarantees the wordmark
           sits clear of the Dynamic Island on every iPhone. */
        .hero__top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          min-height: calc(52px + var(--safe-top));
          padding: calc(var(--safe-top) + 12px) 22px 12px;
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
        /* Meta-only variant: just the weather line, no editorial title slot. */
        .hero__body--meta-only {
          margin-top: clamp(4px, 1vh, 10px);
          margin-bottom: clamp(2px, 0.4vh, 6px);
          min-height: 0;
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
