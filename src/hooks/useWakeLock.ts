import { useEffect, useRef } from 'react'

/**
 * Holds a Screen Wake Lock while `enabled` is true and the tab is visible.
 * Auto-releases on tab hide, re-acquires on tab show. Cleans up on unmount.
 *
 * Browser support: Chrome, Edge, Safari 16.4+, most Android WebViews.
 * iOS standalone PWA: works from iOS 16.4. Older iOS: silently no-ops.
 * Inside Capacitor on native iOS/Android the WebView keeps the screen on while
 * the app is foregrounded anyway. For belt-and-braces native control, install
 * @capacitor-community/keep-awake and wire it in.
 */
export function useWakeLock(enabled: boolean) {
  const sentinelRef = useRef<WakeLockSentinel | null>(null)

  useEffect(() => {
    if (!enabled) return

    let cancelled = false

    async function request() {
      if (cancelled) return
      if (typeof document === 'undefined' || document.visibilityState !== 'visible') return
      const anyNav = navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinel> } }
      if (!anyNav.wakeLock?.request) return
      try {
        const sentinel = await anyNav.wakeLock.request('screen')
        if (cancelled) {
          sentinel.release().catch(() => {})
          return
        }
        sentinelRef.current = sentinel
        // Native release (tab hidden, system policy). We'll re-acquire on show.
        sentinel.addEventListener('release', () => { sentinelRef.current = null })
      } catch {
        // Older browsers / iOS pre-16.4 silently no-op. Capacitor's native
        // WebView keeps the screen on while foregrounded anyway.
      }
    }

    function release() {
      const s = sentinelRef.current
      sentinelRef.current = null
      if (s) s.release().catch(() => {})
    }

    function onVisibility() {
      if (document.visibilityState === 'visible') request()
      else release()
    }

    request()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      release()
    }
  }, [enabled])
}

// Minimal WakeLockSentinel typing (DOM lib varies)
type WakeLockSentinel = {
  release: () => Promise<void>
  addEventListener: (event: 'release', cb: () => void) => void
}
