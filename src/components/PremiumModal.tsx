import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Capacitor } from '@capacitor/core'
import { useTranslation } from '../hooks/useTranslation'
import { setTierOverride } from '../hooks/useTier'
import { track } from '../lib/analytics'
import { signInWithApple, signInWithGoogle } from '../lib/supabase'

// Platform detection — read once at module load so render is sync.
const NATIVE = Capacitor.isNativePlatform()
const PLATFORM: 'ios' | 'android' | 'web' = (() => {
  if (!NATIVE) return 'web'
  const p = Capacitor.getPlatform()
  return p === 'ios' ? 'ios' : 'android'
})()

interface PremiumModalProps {
  open: boolean
  onClose: () => void
  // Trigger is kept for analytics (which surface opened the modal), but no
  // longer shown to the user — restating "you tapped grinder" was redundant.
  trigger?: 'grinder' | 'tamper' | 'beans' | 'history' | 'benchmarks' | null
  isSignedIn?: boolean
  // Still accepted for API compatibility, but PremiumModal no longer opens
  // AuthModal on signed-out taps. Native goes straight to the platform
  // provider; web shows a store-only message.
  onSignInRequired?: () => void
}

export function PremiumModal({ open, onClose, trigger, isSignedIn = true }: PremiumModalProps) {
  const { t } = useTranslation()
  const [signingIn, setSigningIn] = useState(false)

  useEffect(() => {
    if (open) track('premium_modal_open', { trigger: trigger ?? 'none', signed_in: isSignedIn, platform: PLATFORM })
  }, [open, trigger, isSignedIn])

  if (!open) return null

  const isDev = import.meta.env.DEV

  // Run the purchase / trial activation step. On dev web with no real store
  // wired up, this flips the tier override so QA can keep testing.
  const completePurchase = () => {
    if (isDev) setTierOverride('premium')
    track('premium_purchased', { product: 'brewmie_only', platform: PLATFORM })
    onClose()
  }

  const handleNativeSignIn = async () => {
    track('premium_cta_click', { product: 'brewmie_only', signed_in: false, platform: PLATFORM })
    setSigningIn(true)
    try {
      const result = PLATFORM === 'ios'
        ? await signInWithApple()
        : await signInWithGoogle()
      if (result && 'error' in result && result.error) {
        // Cancelled or failed — stay on the modal silently.
        return
      }
      // Auth state listener in App.tsx will set the user; proceed with purchase.
      completePurchase()
    } catch {
      // Cancellation throws on some platforms. Stay put.
    } finally {
      setSigningIn(false)
    }
  }

  const handlePurchase = () => {
    track('premium_cta_click', { product: 'brewmie_only', signed_in: true, platform: PLATFORM })
    completePurchase()
  }

  // ── Body branches ──
  // 1. Web (signed-in or not): purchase is store-only; show app-only block.
  // 2. Native + signed-out: single CTA goes straight to platform sign-in.
  // 3. Native + signed-in: original buy flow.
  const webAppOnly = PLATFORM === 'web'

  return createPortal(
    <div className="pm-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="pm-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="pm-handle" aria-hidden="true" />

        <div className="pm-eyebrow">
          <span className="pm-eyebrow__mark" aria-hidden="true" />
          {t('premium.eyebrow')}
        </div>

        <h2 className="pm-title">{t('premium.title')}</h2>

        <ul className="pm-list">
          <li className="pm-list__item">
            <span className="pm-list__check" aria-hidden="true">✓</span>
            <span className="pm-list__head">{t('premium.feature1Head')}</span>
          </li>
          <li className="pm-list__item">
            <span className="pm-list__check" aria-hidden="true">✓</span>
            <span className="pm-list__head">{t('premium.feature2Head')}</span>
          </li>
          <li className="pm-list__item">
            <span className="pm-list__check" aria-hidden="true">✓</span>
            <span className="pm-list__head">{t('premium.feature3Head')}</span>
          </li>
        </ul>

        {webAppOnly ? (
          <div className="pm-applock">
            <p className="pm-applock__copy">{t('premium.webOnlyBody')}</p>
            <div className="pm-applock__stores">
              <a
                className="pm-store pm-store--apple"
                href={t('premium.appStoreUrl')}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => track('premium_store_click', { store: 'app_store' })}
              >
                <span className="pm-store__small">{t('premium.storeAppleSmall')}</span>
                <span className="pm-store__big">{t('premium.storeAppleBig')}</span>
              </a>
              <a
                className="pm-store pm-store--google"
                href={t('premium.playStoreUrl')}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => track('premium_store_click', { store: 'play_store' })}
              >
                <span className="pm-store__small">{t('premium.storeGoogleSmall')}</span>
                <span className="pm-store__big">{t('premium.storeGoogleBig')}</span>
              </a>
            </div>
          </div>
        ) : !isSignedIn ? (
          <button
            className="pm-btn pm-btn--primary"
            onClick={handleNativeSignIn}
            type="button"
            disabled={signingIn}
          >
            <span className="pm-btn__label">
              {PLATFORM === 'ios' ? t('premium.signInApple') : t('premium.signInGoogle')}
            </span>
          </button>
        ) : (
          <button className="pm-btn pm-btn--primary" onClick={handlePurchase} type="button">
            <span className="pm-btn__label">{t('premium.cta')}</span>
            <span className="pm-btn__price">{t('premium.priceBrewmie')}</span>
          </button>
        )}

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
          align-items: center;
          gap: 12px;
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
        }
        .pm-list__head {
          font-size: 15px;
          font-weight: 600;
          color: var(--text-primary);
          line-height: 1.3;
        }

        .pm-btn {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          padding: 16px 20px;
          border-radius: 14px;
          border: none;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
          transition: transform 0.1s ease, box-shadow 0.15s ease;
        }
        .pm-btn:active { transform: scale(0.985); }
        .pm-btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .pm-btn--primary {
          background: var(--accent-green);
          color: #fff;
          box-shadow: 0 6px 14px rgba(107, 142, 92, 0.22);
        }
        .pm-btn__label {
          font-size: 15px;
          font-weight: 700;
          letter-spacing: 0.2px;
        }
        .pm-btn__price {
          font-size: 15px;
          font-weight: 800;
          font-variant-numeric: tabular-nums;
        }

        .pm-applock {
          margin-top: 4px;
        }
        .pm-applock__copy {
          font-size: 14px;
          color: var(--text-secondary, var(--text-primary));
          line-height: 1.5;
          margin: 0 0 14px;
        }
        .pm-applock__stores {
          display: flex;
          flex-direction: row;
          gap: 10px;
        }
        .pm-store {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          justify-content: center;
          padding: 10px 14px;
          border-radius: 12px;
          text-decoration: none;
          -webkit-tap-highlight-color: transparent;
          transition: transform 0.1s ease, opacity 0.15s ease;
        }
        .pm-store:active { transform: scale(0.985); }
        .pm-store--apple {
          background: #221C15;
          color: #fff;
        }
        .pm-store--google {
          background: #2C261E;
          color: #fff;
        }
        .pm-store__small {
          font-size: 10px;
          letter-spacing: 0.6px;
          text-transform: uppercase;
          opacity: 0.78;
        }
        .pm-store__big {
          font-size: 15px;
          font-weight: 700;
          letter-spacing: 0.2px;
          margin-top: 2px;
        }

        .pm-devnote {
          font-size: 11px;
          color: var(--text-tertiary);
          text-align: center;
          margin: 12px 0 0;
          font-style: italic;
        }
      `}</style>
    </div>,
    document.body
  )
}
