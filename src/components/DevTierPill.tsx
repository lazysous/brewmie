import { useEffect, useState } from 'react'
import { setTierOverride } from '../hooks/useTier'
import type { Tier } from '../types'

// Floating tier-override pill, bottom-right. Cycles:  off → free → premium → off
//
// Visibility:
//   - Always visible in dev (import.meta.env.DEV)
//   - In production, visible if the user has opted in via:
//       1. URL param ?devtest=1  (one-time, persists)
//       2. localStorage.brewmie_devtest = '1'
//   - To exit production test mode: long-press the pill (1s) → clears the
//     opt-in flag, pill disappears on next reload.
//
// TODO: remove this component (and its mount in App.tsx) before shipping
// the public production build.

const ORDER: (Tier | null)[] = [null, 'free', 'premium']
const OPT_IN_KEY = 'brewmie_devtest'

function readOverride(): Tier | null {
  const v = typeof window === 'undefined' ? null : localStorage.getItem('brewmie_tier_override')
  return v === 'free' || v === 'premium' ? v : null
}

function readProdOptIn(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const params = new URLSearchParams(window.location.search)
    if (params.get('devtest') === '1') {
      localStorage.setItem(OPT_IN_KEY, '1')
      return true
    }
    return localStorage.getItem(OPT_IN_KEY) === '1'
  } catch {
    return false
  }
}

export function DevTierPill() {
  const [override, setOverride] = useState<Tier | null>(readOverride())
  const [pressTimer, setPressTimer] = useState<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const onChange = () => setOverride(readOverride())
    window.addEventListener('brewmie:tier-override', onChange)
    window.addEventListener('storage', onChange)
    return () => {
      window.removeEventListener('brewmie:tier-override', onChange)
      window.removeEventListener('storage', onChange)
    }
  }, [])

  const visible = import.meta.env.DEV || readProdOptIn()
  if (!visible) return null

  const next = () => {
    const idx = ORDER.indexOf(override)
    const nextVal = ORDER[(idx + 1) % ORDER.length]
    setTierOverride(nextVal)
  }

  // Long-press (1s) in production exits test mode entirely.
  const startPress = () => {
    if (import.meta.env.DEV) return
    const t = setTimeout(() => {
      if (!confirm('Exit test mode? The Premium toggle will disappear.')) return
      try {
        localStorage.removeItem(OPT_IN_KEY)
        setTierOverride(null)
      } catch { /* ignore */ }
      window.location.reload()
    }, 1000)
    setPressTimer(t)
  }
  const cancelPress = () => {
    if (pressTimer) {
      clearTimeout(pressTimer)
      setPressTimer(null)
    }
  }

  const label = override === null ? 'auto' : override
  const colorClass = override === 'premium' ? 'dev-pill--premium' : override === 'free' ? 'dev-pill--free' : 'dev-pill--auto'

  return (
    <button
      className={`dev-pill ${colorClass}`}
      onClick={next}
      onPointerDown={startPress}
      onPointerUp={cancelPress}
      onPointerLeave={cancelPress}
      onPointerCancel={cancelPress}
      type="button"
      aria-label="Toggle premium tier (test mode)"
      title="Tap to cycle auto → free → premium. Long-press in production to exit test mode."
    >
      <span className="dev-pill__label">tier</span>
      <span className="dev-pill__value">{label}</span>
      <style>{`
        .dev-pill {
          position: fixed;
          right: 12px;
          top: calc(10px + env(safe-area-inset-top));
          z-index: 9999;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 5px 12px;
          border-radius: 9999px;
          border: 1px solid rgba(0, 0, 0, 0.18);
          background: rgba(20, 18, 14, 0.85);
          color: #fff;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.8px;
          text-transform: uppercase;
          cursor: pointer;
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
          -webkit-tap-highlight-color: transparent;
        }
        .dev-pill:active { transform: scale(0.95); }

        .dev-pill__label {
          opacity: 0.6;
          font-weight: 600;
        }

        .dev-pill--auto .dev-pill__value { color: #C68A5C; }
        .dev-pill--free .dev-pill__value { color: #E5B891; }
        .dev-pill--premium .dev-pill__value { color: #A0D080; }
      `}</style>
    </button>
  )
}
