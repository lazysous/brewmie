import type { AppTab } from '../types'

interface BottomNavProps {
  activeTab: AppTab
  onTabChange: (tab: AppTab) => void
}

// ─── SVG icons ────────────────────────────────────────────────────────────────

function SetupIcon({ active }: { active: boolean }) {
  return active ? (
    // Filled wrench for active state
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M15.5 2.1a6 6 0 0 0-5.78 7.67L2.44 17.05A2.5 2.5 0 1 0 6 20.6l7.23-7.28A6 6 0 1 0 15.5 2.1zm0 10a4 4 0 1 1 0-8 4 4 0 0 1 0 8zM4.5 20a1 1 0 1 1 0-2 1 1 0 0 1 0 2z" />
    </svg>
  ) : (
    // Stroke wrench for inactive
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
  return active ? (
    // Filled bars for active state
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="16" y="4" width="4" height="16" rx="1" />
      <rect x="10" y="9" width="4" height="11" rx="1" />
      <rect x="4" y="13" width="4" height="7" rx="1" />
    </svg>
  ) : (
    // Stroke bars for inactive
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  )
}

// ─── Tab config ───────────────────────────────────────────────────────────────

interface TabConfig {
  id: AppTab
  label: string
  isCta: boolean
}

const TABS: TabConfig[] = [
  { id: 'setup', label: 'Setup', isCta: false },
  { id: 'brew', label: 'Brew', isCta: true },
  { id: 'insights', label: 'Insights', isCta: false },
]

// ─── Component ────────────────────────────────────────────────────────────────

export function BottomNav({ activeTab, onTabChange }: BottomNavProps) {
  return (
    <nav className="bottom-nav" aria-label="Main navigation">
      {TABS.map((tab) => {
        const isActive = activeTab === tab.id

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
              aria-label={tab.label}
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
            aria-label={tab.label}
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
          background: var(--white);
          border-top: 1px solid var(--border-light);
          box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.06);
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
          color: var(--grey-light);
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
          color: var(--black);
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
          width: 56px;
          height: 56px;
          padding: 14px;
          border-radius: var(--radius-full);
          background: var(--accent-green);
          color: var(--white);
          box-shadow: 0 4px 16px rgba(45, 80, 22, 0.45);
          transition: background 0.2s ease-out, box-shadow 0.2s ease-out, transform 0.2s ease-out;
          /* Lift above nav surface */
          margin-bottom: -10px;
          position: relative;
        }

        .bottom-nav__brew-btn:active > svg {
          transform: scale(0.93);
          transition: transform 0.1s ease-out;
        }

        .bottom-nav__brew-btn--active > svg {
          background: #3a6b1e;
          box-shadow: 0 6px 20px rgba(45, 80, 22, 0.6);
        }
      `}</style>
    </nav>
  )
}
