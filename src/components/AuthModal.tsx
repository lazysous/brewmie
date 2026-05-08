import React, { useState } from 'react'
import { Capacitor } from '@capacitor/core'
import type { AppAction } from '../types'
import { signInWithEmail, signUpWithEmail, signInWithApple, signInWithGoogle } from '../lib/supabase'

const isNative = Capacitor.isNativePlatform()

interface AuthModalProps {
  open: boolean
  onClose: () => void
  dispatch: React.Dispatch<AppAction>
}

export function AuthModal({ open, onClose, dispatch }: AuthModalProps) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  if (!open) return null

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      if (mode === 'signin') {
        const { data, error: err } = await signInWithEmail(email, password)
        if (err) throw err
        if (data.user) {
          dispatch({ type: 'SET_USER', payload: data.user.id })
          onClose()
        }
      } else {
        const { data, error: err } = await signUpWithEmail(email, password)
        if (err) throw err
        if (data.user) {
          dispatch({ type: 'SET_USER', payload: data.user.id })
          setSuccess(true)
          setTimeout(onClose, 1500)
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Something went wrong.'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  async function handleApple() {
    setError(null)
    setLoading(true)
    try {
      const { data, error: err } = await signInWithApple()
      if (err) throw err
      if (data.user) {
        dispatch({ type: 'SET_USER', payload: data.user.id })
        onClose()
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Apple sign-in failed.'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  async function handleGoogle() {
    setError(null)
    setLoading(true)
    try {
      const { data, error: err } = await signInWithGoogle()
      if (err) throw err
      if (data.user) {
        dispatch({ type: 'SET_USER', payload: data.user.id })
        onClose()
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Google sign-in failed.'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="am-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="Sign in">
      <div className="am-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="am-handle" aria-hidden="true" />

        <h2 className="am-title">
          {success ? 'Welcome to Brewmie.' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </h2>

        {success ? (
          <p className="am-success">Account created. You're dialling in.</p>
        ) : isNative ? (
          <div className="am-native-buttons">
            {error && <p className="am-error">{error}</p>}
            <button
              className="am-native-apple"
              type="button"
              disabled={loading}
              onClick={handleApple}
            >
              {loading ? '…' : 'Continue with Apple'}
            </button>
            <button
              className="am-native-google"
              type="button"
              disabled={loading}
              onClick={handleGoogle}
            >
              {loading ? '…' : 'Continue with Google'}
            </button>
          </div>
        ) : (
          <form className="am-form" onSubmit={handleSubmit}>
            <label className="am-field">
              <span className="am-label">Email</span>
              <input
                className="am-input"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </label>
            <label className="am-field">
              <span className="am-label">Password</span>
              <input
                className="am-input"
                type="password"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
            </label>

            {error && <p className="am-error">{error}</p>}

            <button className="am-submit" type="submit" disabled={loading}>
              {loading ? '…' : mode === 'signin' ? 'Sign in' : 'Create account'}
            </button>

            <button
              className="am-toggle"
              type="button"
              onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null) }}
            >
              {mode === 'signin' ? 'No account? Create one' : 'Already have an account? Sign in'}
            </button>
          </form>
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
          background: var(--white);
          border-radius: 20px 20px 0 0;
          padding: 12px 24px 40px;
          width: 100%;
          max-width: 428px;
          animation: slideUp 0.25s ease-out both;
        }

        .am-handle {
          width: 36px;
          height: 4px;
          background: var(--border);
          border-radius: 9999px;
          margin: 0 auto 24px;
        }

        .am-title {
          font-size: 22px;
          font-weight: 700;
          color: var(--text-primary);
          margin-bottom: 20px;
        }

        .am-success {
          font-size: 15px;
          color: var(--accent-green);
          padding: 20px 0;
          text-align: center;
        }

        .am-form {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .am-field {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }

        .am-label {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.8px;
          color: var(--text-tertiary);
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
          box-shadow: 0 0 0 3px rgba(45,80,22,0.1);
        }

        .am-error {
          font-size: 13px;
          color: #8B1A1A;
          background: rgba(139,26,26,0.07);
          padding: 10px 14px;
          border-radius: 10px;
        }

        .am-submit {
          height: 52px;
          background: linear-gradient(135deg, #2D5016 0%, #3a6b1e 100%);
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
          opacity: 0.6;
          cursor: not-allowed;
        }

        .am-toggle {
          font-size: 13px;
          color: var(--text-tertiary);
          background: none;
          border: none;
          cursor: pointer;
          padding: 4px 0;
          text-align: center;
          -webkit-tap-highlight-color: transparent;
        }

        .am-toggle:hover {
          color: var(--accent-green);
        }

        .am-native-buttons {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .am-native-apple {
          height: 52px;
          background: #000;
          color: #fff;
          border: none;
          border-radius: 14px;
          font-size: 15px;
          font-weight: 700;
          letter-spacing: 0.3px;
          cursor: pointer;
          width: 100%;
          transition: opacity 0.15s ease;
          -webkit-tap-highlight-color: transparent;
        }

        .am-native-apple:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .am-native-google {
          height: 52px;
          background: #fff;
          color: #1a1a1a;
          border: 1.5px solid var(--border, #d1d5db);
          border-radius: 14px;
          font-size: 15px;
          font-weight: 700;
          letter-spacing: 0.3px;
          cursor: pointer;
          width: 100%;
          transition: opacity 0.15s ease;
          -webkit-tap-highlight-color: transparent;
        }

        .am-native-google:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  )
}
