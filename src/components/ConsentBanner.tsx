import { useEffect, useState } from 'react'
import { useTranslation } from '../hooks/useTranslation'

const SEEN_KEY = 'hasSeenConsent'
const OPT_OUT_KEY = 'analyticsOptOut'

export function useConsent() {
  return {
    hasConsented: typeof localStorage !== 'undefined' && localStorage.getItem(OPT_OUT_KEY) !== 'true',
  }
}

/**
 * GDPR-minimum consent banner. Shows ONLY for EU/UK timezone users on their
 * first visit. Everyone else is silently consented (the default).
 * Matches Lazy Sous's pattern. Anonymous shot data + GA are on by default; the
 * banner is informational + offers one tap to opt out for users in regions
 * that legally need the prompt.
 */
function isEURegion(): boolean {
  if (typeof Intl === 'undefined') return false
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''
    // EU member states + UK + Norway/Switzerland/Iceland (EEA) + Ceuta
    return tz.startsWith('Europe/') || tz === 'Africa/Ceuta' || tz === 'Atlantic/Canary' || tz === 'Atlantic/Madeira' || tz === 'Atlantic/Azores'
  } catch {
    return false
  }
}

export function ConsentBanner() {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (localStorage.getItem(SEEN_KEY)) return
    if (!isEURegion()) {
      // Non-EU: silently default to consented, no prompt.
      localStorage.setItem(SEEN_KEY, 'true')
      localStorage.setItem(OPT_OUT_KEY, 'false')
      return
    }
    // EU: show the small notice after the app has rendered.
    const id = setTimeout(() => setVisible(true), 2200)
    return () => clearTimeout(id)
  }, [])

  if (!visible) return null

  function acknowledge() {
    localStorage.setItem(SEEN_KEY, 'true')
    localStorage.setItem(OPT_OUT_KEY, 'false')
    setVisible(false)
  }

  function optOut() {
    localStorage.setItem(SEEN_KEY, 'true')
    localStorage.setItem(OPT_OUT_KEY, 'true')
    setVisible(false)
  }

  return (
    <div className="cb-toast" role="dialog" aria-label={t('consent.ariaLabel')}>
      <p className="cb-toast__body">{t('consent.body')}</p>
      <div className="cb-toast__actions">
        <button className="cb-toast__ok" onClick={acknowledge} type="button">
          {t('consent.allow')}
        </button>
        <button className="cb-toast__opt" onClick={optOut} type="button">
          {t('consent.decline')}
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
    </div>
  )
}
