// Google Analytics 4 wrapper.
//
// Loads gtag.js on first call, no-ops if VITE_GA_ID isn't set. All events are
// stripped of user-identifying data — we never send display_name, user_id,
// raw shot timestamps, or location. Just aggregate behavioural signals that
// tell us what's working in the product.

const GA_ID = import.meta.env.VITE_GA_ID as string | undefined
let loaded = false
let loading = false

function userOptedOut(): boolean {
  if (typeof localStorage === 'undefined') return false
  return localStorage.getItem('analyticsOptOut') === 'true'
}

declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: (...args: unknown[]) => void
  }
}

function loadGtag() {
  if (loaded || loading || !GA_ID || typeof window === 'undefined') return
  loading = true

  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`
  document.head.appendChild(script)

  window.dataLayer = window.dataLayer || []
  window.gtag = function gtag(...args: unknown[]) { window.dataLayer!.push(args) }
  window.gtag('js', new Date())
  window.gtag('config', GA_ID, {
    // Anonymize IPs (legal cover even though GA4 does this by default now).
    anonymize_ip: true,
    // Don't auto-track page views — we'll fire screen events explicitly so
    // SPA tab changes register as separate "screens".
    send_page_view: false,
    // Hard-disable the only GA4 features that would constitute "tracking"
    // under Apple's definition: Google Signals (links analytics with Google's
    // cross-site ad profile) and ad-personalization signals. With these off,
    // GA4 is purely first-party aggregate analytics — no ATT prompt needed.
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  })
  loaded = true
}

export function track(event: string, params?: Record<string, string | number | boolean>) {
  if (!GA_ID || typeof window === 'undefined') return
  if (userOptedOut()) return
  loadGtag()
  window.gtag?.('event', event, params ?? {})
}

export function trackScreen(name: 'brew' | 'setup' | 'insights') {
  track('screen_view', { screen_name: name })
}
