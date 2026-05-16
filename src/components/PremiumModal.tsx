import { useEffect } from 'react'
import { useTranslation } from '../hooks/useTranslation'
import { setTierOverride } from '../hooks/useTier'
import { track } from '../lib/analytics'

interface PremiumModalProps {
  open: boolean
  onClose: () => void
  trigger?: 'grinder' | 'tamper' | 'beans' | 'history' | 'benchmarks' | null
  // True when the user is signed in. Premium requires sign-in (same model as
  // Lazy Sous) — if false, the modal routes to sign-in first.
  isSignedIn?: boolean
  onSignInRequired?: () => void
}

const TRIGGER_KEYS: Record<NonNullable<PremiumModalProps['trigger']>, string> = {
  grinder: 'premium.triggerGrinder',
  tamper: 'premium.triggerTamper',
  beans: 'premium.triggerBeans',
  history: 'premium.triggerHistory',
  benchmarks: 'premium.triggerBenchmarks',
}

export function PremiumModal({ open, onClose, trigger, isSignedIn = true, onSignInRequired }: PremiumModalProps) {
  const { t } = useTranslation()
  useEffect(() => {
    if (open) track('premium_modal_open', { trigger: trigger ?? 'none', signed_in: isSignedIn })
  }, [open, trigger, isSignedIn])
  if (!open) return null

  // In dev, the CTAs just flip the override so designers can test without a real purchase.
  const isDev = import.meta.env.DEV
  const handleBuyBrewmie = () => {
    track('premium_cta_click', { product: 'brewmie_only', signed_in: isSignedIn })
    if (!isSignedIn && onSignInRequired) {
      onSignInRequired()
      onClose()
      return
    }
    if (isDev) setTierOverride('premium')
    track('premium_purchased', { product: 'brewmie_only' })
    onClose()
  }
  const handleBuyBundle = () => {
    track('premium_cta_click', { product: 'bundle', signed_in: isSignedIn })
    if (!isSignedIn && onSignInRequired) {
      onSignInRequired()
      onClose()
      return
    }
    if (isDev) setTierOverride('premium')
    track('premium_purchased', { product: 'bundle' })
    onClose()
  }

  return (
    <div className="pm-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="pm-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="pm-handle" aria-hidden="true" />

        <div className="pm-eyebrow">
          <span className="pm-eyebrow__mark" aria-hidden="true" />
          {t('premium.eyebrow')}
        </div>

        <h2 className="pm-title">{t('premium.title')}</h2>

        {trigger && (
          <p className="pm-trigger">{t(TRIGGER_KEYS[trigger])}</p>
        )}

        <ul className="pm-list">
          <li className="pm-list__item">
            <span className="pm-list__check" aria-hidden="true">✓</span>
            <div className="pm-list__text">
              <span className="pm-list__head">{t('premium.feature1Head')}</span>
              <span className="pm-list__sub">{t('premium.feature1Sub')}</span>
            </div>
          </li>
          <li className="pm-list__item">
            <span className="pm-list__check" aria-hidden="true">✓</span>
            <div className="pm-list__text">
              <span className="pm-list__head">{t('premium.feature2Head')}</span>
              <span className="pm-list__sub">{t('premium.feature2Sub')}</span>
            </div>
          </li>
          <li className="pm-list__item">
            <span className="pm-list__check" aria-hidden="true">✓</span>
            <div className="pm-list__text">
              <span className="pm-list__head">{t('premium.feature3Head')}</span>
              <span className="pm-list__sub">{t('premium.feature3Sub')}</span>
            </div>
          </li>
        </ul>

        <div className="pm-buttons">
          <button className="pm-btn pm-btn--primary" onClick={handleBuyBrewmie} type="button">
            <span className="pm-btn__label">{t('premium.ctaBrewmie')}</span>
            <span className="pm-btn__price">{t('premium.priceBrewmie')}</span>
          </button>
          <button className="pm-btn pm-btn--bundle" onClick={handleBuyBundle} type="button">
            <span className="pm-btn__label">{t('premium.ctaBundle')}</span>
            <span className="pm-btn__price">{t('premium.priceBundle')}</span>
          </button>
        </div>

        {isDev && (
          <p className="pm-devnote">{t('premium.devNote')}</p>
        )}
      </div>

      <style>{`
        .pm-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.5);
          z-index: 200;
          display: flex;
          align-items: flex-end;
          justify-content: center;
        }
        .pm-sheet {
          background: var(--cream);
          border-radius: 24px 24px 0 0;
          padding: 14px 24px 36px;
          width: 100%;
          max-width: 460px;
          animation: pmSlideUp 0.28s cubic-bezier(0.32, 0.72, 0, 1);
        }
        @keyframes pmSlideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        .pm-handle {
          width: 36px;
          height: 4px;
          background: var(--border);
          border-radius: 9999px;
          margin: 0 auto 18px;
        }

        .pm-eyebrow {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 1.4px;
          text-transform: uppercase;
          color: var(--copper-deep);
          margin-bottom: 8px;
        }
        .pm-eyebrow__mark {
          display: inline-block;
          width: 18px;
          height: 1.5px;
          background: var(--copper);
        }

        .pm-title {
          font-family: var(--font-brand);
          font-size: 30px;
          font-weight: 600;
          color: var(--text-primary);
          margin: 0 0 6px;
          line-height: 1.1;
          letter-spacing: -0.3px;
        }
        .pm-trigger {
          font-size: 13px;
          color: var(--text-tertiary);
          margin: 0 0 18px;
          line-height: 1.5;
        }

        .pm-list {
          list-style: none;
          padding: 0;
          margin: 4px 0 22px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .pm-list__item {
          display: flex;
          align-items: flex-start;
          gap: 10px;
        }
        .pm-list__check {
          width: 22px;
          height: 22px;
          border-radius: 50%;
          background: var(--accent-green);
          color: #fff;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          font-weight: 800;
          flex-shrink: 0;
          margin-top: 2px;
        }
        .pm-list__text {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .pm-list__head {
          font-size: 14px;
          font-weight: 700;
          color: var(--text-primary);
          line-height: 1.3;
        }
        .pm-list__sub {
          font-size: 12px;
          color: var(--text-tertiary);
          line-height: 1.4;
        }

        .pm-buttons {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .pm-btn {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 18px;
          border-radius: 14px;
          border: none;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
          transition: transform 0.1s ease, box-shadow 0.15s ease;
        }
        .pm-btn:active { transform: scale(0.985); }
        .pm-btn--primary {
          background: var(--accent-green);
          color: #fff;
          box-shadow: 0 6px 14px rgba(107, 142, 92, 0.22);
        }
        .pm-btn--bundle {
          background: linear-gradient(180deg, #2C261E 0%, #221C15 100%);
          color: #fff;
          box-shadow: 0 6px 14px rgba(34, 28, 21, 0.22);
        }
        .pm-btn__label {
          font-size: 14px;
          font-weight: 700;
          letter-spacing: 0.1px;
        }
        .pm-btn__price {
          font-size: 14px;
          font-weight: 800;
          font-variant-numeric: tabular-nums;
        }
        .pm-btn--bundle .pm-btn__price { color: #E5B891; }

        .pm-devnote {
          font-size: 11px;
          color: var(--text-tertiary);
          text-align: center;
          margin: 12px 0 0;
          font-style: italic;
        }
      `}</style>
    </div>
  )
}
