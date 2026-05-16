import { useEffect, useState } from 'react'
import { fetchGlobalShotCount } from '../lib/supabase'
import { useTranslation } from '../hooks/useTranslation'

// Single line at the very bottom of the screen: "Brewmie has dialled in
// X,XXX espressos worldwide." Lets users know the algorithm is learning from
// a real cohort. Cached for ~60s; refreshes on tab focus.

export function GlobalShotCounter() {
  const { t } = useTranslation()
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    function refresh() {
      fetchGlobalShotCount().then((n) => {
        if (!cancelled && n !== null) setCount(n)
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

  if (count === null) return null

  return (
    <div className="global-shot-counter" role="status" aria-live="polite">
      <span className="global-shot-counter__num">{count.toLocaleString()}</span>
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
