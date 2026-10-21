// brewmie-78: the Pages Function routing decision, the _routes.json exclusions and the function handler.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
// @ts-expect-error plain JS module, no types
import { decide, STATIC_EXACT, STATIC_PREFIXES } from '../functions/_lib/decide.js'
// @ts-expect-error plain JS module, no types
import { onRequest } from '../functions/[[path]].js'

const root = join(__dirname, '..')
const routes = JSON.parse(readFileSync(join(root, 'public/_routes.json'), 'utf8')) as { version: number; include: string[]; exclude: string[] }

describe('decide()', () => {
  it('serves the landing page for /', () => {
    expect(decide('/')).toEqual({ kind: 'landing' })
  })
  it('passes the app shell, assets and policy pages straight through', () => {
    for (const p of ['/app', '/app/', '/app/assets/index-x.js', '/assets/a.png', '/fonts/fonts.css', '/translations/en.json',
      '/ota/builds/1.1.12.zip', '/manifest.json', '/landing', '/landing.html', '/privacy', '/privacy.html', '/support', '/delete-account.html',
      '/robots.txt', '/sitemap.xml', '/llms.txt', '/index.html']) {
      expect(decide(p), p).toEqual({ kind: 'passthrough' })
    }
  })
  it('returns notfound for unknown paths and look-alikes', () => {
    for (const p of ['/nope', '/a/b/c', '/application', '/apple-touch-icon.png', '/favicon.ico', '/assetsx', '/privacy-policy', '/wp-login.php', '/.env']) {
      expect(decide(p), p).toEqual({ kind: 'notfound' })
    }
  })
  it('returns notfound for /.well-known/* (no such files exist)', () => {
    expect(decide('/.well-known/security.txt')).toEqual({ kind: 'notfound' })
    expect(decide('/.well-known/')).toEqual({ kind: 'notfound' })
    expect(decide('/.well-known')).toEqual({ kind: 'notfound' })
  })
  it('tolerates odd input without throwing', () => {
    expect(decide('')).toEqual({ kind: 'landing' })
    expect(decide(undefined as unknown as string)).toEqual({ kind: 'landing' })
    expect(decide('x')).toEqual({ kind: 'notfound' })
  })
})

describe('public/_routes.json', () => {
  it('is a valid v1 file under the 100 rule limit that includes everything', () => {
    expect(routes.version).toBe(1)
    expect(routes.include).toEqual(['/*'])
    expect(routes.include.length + routes.exclude.length).toBeLessThanOrEqual(100)
  })
  it('excludes every file and folder in public/ (and the clean URLs of its .html files)', () => {
    const skip = new Set(['_redirects', '_routes.json'])
    for (const name of readdirSync(join(root, 'public'))) {
      if (skip.has(name)) continue
      const isDir = !name.includes('.')
      if (isDir) {
        expect(routes.exclude, name).toContain(`/${name}/*`)
        expect(STATIC_PREFIXES, name).toContain(`/${name}`)
      } else {
        expect(routes.exclude, name).toContain(`/${name}`)
        expect(STATIC_EXACT, name).toContain(`/${name}`)
        if (name.endsWith('.html')) {
          expect(routes.exclude, name).toContain(`/${name.slice(0, -5)}`)
          expect(STATIC_EXACT, name).toContain(`/${name.slice(0, -5)}`)
        }
      }
    }
  })
  it('keeps the app shell and the OTA zips out of the function', () => {
    for (const p of ['/app', '/app/*', '/ota/*', '/assets/*']) expect(routes.exclude).toContain(p)
  })
  it('every exclude is passthrough in decide() (the two lists agree)', () => {
    for (const e of routes.exclude) {
      const probe = e.endsWith('/*') ? e.slice(0, -2) + '/x' : e
      expect(decide(probe).kind, e).toBe('passthrough')
    }
  })
})

describe('onRequest()', () => {
  const asset = (status = 200, body = 'ASSET') => new Response(body, { status })
  const mkEnv = (impl?: (req: Request) => Promise<Response>) => {
    const seen: string[] = []
    return { seen, env: { ASSETS: { fetch: async (req: Request) => { seen.push(new URL(req.url).pathname); return impl ? impl(req) : asset() } } } }
  }
  const call = (path: string, env: unknown, method = 'GET') =>
    onRequest({ request: new Request('https://brewmie.app' + path, { method }), env })

  it('/ returns the landing page as a 200 through the clean URL', async () => {
    const { env, seen } = mkEnv()
    const res = await call('/', env)
    expect(res.status).toBe(200)
    expect(seen).toEqual(['/landing'])
  })
  it('/ falls back to /landing.html, then to a redirect, and never to the SPA shell', async () => {
    const a = mkEnv(async (r) => (new URL(r.url).pathname === '/landing' ? asset(308, '') : asset(200, 'L')))
    expect((await call('/', a.env)).status).toBe(200)
    expect(a.seen).toEqual(['/landing', '/landing.html'])
    const b = mkEnv(async () => asset(500, ''))
    const res = await call('/', b.env)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://brewmie.app/landing')
  })
  it('unknown paths get a real 404 with a link back to /', async () => {
    const { env, seen } = mkEnv()
    const res = await call('/nope', env)
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toContain('text/html')
    const html = await res.text()
    expect(html).toContain('href="/"')
    expect(html).not.toContain('—')
    expect(seen).toEqual([])
  })
  it('/.well-known/* is a 404', async () => {
    const { env } = mkEnv()
    expect((await call('/.well-known/assetlinks.json', env)).status).toBe(404)
  })
  it('HEAD on an unknown path is a 404 with no body', async () => {
    const { env } = mkEnv()
    const res = await call('/nope', env, 'HEAD')
    expect(res.status).toBe(404)
    expect(await res.text()).toBe('')
  })
  it('a passthrough path is handed to ASSETS untouched', async () => {
    const { env, seen } = mkEnv()
    const res = await call('/app/', env)
    expect(await res.text()).toBe('ASSET')
    expect(seen).toEqual(['/app/'])
  })
  it('an unexpected error serves the asset instead of failing', async () => {
    let n = 0
    const env = { ASSETS: { fetch: async () => { n++; if (n === 1) throw new Error('boom'); return asset(200, 'SAFE') } } }
    const res = await call('/', env)
    // landing() swallows the first failure and retries the second URL, which succeeds
    expect(res.status).toBe(200)
  })
  it('the functions folder exists and holds the handler', () => {
    expect(existsSync(join(root, 'functions/[[path]].js'))).toBe(true)
  })
})
