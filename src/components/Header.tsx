import React from 'react'
import type { BrewmieState, AppAction } from '../types'
import { signOut } from '../lib/supabase'

interface HeaderProps {
  state: BrewmieState
  dispatch: React.Dispatch<AppAction>
  onSignIn: () => void
}

export function Header({ state, dispatch, onSignIn }: HeaderProps) {
  const handleSignOut = async () => {
    await signOut()
    dispatch({ type: 'SET_USER', payload: null })
  }

  const initial = state.userId ? state.userId.slice(0, 1).toUpperCase() : ''

  return (
    <header className="header">
      {/* Centered brand */}
      <div className="header__brand">
        <img
          src="/assets/BM-logo-full-white.png"
          alt="Brewmie"
          className="header__logo-img"
        />
        <span className="header__byline">by Lazy Sous</span>
      </div>

      {/* Right: auth */}
      <div className="header__actions">
        {state.userId ? (
          <button
            className="header__avatar-btn"
            onClick={handleSignOut}
            aria-label="Sign out"
            title="Sign out"
          >
            <span className="header__avatar-initial">{initial}</span>
          </button>
        ) : (
          <button className="header__sign-in-btn" onClick={onSignIn} aria-label="Sign in">
            Sign in
          </button>
        )}
      </div>

      <style>{`
        .header {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          height: calc(60px + var(--safe-top));
          padding-top: var(--safe-top);
          padding-left: 16px;
          padding-right: 16px;
          background: linear-gradient(160deg, #1A1A1A 0%, #2C2C2C 100%);
          border-bottom: 1px solid rgba(212, 160, 23, 0.2);
          flex-shrink: 0;
          user-select: none;
        }

        /* Brand — centered via absolute so auth doesn't shift it */
        .header__brand {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
          pointer-events: none;
        }

        .header__logo-img {
          height: 28px;
          width: auto;
          display: block;
          object-fit: contain;
        }

        .header__byline {
          font-family: var(--font-brand);
          font-size: 12px;
          font-weight: 600;
          color: #D4A017;
          letter-spacing: 0.6px;
          line-height: 1;
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
          background: rgba(212, 160, 23, 0.12);
          border: 1.5px solid rgba(212, 160, 23, 0.45);
          cursor: pointer;
          transition: background 0.2s ease, border-color 0.2s ease;
          -webkit-tap-highlight-color: transparent;
        }

        .header__avatar-btn:hover {
          background: rgba(212, 160, 23, 0.22);
          border-color: rgba(212, 160, 23, 0.7);
        }

        .header__avatar-btn:active {
          transform: scale(0.93);
        }

        .header__avatar-initial {
          font-size: 13px;
          font-weight: 700;
          color: #D4A017;
          letter-spacing: 0.3px;
          line-height: 1;
        }

        .header__sign-in-btn {
          font-family: var(--font-primary);
          font-size: 11px;
          font-weight: 500;
          color: rgba(212, 160, 23, 0.75);
          background: transparent;
          border: none;
          padding: 4px 0;
          cursor: pointer;
          letter-spacing: 0.3px;
          transition: color 0.2s ease;
          -webkit-tap-highlight-color: transparent;
        }

        .header__sign-in-btn:hover {
          color: #D4A017;
        }

        .header__sign-in-btn:active {
          transform: scale(0.93);
        }
      `}</style>
    </header>
  )
}
