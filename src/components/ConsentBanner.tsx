import { useState } from 'react'

const SEEN_KEY = 'hasSeenConsent'
const OPT_OUT_KEY = 'analyticsOptOut'

export function useConsent() {
  return {
    hasConsented: typeof localStorage !== 'undefined' && localStorage.getItem(OPT_OUT_KEY) !== 'true',
  }
}

export function ConsentBanner() {
  const [visible, setVisible] = useState(() => !localStorage.getItem(SEEN_KEY))

  if (!visible) return null

  function allow() {
    localStorage.setItem(SEEN_KEY, 'true')
    localStorage.setItem(OPT_OUT_KEY, 'false')
    setVisible(false)
  }

  function decline() {
    localStorage.setItem(SEEN_KEY, 'true')
    localStorage.setItem(OPT_OUT_KEY, 'true')
    setVisible(false)
  }

  return (
    <div className="cb-backdrop" role="dialog" aria-modal="true" aria-label="Data usage">
      <div className="cb-sheet">
        <div className="cb-handle" aria-hidden="true" />

        <p className="cb-title">Help us improve Brewmie</p>
        <p className="cb-body">
          Your shots are shared anonymously to improve recommendations for every user.
          No personal data, email, or account is ever included.
        </p>

        <div className="cb-actions">
          <button className="cb-allow" onClick={allow} type="button">
            Allow
          </button>
          <button className="cb-decline" onClick={decline} type="button">
            No thanks
          </button>
        </div>
      </div>

      <style>{`
        .cb-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.4);
          z-index: 110;
          display: flex;
          align-items: flex-end;
          justify-content: center;
          animation: fadeIn 0.2s ease-out both;
        }

        .cb-sheet {
          background: var(--white);
          border-radius: 20px 20px 0 0;
          padding: 12px 24px calc(36px + var(--safe-bottom));
          width: 100%;
          max-width: 428px;
          animation: slideUp 0.25s ease-out both;
        }

        .cb-handle {
          width: 36px;
          height: 4px;
          background: var(--border);
          border-radius: 9999px;
          margin: 0 auto 20px;
        }

        .cb-title {
          font-size: 18px;
          font-weight: 700;
          color: var(--text-primary);
          margin-bottom: 10px;
        }

        .cb-body {
          font-size: 14px;
          line-height: 1.55;
          color: var(--text-secondary);
          margin-bottom: 24px;
        }

        .cb-actions {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .cb-allow {
          height: 52px;
          background: linear-gradient(135deg, #2D5016 0%, #3a6b1e 100%);
          color: var(--white);
          border: none;
          border-radius: 14px;
          font-size: 15px;
          font-weight: 700;
          letter-spacing: 0.3px;
          cursor: pointer;
          transition: opacity 0.15s ease;
          -webkit-tap-highlight-color: transparent;
        }
        .cb-allow:active { opacity: 0.88; }

        .cb-decline {
          font-size: 13px;
          font-weight: 500;
          color: var(--text-tertiary);
          background: none;
          border: none;
          padding: 6px 0;
          cursor: pointer;
          text-align: center;
          -webkit-tap-highlight-color: transparent;
        }
        .cb-decline:active { color: var(--text-primary); }

        @keyframes slideUp {
          from { transform: translateY(100%); }
          to   { transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}
