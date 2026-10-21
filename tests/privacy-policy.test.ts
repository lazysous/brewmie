// Fence for the privacy policy rewrite (audit brewmie-21): every data flow the code has must be
// named on public/privacy.html, with the controller, retention and rights. Docs follow the code.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = path.join(__dirname, '..')
const read = (p: string) => readFileSync(path.join(root, p), 'utf8')
const policy = read('public/privacy.html')

describe('privacy policy names every flow (brewmie-21)', () => {
  it.each(['Supabase', 'Google Analytics', 'Cloudflare', 'MET Norway', 'Firebase', 'App Store', 'Google Play', 'Apple', 'GitHub', 'public, anonymous dataset'])(
    'mentions %s', (name) => { expect(policy).toContain(name) })
  it('names the controller, contact, retention, transfers, rights, children and the date', () => {
    expect(policy).toContain('operated by its independent developer in Australia')
    expect(policy).toContain('chef@lazysous.app')
    expect(policy).not.toContain('hello@brewmie.app')
    for (const h of ['How long we keep it.', 'Where your data goes.', 'Your rights.', 'Children.']) expect(policy).toContain(h)
    expect(policy).toContain('Basis: consent')
    expect(policy).toContain('Basis: contract')
    expect(policy).toContain('Basis: legitimate interest')
    expect(policy).toContain('Last updated: 22 October 2026')
  })
  it('is true to the code on fonts, GA signals and the purchase notice fields', () => {
    expect(policy).toContain('no font request goes to Google')
    expect(read('public/fonts/fonts.css')).not.toContain('fonts.googleapis.com')
    const a = read('src/lib/analytics.ts')
    expect(a).toContain('allow_google_signals: false')
    expect(a).toContain('allow_ad_personalization_signals: false')
    const iap = read('src/lib/iap.ts')
    expect(iap).toMatch(/notifyPurchase\(detail: \{ productId: string; platform: string; price: string \}\)/)
    expect(policy).toContain('product name, your platform')
  })
  it('the store-label doc exists and cites the deletion URL', () => {
    const d = read('docs/STORE_PRIVACY_LABELS.md')
    expect(d).toContain('https://brewmie.app/delete-account')
    expect(d).toContain('Data Linked to You')
  })
})
