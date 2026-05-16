import React, { useState, useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import type { AppAction } from '../types'
import {
  signInWithApple,
  signInWithGoogle,
  signInWithGitHub,
  setDisplayName,
} from '../lib/supabase'
import { useTranslation } from '../hooks/useTranslation'

const isNative = Capacitor.isNativePlatform()

interface AuthModalProps {
  open: boolean
  onClose: () => void
  dispatch: React.Dispatch<AppAction>
  // When set, modal opens directly in nickname-capture mode (post-auth).
  nicknameForUser?: string | null
}

type Step = 'provider' | 'nickname'

export function AuthModal({ open, onClose, dispatch, nicknameForUser }: AuthModalProps) {
  const { t } = useTranslation()
  const [step, setStep] = useState<Step>(nicknameForUser ? 'nickname' : 'provider')
  const [nickname, setNickname] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) {
      setStep(nicknameForUser ? 'nickname' : 'provider')
      setError(null)
      setNickname('')
    }
  }, [open, nicknameForUser])

  if (!open) return null

  async function runProvider(fn: () => Promise<{ error?: unknown }>) {
    setError(null)
    setLoading(true)
    try {
      const { error: err } = await fn() as { error?: { message?: string } | null }
      if (err) throw err
      // OAuth redirect flow on web: the page will reload after redirect, so we won't get here.
      // Native: the in-app browser closes and onAuthStateChange in App.tsx handles SET_USER.
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('auth.errorGeneric')
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  async function handleNicknameSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!nickname.trim() || !nicknameForUser) return
    setLoading(true)
    setError(null)
    try {
      const { error: err } = await setDisplayName(nicknameForUser, nickname.trim())
      if (err) throw err
      dispatch({ type: 'SET_DISPLAY_NAME', payload: nickname.trim() })
      onClose()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('auth.errorGeneric')
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="am-backdrop" onClick={step === 'provider' ? onClose : undefined} role="dialog" aria-modal="true" aria-label={t('auth.ariaLabel')}>
      <div className="am-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="am-handle" aria-hidden="true" />

        {step === 'nickname' ? (
          <>
            <div className="am-eyebrow">
              <span className="am-eyebrow__mark" aria-hidden="true" />
              Brewmie
            </div>
            <h2 className="am-title">{t('auth.nicknameTitle')}</h2>
            <form className="am-form" onSubmit={handleNicknameSubmit}>
              <input
                className="am-input"
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder={t('auth.nicknamePlaceholder')}
                maxLength={24}
                autoFocus
                required
              />
              {error && <p className="am-error">{error}</p>}
              <button className="am-submit" type="submit" disabled={loading || !nickname.trim()}>
                {loading ? '…' : t('auth.nicknameSubmit')}
              </button>
            </form>
          </>
        ) : (
          <>
            <div className="am-eyebrow">
              <span className="am-eyebrow__mark" aria-hidden="true" />
              Brewmie
            </div>
            <h2 className="am-title">{t('auth.titleSignIn')}</h2>

            {error && <p className="am-error">{error}</p>}

            <div className="am-providers">
              <button
                className="am-provider am-provider--apple"
                type="button"
                disabled={loading}
                onClick={() => runProvider(signInWithApple)}
              >
                <span className="am-provider__icon" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09M12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25"/></svg>
                </span>
                {t('auth.continueApple')}
              </button>

              <button
                className="am-provider am-provider--google"
                type="button"
                disabled={loading}
                onClick={() => runProvider(signInWithGoogle)}
              >
                <span className="am-provider__icon" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A10.99 10.99 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18a10.99 10.99 0 0 0 0 9.86z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A10.99 10.99 0 0 0 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/></svg>
                </span>
                {t('auth.continueGoogle')}
              </button>

              {!isNative && (
                <button
                  className="am-provider am-provider--github"
                  type="button"
                  disabled={loading}
                  onClick={() => runProvider(signInWithGitHub)}
                >
                  <span className="am-provider__icon" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55 0-.27-.01-1-.02-1.95-3.2.7-3.87-1.54-3.87-1.54-.52-1.33-1.27-1.68-1.27-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.69 1.24 3.34.95.1-.74.4-1.24.72-1.53-2.55-.29-5.23-1.27-5.23-5.65 0-1.25.45-2.27 1.18-3.07-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.18 1.17a11.05 11.05 0 0 1 5.79 0c2.21-1.48 3.18-1.17 3.18-1.17.62 1.58.23 2.75.11 3.04.74.8 1.18 1.82 1.18 3.07 0 4.39-2.68 5.36-5.24 5.64.41.36.78 1.06.78 2.14 0 1.54-.01 2.79-.01 3.17 0 .3.21.66.79.55C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5"/></svg>
                  </span>
                  {t('auth.continueGitHub')}
                </button>
              )}
            </div>

          </>
        )}
      </div>

      <style>{`
        .am-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.5);
          z-index: 100;
          display: flex;
          align-items: flex-end;
          justify-content: center;
          animation: fadeIn 0.2s ease-out both;
        }

        .am-sheet {
          background: linear-gradient(180deg, #FBF8F1 0%, var(--cream) 100%);
          border-radius: 24px 24px 0 0;
          padding: 12px 24px 32px;
          width: 100%;
          max-width: 428px;
          animation: slideUp 0.28s cubic-bezier(0.2, 0.9, 0.3, 1) both;
          box-shadow: 0 -10px 40px rgba(60, 40, 20, 0.18);
        }

        .am-handle {
          width: 36px;
          height: 4px;
          background: var(--border);
          border-radius: 9999px;
          margin: 0 auto 18px;
        }

        .am-eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-family: var(--font-brand);
          font-size: 13px;
          font-weight: 600;
          color: var(--copper);
          letter-spacing: 0.4px;
          margin-bottom: 12px;
        }
        .am-eyebrow__mark {
          width: 14px;
          height: 1.5px;
          background: var(--copper);
          opacity: 0.6;
        }

        .am-title {
          font-family: var(--font-brand);
          font-size: 30px;
          font-weight: 600;
          letter-spacing: -0.2px;
          color: var(--text-primary);
          margin: 0 0 8px;
          line-height: 1.1;
        }

        .am-sub {
          font-size: 13px;
          color: var(--text-tertiary);
          line-height: 1.45;
          margin: 0 0 18px;
        }

        .am-error {
          font-size: 13px;
          color: #8B1A1A;
          background: rgba(139,26,26,0.07);
          padding: 10px 14px;
          border-radius: 10px;
          margin-bottom: 12px;
        }

        .am-providers {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .am-provider {
          height: 50px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          border-radius: 12px;
          font-size: 15px;
          font-weight: 600;
          letter-spacing: 0.2px;
          cursor: pointer;
          border: 1.5px solid transparent;
          transition: opacity 0.15s ease, transform 0.08s ease;
          -webkit-tap-highlight-color: transparent;
        }

        .am-provider:active {
          transform: scale(0.98);
        }

        .am-provider:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .am-provider__icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }

        .am-provider--apple {
          background: #221C15;
          color: #fff;
        }
        .am-provider--google {
          background: #fff;
          color: #1a1a1a;
          border-color: var(--border);
        }
        .am-provider--meta {
          background: #fff;
          color: #1a1a1a;
          border-color: var(--border);
        }
        .am-provider--github {
          background: #2C261E;
          color: #fff;
        }

        .am-fineprint {
          font-size: 11px;
          color: var(--text-tertiary);
          line-height: 1.5;
          margin: 16px 0 0;
          text-align: center;
        }

        /* Nickname step */
        .am-form {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .am-input {
          height: 48px;
          padding: 0 14px;
          border-radius: 12px;
          border: 1.5px solid var(--border);
          background: var(--off-white);
          font-size: 16px;
          color: var(--text-primary);
          transition: border-color 0.15s ease;
        }

        .am-input:focus {
          border-color: var(--accent-green);
          outline: none;
          box-shadow: 0 0 0 3px rgba(107, 142, 92,0.1);
        }

        .am-submit {
          height: 52px;
          background: var(--accent-green);
          color: var(--white);
          border: none;
          border-radius: 14px;
          font-size: 15px;
          font-weight: 700;
          letter-spacing: 0.3px;
          cursor: pointer;
          margin-top: 4px;
          transition: opacity 0.15s ease;
          -webkit-tap-highlight-color: transparent;
        }

        .am-submit:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  )
}
