import { useEffect, useState } from 'react'
import { fetchGlobalShotCount } from '../lib/supabase'
import { useTranslation } from '../hooks/useTranslation'

// Backtest baseline — community shots the roast offsets were derived from.
// The algorithm starts from this prior and refines as real shots arrive.
// See ROAST_TIME_OFFSET in BrewScreen (19,546 Visualizer.coffee shots).
const BACKTEST_BASELINE = 19546

// Single line at the very bottom of the screen: "Brewmie has dialled in
// X,XXX espressos worldwide." Always shows the backtest baseline; adds live
// Supabase shots when the RPC is available.

export function GlobalShotCounter() {
  const { t } = useTranslation()
  const [liveCount, setLiveCount] = useState<number>(0)

  useEffect(() => {
    let cancelled = false
    function refresh() {
      fetchGlobalShotCount().then((n) => {
        if (!cancelled && n !== null) setLiveCount(n)
      }).catch(() => {})
    }
    refresh()
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      cancelled = true
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  const total = BACKTEST_BASELINE + liveCount

  return (
    <div className="global-shot-counter" role="status" aria-live="polite">
      <span className="global-shot-counter__num">{total.toLocaleString()}</span>
      <span className="global-shot-counter__sub">{t('footer.shotsDialled')}</span>
      <style>{`
        .global-shot-counter {
          display: flex;
          align-items: baseline;
          justify-content: center;
          gap: 6px;
          padding: 10px 16px 4px;
          font-size: 11px;
          color: var(--text-tertiary);
          letter-spacing: 0.2px;
          line-height: 1.4;
          text-align: center;
        }
        .global-shot-counter__num {
          font-family: var(--font-brand);
          font-size: 14px;
          font-weight: 600;
          color: var(--copper-deep);
          font-variant-numeric: tabular-nums;
          letter-spacing: -0.2px;
        }
        .global-shot-counter__sub {
          font-style: italic;
        }
      `}</style>
    </div>
  )
}
