// Source/asset fences for the 2026-10 audit batch: brewmie-11 copy, -63 export, -73 dead code, -78/79 routing.
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const root = path.join(__dirname, '..')
const src = (p: string) => readFileSync(path.join(root, p), 'utf8')

describe('CSV export is open to everyone (brewmie-63)', () => {
  const s = src('src/screens/InsightsScreen.tsx')
  it('the handler does not route free users to the Premium modal and the button is not hidden for them', () => {
    expect(s).not.toContain("setPremiumTrigger('export')")
    expect(s).not.toMatch(/\{!isFree && shots\.length > 0 && \(/)
  })
  it('the privacy policy cites only controls that exist', () => {
    const p = src('public/privacy.html')
    expect(p).not.toContain('Delete all data in Insights')
  })
})

describe('dead code removed (brewmie-73)', () => {
  it('the wake-lock hook and the daily ping scheduler are gone', () => {
    expect(existsSync(path.join(root, 'src/hooks/useWakeLock.ts'))).toBe(false)
    const n = src('src/lib/notifications.ts')
    expect(n).not.toContain('scheduleDailyPing')
    expect(n).not.toContain('cancelDailyPing')
  })
})

describe('community sharing copy matches the opt-in code (brewmie-11)', () => {
  it('privacy, llms.txt and the banner strings say sharing happens only after the person chooses', () => {
    expect(src('public/privacy.html')).toContain('shared only after you choose to share')
    expect(src('public/llms.txt')).toContain('only after the person chooses to share')
    const en = JSON.parse(src('public/translations/en.json'))
    expect(en.consent.shareBody).toBeTruthy()
    expect(src('src/components/ConsentBanner.tsx')).not.toContain('isEURegion')
  })
})

describe('web routing (brewmie-78/79)', () => {
  const r = src('public/_redirects')
  const rules = r.split('\n').filter((l) => l.trim() && !l.startsWith('#'))
  it('maps the shell asset paths under /app/ and normalises /app, with no explicit index rewrite', () => {
    expect(r).toMatch(/^\/app\s+\/app\/\s+301/m)
    expect(r).toMatch(/^\/app\/assets\/\*\s+\/assets\/:splat\s+200/m)
    // The SPA shell comes from Pages' built-in fallback: no index.html rewrite, no catch-all,
    // and no 404.html (adding one disabled the fallback and /app/ went 404 on 2026-10-22).
    expect(r).not.toMatch(/\/index\.html\s+200/)
    expect(r).not.toMatch(/^\/\*\s/m)
    expect(existsSync(path.join(root, 'public/404.html'))).toBe(false)
    expect(src('index.html')).toContain('<link rel="canonical" href="https://brewmie.app/app/" />')
  })
  it('has a real 404 page, and the manifest and canonical point at /app/', () => {
    // No 404.html: it disables Pages' built-in SPA fallback that /app/ relies on (seen live 2026-10-22).
    expect(existsSync(path.join(root, 'public/404.html'))).toBe(false)
    expect(JSON.parse(src('public/manifest.json')).start_url).toBe('/app/')
    expect(src('index.html')).toContain('<link rel="canonical" href="https://brewmie.app/app/" />')
  })
})
