import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from '../hooks/useTranslation'
import { consentState, setCommunityChoice, CONSENT_EVENT } from '../lib/analytics'

const OPT_OUT_KEY = 'analyticsOptOut'

export function useConsent() {
  return {
    hasConsented: typeof localStorage !== 'undefined' && localStorage.getItem(OPT_OUT_KEY) !== 'true',
  }
}

/**
 * One-time, opt-in choice for the anonymous community dataset and analytics (audit
 * brewmie-11). Shown to EVERY user whose consentState() is 'pending', in every region,
 * including existing users the old code silently consented. Nothing is shared before
 * the answer. The Setup switch changes the same state later.
 */
export function ConsentBanner() {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    let id: ReturnType<typeof setTimeout> | undefined
    const sync = () => {
      if (id) { clearTimeout(id); id = undefined }
      if (consentState() !== 'pending') { setVisible(false); return }
      id = setTimeout(() => setVisible(true), 2200)
    }
    sync()
    // The Setup switch answers the same question; keep the banner in step with it.
    window.addEventListener(CONSENT_EVENT, sync)
    return () => { if (id) clearTimeout(id); window.removeEventListener(CONSENT_EVENT, sync) }
  }, [])

  if (!visible) return null

  function acknowledge() {
    setCommunityChoice(true)
    setVisible(false)
  }

  function optOut() {
    setCommunityChoice(false)
    setVisible(false)
  }

  return createPortal(
    <div className="cb-toast" role="dialog" aria-label={t('consent.ariaLabel')}>
      <p className="cb-toast__body">{t('consent.shareBody')}</p>
      <div className="cb-toast__actions">
        <button className="cb-toast__ok" onClick={acknowledge} type="button">
          {t('consent.shareAllow')}
        </button>
        <button className="cb-toast__opt" onClick={optOut} type="button">
          {t('consent.shareDecline')}
        </button>
      </div>

      <style>{`
        .cb-toast {
          position: fixed;
          left: 12px;
          right: 12px;
          bottom: calc(80px + env(safe-area-inset-bottom));
          z-index: 110;
          background: rgba(20, 18, 14, 0.92);
          color: #fff;
          border-radius: 14px;
          padding: 14px 16px;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          display: flex;
          flex-direction: column;
          gap: 10px;
          max-width: 480px;
          margin: 0 auto;
          animation: cbSlide 0.28s cubic-bezier(0.32, 0.72, 0, 1);
        }
        @keyframes cbSlide {
          from { transform: translateY(20px); opacity: 0; }
          to   { transform: translateY(0); opacity: 1; }
        }
        .cb-toast__body {
          font-size: 13px;
          line-height: 1.5;
          margin: 0;
          color: rgba(255, 255, 255, 0.92);
        }
        .cb-toast__actions {
          display: flex;
          gap: 8px;
          align-items: center;
        }
        .cb-toast__ok {
          background: var(--accent-green);
          color: #fff;
          border: none;
          padding: 8px 16px;
          border-radius: 9999px;
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.2px;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
        }
        .cb-toast__opt {
          background: transparent;
          color: rgba(255, 255, 255, 0.7);
          border: none;
          padding: 8px 4px;
          font-size: 12px;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
        }
        .cb-toast__opt:active { color: #fff; }
      `}</style>
    </div>,
    document.body
  )
}
