import { useEffect, useState } from 'react'
import { setTierOverride } from '../hooks/useTier'
import type { Tier } from '../types'

// Floating dev-only pill in the bottom-right. Cycles override:
//   off → free → premium → off
// Visible only when import.meta.env.DEV is true.

const ORDER: (Tier | null)[] = [null, 'free', 'premium']

function readOverride(): Tier | null {
  const v = typeof window === 'undefined' ? null : localStorage.getItem('brewmie_tier_override')
  return v === 'free' || v === 'premium' ? v : null
}

export function DevTierPill() {
  const [override, setOverride] = useState<Tier | null>(readOverride())

  useEffect(() => {
    const onChange = () => setOverride(readOverride())
    window.addEventListener('brewmie:tier-override', onChange)
    window.addEventListener('storage', onChange)
    return () => {
      window.removeEventListener('brewmie:tier-override', onChange)
      window.removeEventListener('storage', onChange)
    }
  }, [])

  if (!import.meta.env.DEV) return null

  const next = () => {
    const idx = ORDER.indexOf(override)
    const nextVal = ORDER[(idx + 1) % ORDER.length]
    setTierOverride(nextVal)
  }

  const label = override === null ? 'auto' : override
  const colorClass = override === 'premium' ? 'dev-pill--premium' : override === 'free' ? 'dev-pill--free' : 'dev-pill--auto'

  return (
    <button className={`dev-pill ${colorClass}`} onClick={next} type="button" aria-label="Toggle dev tier override">
      <span className="dev-pill__label">tier</span>
      <span className="dev-pill__value">{label}</span>
      <style>{`
        .dev-pill {
          position: fixed;
          right: 12px;
          bottom: calc(80px + env(safe-area-inset-bottom));
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
