// Cloudflare Pages Function for brewmie.app (brewmie-78). Runs ONLY for paths public/_routes.json does not
// exclude: '/' and paths that match no file. Everything else (the /app/ shell, assets, fonts, policy pages)
// never reaches it, so the SPA shell cannot be affected by a bug here. The routing decision is the pure
// decide() in ./_lib/decide.js (unit-tested in tests/pages-function.test.ts).
//
// Why a function: adding public/404.html disabled Pages' built-in SPA fallback and took /app/ down for 40
// minutes (2026-10-22). A function returns a real 404 without touching the fallback.
import { decide } from './_lib/decide.js'
import { NOT_FOUND_HTML } from './_lib/notfound.js'

async function landing(request, env) {
  const base = new URL(request.url)
  // '/landing.html' is turned into a 308 to '/landing' by Pages, so ask for the clean URL first and never follow a redirect.
  for (const path of ['/landing', '/landing.html']) {
    try {
      const res = await env.ASSETS.fetch(new Request(new URL(path, base), { method: 'GET', headers: request.headers, redirect: 'manual' }))
      if (res.status === 200) return res
    } catch { /* try the next one */ }
  }
  return Response.redirect(new URL('/landing', base).toString(), 302)
}

export async function onRequest({ request, env }) {
  try {
    const { pathname } = new URL(request.url)
    const { kind } = decide(pathname)
    if (kind === 'landing') return await landing(request, env)
    if (kind === 'notfound') {
      return new Response(request.method === 'HEAD' ? null : NOT_FOUND_HTML, {
        status: 404,
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=60', 'x-robots-tag': 'noindex' },
      })
    }
  } catch { /* fall through: serving the asset is always safer than an error */ }
  return env.ASSETS.fetch(request)
}
