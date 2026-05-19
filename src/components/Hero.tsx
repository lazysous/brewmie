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
              className="hero__profile hero__profile--signed-in"
              onClick={handleSignOut}
              aria-label={t('header.signOut')}
              title={state.displayName ?? ''}
              type="button"
            >
              {state.displayName ? state.displayName.charAt(0).toUpperCase() : (
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
                  <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                </svg>
              )}
            </button>
          ) : SIGN_IN_AVAILABLE ? (
            <button
              className={`hero__signin hero__signin--${Capacitor.getPlatform() === 'android' ? 'google' : 'apple'}`}
              onClick={onSignIn}
              aria-label={t('header.signIn')}
              type="button"
            >
              {Capacitor.getPlatform() === 'android' ? (
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.24 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.11A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.11V7.05H2.18A11 11 0 0 0 1 12c0 1.77.42 3.45 1.18 4.95l3.66-2.84z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.05l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/>
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
                  <path d="M17.05 12.04c0-2.5 2.05-3.7 2.14-3.76-1.17-1.7-2.99-1.94-3.63-1.96-1.54-.16-3.01.91-3.79.91-.79 0-2-.89-3.29-.86-1.69.02-3.25.98-4.12 2.49-1.76 3.05-.45 7.56 1.27 10.03.84 1.21 1.84 2.57 3.14 2.52 1.26-.05 1.74-.81 3.27-.81 1.52 0 1.96.81 3.29.79 1.36-.02 2.22-1.23 3.05-2.45.97-1.4 1.36-2.76 1.38-2.83-.03-.01-2.65-1.02-2.71-4.04zM14.49 4.51c.7-.85 1.17-2.03 1.04-3.2-1.01.04-2.23.67-2.95 1.51-.65.75-1.21 1.95-1.06 3.1 1.12.09 2.27-.57 2.97-1.41z"/>
                </svg>
              )}
              <span className="hero__signin-label">{t('header.signIn')}</span>
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

        /* Profile icon — replaces a plain "Sign in" text link in the header.
           Apple's HIG flags using just text where a recognised sign-in flow
           would normally appear; an icon-only entry that opens a properly-
           styled provider modal is the safer pattern. */
        .hero__profile {
          width: 44px;
          height: 44px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(184, 116, 74, 0.14);
          border: 1.5px solid rgba(184, 116, 74, 0.45);
          color: var(--copper);
          border-radius: 999px;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
          padding: 0;
          font-size: 14px;
          font-weight: 700;
        }
        .hero__profile:active { transform: scale(0.95); }
        .hero__profile--signed-in {
          background: var(--copper);
          border-color: var(--copper);
          color: #fff;
        }

        .hero__signin {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.2px;
          padding: 8px 14px;
          min-height: 36px;
          border-radius: 999px;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
          transition: transform 0.1s ease;
        }
        .hero__signin:active { transform: scale(0.97); }
        /* Apple HIG: solid black + white logo + system font. */
        .hero__signin--apple {
          background: #000;
          color: #fff;
          border: 1px solid #000;
          font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
        }
        /* Google branding: white + #dadce0 border + Roboto. */
        .hero__signin--google {
          background: #fff;
          color: #3c4043;
          border: 1px solid #dadce0;
          font-family: 'Roboto', Arial, sans-serif;
        }
        .hero__signin-label {
          line-height: 1;
        }

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
