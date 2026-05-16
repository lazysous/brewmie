import type { AppTab } from '../types'
import { useTranslation } from '../hooks/useTranslation'

interface BottomNavProps {
  activeTab: AppTab
  onTabChange: (tab: AppTab) => void
}

// ─── SVG icons ────────────────────────────────────────────────────────────────

function SetupIcon({ active }: { active: boolean }) {
  // Use stroke wrench in both states; only the colour changes. Keeps weight consistent with other tabs.
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  )
}

function BrewIcon({ active }: { active: boolean }) {
  return active ? (
    // Filled cup for active state
    <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18 8h1a3 3 0 0 1 0 6h-1v1a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5V8h15zm1 2v4a1 1 0 0 0 0-4zM6 3a1 1 0 0 1 1 1v1a1 1 0 0 1-2 0V4a1 1 0 0 1 1-1zm4 0a1 1 0 0 1 1 1v1a1 1 0 0 1-2 0V4a1 1 0 0 1 1-1zm4 0a1 1 0 0 1 1 1v1a1 1 0 0 1-2 0V4a1 1 0 0 1 1-1z" />
    </svg>
  ) : (
    // Stroke cup for inactive
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 8h1a4 4 0 1 1 0 8h-1" />
      <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z" />
      <line x1="6" y1="2" x2="6" y2="4" />
      <line x1="10" y1="2" x2="10" y2="4" />
      <line x1="14" y1="2" x2="14" y2="4" />
    </svg>
  )
}

function InsightsIcon({ active }: { active: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  )
}

// ─── Tab config ───────────────────────────────────────────────────────────────

interface TabConfig {
  id: AppTab
  labelKey: string
  isCta: boolean
}

const TABS: TabConfig[] = [
  { id: 'setup', labelKey: 'nav.setup', isCta: false },
  { id: 'brew', labelKey: 'nav.brew', isCta: true },
  { id: 'insights', labelKey: 'nav.insights', isCta: false },
]

// ─── Component ────────────────────────────────────────────────────────────────

export function BottomNav({ activeTab, onTabChange }: BottomNavProps) {
  const { t } = useTranslation()
  return (
    <nav className="bottom-nav" aria-label={t('nav.mainNav')}>
      {TABS.map((tab) => {
        const isActive = activeTab === tab.id
        const label = t(tab.labelKey)

        if (tab.isCta) {
          return (
            <button
              key={tab.id}
              className={[
                'bottom-nav__brew-btn',
                isActive ? 'bottom-nav__brew-btn--active' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => onTabChange(tab.id)}
              aria-current={isActive ? 'page' : undefined}
              aria-label={label}
            >
              <BrewIcon active={isActive} />
            </button>
          )
        }

        return (
          <button
            key={tab.id}
            className={[
              'bottom-nav__tab',
              isActive ? 'bottom-nav__tab--active' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => onTabChange(tab.id)}
            aria-current={isActive ? 'page' : undefined}
            aria-label={label}
          >
            <span className="bottom-nav__icon">
              {tab.id === 'setup' && <SetupIcon active={isActive} />}
              {tab.id === 'insights' && <InsightsIcon active={isActive} />}
            </span>
            {isActive && <span className="bottom-nav__dot" aria-hidden="true" />}
          </button>
        )
      })}

      <style>{`
        .bottom-nav {
          position: relative;
          display: flex;
          align-items: center;
          height: calc(72px + var(--safe-bottom));
          padding-bottom: var(--safe-bottom);
          background: linear-gradient(180deg, rgba(250,247,242,0.7) 0%, var(--cream) 60%);
          backdrop-filter: blur(6px);
          -webkit-backdrop-filter: blur(6px);
          border-top: 1px solid rgba(184, 116, 74, 0.12);
          box-shadow: 0 -2px 14px rgba(60, 40, 20, 0.05);
          flex-shrink: 0;
          z-index: 10;
        }

        /* Side tabs */
        .bottom-nav__tab {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 5px;
          height: 100%;
          padding: 0 4px;
          border: none;
          background: none;
          cursor: pointer;
          color: #8A857C;
          -webkit-tap-highlight-color: transparent;
          outline: none;
          transition: color 0.2s ease-out;
          position: relative;
        }

        .bottom-nav__tab:active {
          transform: scale(0.93);
          transition: transform 0.1s ease-out;
        }

        .bottom-nav__tab--active {
          color: var(--accent-green);
        }

        .bottom-nav__icon {
          display: flex;
          align-items: center;
          justify-content: center;
          line-height: 0;
          transition: transform 0.2s ease-out;
        }

        /* Active underline dot */
        .bottom-nav__dot {
          position: absolute;
          bottom: 10px;
          left: 50%;
          transform: translateX(-50%);
          width: 3px;
          height: 3px;
          border-radius: var(--radius-full);
          background: var(--accent-green);
        }

        /* ── Brew FAB ─── */
        .bottom-nav__brew-btn {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          border: none;
          background: none;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
          outline: none;
          /* Push the circle up above the bar */
          padding-bottom: calc(var(--safe-bottom) + 10px);
        }

        .bottom-nav__brew-btn > svg {
          display: block;
          width: 58px;
          height: 58px;
          padding: 14px;
          border-radius: var(--radius-full);
          background: linear-gradient(180deg, #7A9A6A 0%, #5F834F 100%);
          color: var(--white);
          box-shadow:
            0 0 0 4px var(--cream),
            inset 0 1px 0 rgba(255, 255, 255, 0.20),
            0 2px 6px rgba(60, 40, 20, 0.14),
            0 8px 22px rgba(107, 142, 92, 0.36);
          transition: background 0.2s ease-out, box-shadow 0.2s ease-out, transform 0.2s ease-out;
          /* Lift above nav surface */
          margin-bottom: -8px;
          position: relative;
        }

        .bottom-nav__brew-btn:active > svg {
          transform: scale(0.93);
          transition: transform 0.1s ease-out;
        }

        .bottom-nav__brew-btn--active > svg {
          background: #5C7E4D;
          box-shadow: 0 3px 10px rgba(60, 40, 20, 0.12), 0 8px 22px rgba(107, 142, 92, 0.36);
        }
      `}</style>
    </nav>
  )
}
