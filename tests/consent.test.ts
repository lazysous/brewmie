// Consent gate (audit brewmie-19/20): nothing leaves the device for EU/UK users before
// the banner is answered, and an opt-out always wins.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

function tz(zone: string) {
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({ timeZone: zone } as Intl.ResolvedDateTimeFormatOptions)
}

beforeEach(() => { localStorage.clear(); vi.resetModules() })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

describe('consentState()', () => {
  it('is pending for an EU/UK timezone with the banner unanswered', async () => {
    tz('Europe/London')
    const { consentState } = await import('../src/lib/analytics')
    expect(consentState()).toBe('pending')
  })

  it('is granted for EU/UK once the banner was answered with consent', async () => {
    tz('Europe/Berlin')
    localStorage.setItem('hasSeenConsent', 'true')
    localStorage.setItem('analyticsOptOut', 'false')
    const { consentState } = await import('../src/lib/analytics')
    expect(consentState()).toBe('granted')
  })

  it('is denied after an opt-out, in any region and whether or not the banner was seen', async () => {
    tz('Europe/Paris')
    localStorage.setItem('analyticsOptOut', 'true')
    const { consentState } = await import('../src/lib/analytics')
    expect(consentState()).toBe('denied')
    vi.restoreAllMocks()
    tz('Australia/Melbourne')
    expect(consentState()).toBe('denied')
  })

  it('is granted outside the EU/UK without any banner', async () => {
    tz('Australia/Melbourne')
    const { consentState } = await import('../src/lib/analytics')
    expect(consentState()).toBe('granted')
  })
})

describe('track()', () => {
  async function load() {
    vi.stubEnv('VITE_GA_ID', 'G-TEST')
    return import('../src/lib/analytics')
  }

  it('does nothing while consent is pending: no gtag script, no dataLayer', async () => {
    tz('Europe/London')
    const { track, trackScreen } = await load()
    track('x'); trackScreen('brew')
    expect(window.dataLayer).toBeUndefined()
    expect(document.head.querySelector('script[src*="googletagmanager"]')).toBeNull()
  })

  it('does nothing when opted out', async () => {
    tz('Australia/Melbourne')
    localStorage.setItem('analyticsOptOut', 'true')
    const { track } = await load()
    track('x')
    expect(window.dataLayer).toBeUndefined()
    expect(document.head.querySelector('script[src*="googletagmanager"]')).toBeNull()
  })

  it('loads gtag and records once consent is granted', async () => {
    tz('Europe/London')
    localStorage.setItem('hasSeenConsent', 'true')
    const { track } = await load()
    track('x')
    expect(document.head.querySelector('script[src*="googletagmanager"]')).not.toBeNull()
    expect(window.dataLayer?.length).toBeGreaterThan(0)
  })
})
