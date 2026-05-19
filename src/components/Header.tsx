import React from 'react'
import type { BrewmieState, AppAction } from '../types'
import { signOut } from '../lib/supabase'
import { useTranslation } from '../hooks/useTranslation'

interface HeaderProps {
  state: BrewmieState
  dispatch: React.Dispatch<AppAction>
  onSignIn: () => void
  onHome?: () => void
}

export function Header({ state, dispatch, onSignIn, onHome }: HeaderProps) {
  const { t } = useTranslation()
  const handleSignOut = async () => {
    await signOut()
    dispatch({ type: 'SET_USER', payload: null })
  }

  const initial = state.displayName
    ? state.displayName.slice(0, 1).toUpperCase()
    : state.userId
      ? '·'
      : ''

  return (
    <header className="header">
      {/* Brand acts as home button */}
      <button
        className="header__brand"
        onClick={onHome}
        type="button"
        aria-label={t('header.home')}
      >
        <img
          src="/assets/BM-logo-full-white.png"
          alt={t('header.logoAlt')}
          className="header__logo-img"
        />
        <span className="header__byline">{t('header.byLazySous')}</span>
      </button>

      {/* Right: auth */}
      <div className="header__actions">
        {state.userId ? (
          <button
            className="header__avatar-btn"
            onClick={handleSignOut}
            aria-label={t('header.signOut')}
            title={t('header.signOut')}
          >
            <span className="header__avatar-initial">{initial}</span>
          </button>
        ) : (
          <button className="header__sign-in-btn" onClick={onSignIn} aria-label={t('header.signIn')}>
            {t('header.signIn')}
          </button>
        )}
      </div>

      <style>{`
        .header {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          /* Dynamic Island on iPhone Pro Max devices extends ~3pt below the
             safe-area-inset-top boundary. safe-top + 20pt guarantees the
             wordmark clears the island on every iPhone shipped to date,
             including landscape orientation where the safe inset is 0
             (the +20 still gives a comfortable top breathing strip). */
          min-height: calc(56px + var(--safe-top) + 20px);
          padding: calc(var(--safe-top) + 20px) 16px 12px;
          background: linear-gradient(180deg, #221C15 0%, #2C261E 100%);
          border-bottom: 1px solid rgba(184, 116, 74, 0.22);
          flex-shrink: 0;
          user-select: none;
        }

        /* Brand acts as home button. Centered visually; auth slot is absolute. */
        .header__brand {
          display: flex;
          flex-direction: row;
          align-items: baseline;
          gap: 8px;
          background: none;
          border: none;
          padding: 4px 12px;
          cursor: pointer;
          border-radius: 12px;
          transition: background 0.18s ease, transform 0.08s ease;
          -webkit-tap-highlight-color: transparent;
        }

        .header__brand:hover {
          background: rgba(184, 116, 74, 0.08);
        }

        .header__brand:active {
          transform: scale(0.96);
        }

        .header__logo-img {
          height: 34px;
          width: auto;
          display: block;
          object-fit: contain;
        }

        .header__byline {
          font-family: var(--font-brand);
          font-size: 12px;
          font-style: italic;
          font-weight: 500;
          color: #C68A5C;
          letter-spacing: 0.4px;
          line-height: 1;
          opacity: 0.85;
        }

        /* Auth slot — absolute right */
        .header__actions {
          position: absolute;
          right: 16px;
          top: 50%;
          transform: translateY(calc(-50% + var(--safe-top) / 2));
          display: flex;
          align-items: center;
        }

        .header__avatar-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 34px;
          height: 34px;
          border-radius: var(--radius-full);
          background: rgba(184, 116, 74, 0.12);
          border: 1.5px solid rgba(184, 116, 74, 0.45);
          cursor: pointer;
          transition: background 0.2s ease, border-color 0.2s ease;
          -webkit-tap-highlight-color: transparent;
        }

        .header__avatar-btn:hover {
          background: rgba(184, 116, 74, 0.22);
          border-color: rgba(184, 116, 74, 0.7);
        }

        .header__avatar-btn:active {
          transform: scale(0.93);
        }

        .header__avatar-initial {
          font-size: 13px;
          font-weight: 700;
          color: #C68A5C;
          letter-spacing: 0.3px;
          line-height: 1;
        }

        .header__sign-in-btn {
          font-family: var(--font-primary);
          font-size: 12px;
          font-weight: 600;
          color: #E5B891;
          background: transparent;
          border: none;
          padding: 4px 0;
          cursor: pointer;
          letter-spacing: 0.3px;
          transition: color 0.2s ease;
          -webkit-tap-highlight-color: transparent;
        }

        .header__sign-in-btn:hover {
          color: #F2CFA9;
        }

        .header__sign-in-btn:active {
          transform: scale(0.93);
        }
      `}</style>
    </header>
  )
}
