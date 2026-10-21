// Google Analytics 4 wrapper.
//
// Loads gtag.js on first call, no-ops if VITE_GA_ID isn't set. All events are
// stripped of user-identifying data — we never send display_name, user_id,
// raw shot timestamps, or location. Just aggregate behavioural signals that
// tell us what's working in the product.

import { isEURegion } from './region'

const GA_ID = import.meta.env.VITE_GA_ID as string | undefined
let loaded = false
let loading = false
// The OTA bundle this session runs (set from main.tsx via the updater; 'web' on the
// web build, 'builtin' on a store binary with no OTA applied). Every event carries it
// so a bad bundle shows up as a version in the analytics, not as a mystery.
let bundleVersion = 'web'
export function setBundleVersion(v: string) { bundleVersion = v || 'unknown' }
export function getBundleVersion() { return bundleVersion }

function userOptedOut(): boolean {
  if (typeof localStorage === 'undefined') return false
  return localStorage.getItem('analyticsOptOut') === 'true'
}

/**
 * Whether anything may leave the device (audit brewmie-11): one switch, one state, for the
 * anonymous community dataset AND Google Analytics. Opt-in for everyone.
 *  - 'denied'  : analyticsOptOut === 'true' (an explicit opt-out always wins), or the
 *                person chose "no" (COMMUNITY_CHOICE_KEY === 'denied').
 *  - 'granted' : the person chose "yes" (COMMUNITY_CHOICE_KEY === 'granted'), or they
 *                answered the old EU/UK banner (hasSeenConsent set in an EU/UK timezone).
 *  - 'pending' : everything else, in every region. That includes a non-EU user the old
 *                code silently consented (hasSeenConsent set by the default, no choice
 *                key): they are asked once.
 * Analytics and community-dataset writes proceed only on 'granted'.
 */
export type ConsentState = 'granted' | 'denied' | 'pending'
export const COMMUNITY_CHOICE_KEY = 'brewmie_community_choice'
export const CONSENT_EVENT = 'brewmie:consent'

function readKey(k: string): string | null {
  try { return typeof localStorage !== 'undefined' ? localStorage.getItem(k) : null } catch { return null }
}

export function consentState(): ConsentState {
  if (userOptedOut()) return 'denied'
  const choice = readKey(COMMUNITY_CHOICE_KEY)
  if (choice === 'denied') return 'denied'
  if (choice === 'granted') return 'granted'
  // Legacy: only an EU/UK answer to the old banner was ever an explicit choice.
  if (isEURegion() && readKey('hasSeenConsent')) return 'granted'
  return 'pending'
}

/** Record the person's choice (banner or Setup switch). Keeps the legacy keys in step. */
export function setCommunityChoice(granted: boolean) {
  try {
    localStorage.setItem(COMMUNITY_CHOICE_KEY, granted ? 'granted' : 'denied')
    localStorage.setItem('hasSeenConsent', 'true')
    localStorage.setItem('analyticsOptOut', granted ? 'false' : 'true')
  } catch { /* ignore */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CONSENT_EVENT))
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
  if (consentState() !== 'granted') return
  loadGtag()
  window.gtag?.('event', event, { bundle_version: bundleVersion, ...(params ?? {}) })
}

export function trackScreen(name: 'brew' | 'setup' | 'insights') {
  track('screen_view', { screen_name: name })
}
