// The gold "Sale price" badge on the Premium sheet (src/components/PremiumModal.tsx).
// Native, signed in, not premium: the branch that shows the price. With the flag off
// there is no badge (the introductory offer was removed, audit brewmie-18); with it on the
// gold badge appears and the button still quotes the live store price; the sheet opens
// before the flag has landed and settles once it does.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import React from 'react'

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' } }))
vi.mock('../src/lib/analytics', () => ({ track: vi.fn(), getBundleVersion: () => '1.1.3' }))
vi.mock('../src/lib/supabase', () => ({ signInWithApple: vi.fn(), signInWithGoogle: vi.fn() }))
vi.mock('../src/lib/iap', () => ({
  purchasePremium: vi.fn(async () => ({ ok: true })),
  restorePurchases: vi.fn(async () => undefined),
  getPremiumPriceDisplay: () => 'AU$3.99 AUD',
  refreshPremiumPrice: vi.fn(async () => 'AU$3.99 AUD'),
}))
vi.mock('../src/hooks/useTranslation', async () => {
  const { translate } = await import('../src/lib/i18n')
  const en = (await import('../public/translations/en.json')).default as import('../src/lib/i18n').TranslationDict
  return { useTranslation: () => ({ t: (k: string, p?: Record<string, string | number>) => translate(k, p, en, en), locale: 'en', setLocale: () => {}, isReady: true }) }
})

import { PremiumModal } from '../src/components/PremiumModal'
import { _resetSaleCache } from '../src/lib/sale'

const FUTURE = '2099-01-01T00:00:00Z'

function open() {
  return render(<PremiumModal open onClose={() => {}} isSignedIn isPremium={false} trigger="history" />)
}

beforeEach(() => { _resetSaleCache() })
// globals is false in vitest.config.ts, so RTL does not unmount between tests on
// its own; the sheet portals into document.body and would pile up.
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('PremiumModal sale badge', () => {
  it('flag off: no badge at all, no sale badge, live price on the button', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ active: false, until: null }) })))
    open()
    expect(screen.queryByText('Introductory offer')).toBeNull()
    expect(screen.queryByTestId('sale-badge')).toBeNull()
    expect(screen.getByText('AU$3.99 AUD')).toBeTruthy()
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    expect(screen.queryByTestId('sale-badge')).toBeNull()
  })

  it('flag on: the gold "Sale price" badge appears once the flag lands', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ active: true, until: FUTURE }) })))
    open()
    expect(screen.queryByTestId('sale-badge')).toBeNull()
    const badge = await screen.findByTestId('sale-badge')
    expect(badge.textContent).toBe('Sale price')
    expect(badge.className).toContain('pm-intro__badge--sale')
    expect(screen.queryByText('Introductory offer')).toBeNull()
    expect(screen.getByText('AU$3.99 AUD')).toBeTruthy()
  })

  it('a flag that fails to load leaves the sheet usable with no sale badge', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    open()
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    expect(screen.getByText('Unlock Premium')).toBeTruthy()
    expect(screen.queryByTestId('sale-badge')).toBeNull()
  })

  it('an expired flag shows no sale badge even though it says active', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ active: true, until: '2000-01-01T00:00:00Z' }) })))
    open()
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    expect(screen.queryByTestId('sale-badge')).toBeNull()
    expect(screen.queryByText('Introductory offer')).toBeNull()
  })
})
