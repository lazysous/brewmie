// Premium sheet: store-based ownership, optional sign-in, price placeholder + retry
// (audit brewmie-16/-17/-18). Characterises the native branch.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import React from 'react'

const iap = vi.hoisted(() => ({
  price: null as string | null,
  purchasePremium: vi.fn(async () => ({ ok: false, cancelled: true })),
  restorePurchases: vi.fn(async () => undefined),
  refreshPremiumPrice: vi.fn(async () => null as string | null),
}))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' } }))
vi.mock('../src/lib/analytics', () => ({ track: vi.fn(), getBundleVersion: () => '1.1.3' }))
vi.mock('../src/lib/supabase', () => ({ signInWithApple: vi.fn(), signInWithGoogle: vi.fn() }))
vi.mock('../src/lib/iap', () => ({
  purchasePremium: iap.purchasePremium,
  restorePurchases: iap.restorePurchases,
  getPremiumPriceDisplay: () => iap.price,
  refreshPremiumPrice: iap.refreshPremiumPrice,
}))
vi.mock('../src/hooks/useSale', () => ({ useSale: () => false }))
vi.mock('../src/hooks/useTranslation', async () => {
  const { translate } = await import('../src/lib/i18n')
  const en = (await import('../public/translations/en.json')).default as import('../src/lib/i18n').TranslationDict
  return { useTranslation: () => ({ t: (k: string, p?: Record<string, string | number>) => translate(k, p, en, en), locale: 'en', setLocale: () => {}, isReady: true }) }
})

import { PremiumModal } from '../src/components/PremiumModal'

beforeEach(() => { iap.price = null; vi.clearAllMocks() })
afterEach(() => cleanup())

describe('Premium sheet signed out (native)', () => {
  it('Buy and Restore are usable without signing in', async () => {
    render(<PremiumModal open onClose={() => {}} isSignedIn={false} isPremium={false} />)
    const buy = screen.getByText('Unlock Premium').closest('button')!
    expect(buy.disabled).toBe(false)
    fireEvent.click(buy)
    await waitFor(() => expect(iap.purchasePremium).toHaveBeenCalledTimes(1))
    const restore = screen.getByText('Restore Purchases') as HTMLButtonElement
    fireEvent.click(restore)
    await waitFor(() => expect(iap.restorePurchases).toHaveBeenCalledTimes(1))
  })

  it('sign-in stays available as an optional step, and signed in hides it', () => {
    const { unmount } = render(<PremiumModal open onClose={() => {}} isSignedIn={false} isPremium={false} />)
    expect(screen.getByText('Sign in with Apple')).toBeTruthy()
    unmount()
    render(<PremiumModal open onClose={() => {}} isSignedIn isPremium={false} />)
    expect(screen.queryByText('Sign in with Apple')).toBeNull()
  })

  it('explains store-based ownership, not account linking', () => {
    render(<PremiumModal open onClose={() => {}} isSignedIn={false} isPremium={false} />)
    const clone = document.querySelector('.pm-sheet')!.cloneNode(true) as HTMLElement
    clone.querySelectorAll('style').forEach((n) => n.remove())
    const text = clone.textContent ?? ''
    expect(text).toContain('Premium belongs to your App Store or Google Play account')
    expect(text).toContain('Restore purchases')
    expect(text).not.toMatch(/follows you|link your/i)
    expect(text).not.toContain('—')
  })
})

describe('Premium sheet price (native)', () => {
  it('no introductory-offer badge', () => {
    iap.price = 'AU$3.99 AUD'
    render(<PremiumModal open onClose={() => {}} isSignedIn isPremium={false} />)
    expect(screen.queryByText('Introductory offer')).toBeNull()
    expect(screen.getByText('AU$3.99 AUD')).toBeTruthy()
    expect(screen.queryByTestId('price-skeleton')).toBeNull()
    expect(screen.queryByTestId('price-retry')).toBeNull()
  })

  it('no price: skeleton plus a retry that re-runs the price fetch and shows the price', async () => {
    iap.refreshPremiumPrice.mockResolvedValueOnce('AU$3.99 AUD')
    render(<PremiumModal open onClose={() => {}} isSignedIn isPremium={false} />)
    expect(screen.getByTestId('price-skeleton')).toBeTruthy()
    fireEvent.click(screen.getByTestId('price-retry'))
    await screen.findByText('AU$3.99 AUD')
    expect(iap.refreshPremiumPrice).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('price-skeleton')).toBeNull()
  })

  it('a retry that still gets no price says so and stays retryable', async () => {
    render(<PremiumModal open onClose={() => {}} isSignedIn isPremium={false} />)
    fireEvent.click(screen.getByTestId('price-retry'))
    await screen.findByText('The store has not sent the price yet.')
    expect((screen.getByTestId('price-retry') as HTMLButtonElement).disabled).toBe(false)
  })
})
