// Cloudflare Worker for Brewmie OTA bundle delivery.
//
// The Capacitor app calls this endpoint on launch and ~hourly. If the LATEST_*
// constants below are newer than the device's installed version, the worker
// responds with the bundle URL and the plugin downloads + swaps it in. No App
// Store / Play Store re-submission required for JS/CSS/asset changes (native
// code, plugin versions, and major framework upgrades still need a binary).
//
// Push a new bundle:
//   1. cd /Users/williamson/brewmie && npm run build
//   2. cd dist && zip -r ../ota/builds/<version>.zip . && cd ..
//   3. Upload builds/<version>.zip to https://brewmie.app/ota/builds/<version>.zip
//      (drop into the Pages dist before deploy)
//   4. Bump LATEST_VERSION + LATEST_URL below
//   5. wrangler deploy ota/worker.js --name brewmie-ota

// Pure decision so the behaviour is unit-tested (tests/ota-worker.test.ts) and the
// rollback path is proven without a deploy. cfg: { enabled, latestVersion, latestUrl,
// revertToBuiltin, nativeVersion }.
//
// Rollback (audit 2026-10, brewmie-39): scripts/ota_rollback.sh <version> republishes an
// older zip by rewriting latestVersion/latestUrl; `builtin` sets revertToBuiltin, which
// answers {version:"builtin"} so @capgo/capacitor-updater resets devices to the bundle that
// shipped in the store binary (Android _reset / setNextBundle(builtin), iOS _reset). A
// device already on the native bundle reports nativeVersion and gets no_new_version, so
// the reset never loops; `off` sets enabled=false and every device keeps what it has.
export function decide(deviceVersion, cfg) {
  const noNew = { message: 'No new version available', error: 'no_new_version_available', version: deviceVersion }
  if (!cfg.enabled) return noNew
  if (cfg.revertToBuiltin) {
    if (deviceVersion === cfg.nativeVersion) return noNew
    return { version: 'builtin', url: '' }
  }
  if (deviceVersion === cfg.latestVersion) return noNew
  return { version: cfg.latestVersion, url: cfg.latestUrl }
}

// Sale flag (temporary sale, 2026-10). GET /sale answers {active, until}; the app shows a
// gold "Sale price" badge on the Premium sheet while active is true (src/lib/sale.ts
// re-checks until on the device). Pure so tests/sale-worker.test.ts can pin it: active only
// with the flag on AND a parseable end time still ahead, so an expired or malformed flag
// answers false by itself. cfg: { active, until }.
export function saleAnswer(cfg, now = Date.now()) {
  const until = Date.parse(cfg.until)
  const active = cfg.active === true && Number.isFinite(until) && now < until
  return { active, until: active ? cfg.until : null }
}

// Supabase keep-alive (audit brewmie-90): the free tier pauses a project after a week with
// no API traffic. A daily GET of one anonymous public_shots row (the same read the app's
// community counter makes) keeps it awake. Pure request builder so the test can pin the URL
// and headers without a network; `scheduled()` runs it on the cron in wrangler.toml and
// GET /keepalive runs it on demand so a deploy can be verified.
export function keepAliveRequest(env) {
  const base = (env && env.SUPABASE_URL ? String(env.SUPABASE_URL) : '').replace(/\/+$/, '')
  const key = env && env.SUPABASE_ANON_KEY ? String(env.SUPABASE_ANON_KEY) : ''
  if (!base || !key) return null
  return {
    url: `${base}/rest/v1/public_shots?select=id&limit=1`,
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
  }
}

async function keepAlive(env) {
  const req = keepAliveRequest(env)
  if (!req) {
    console.log(JSON.stringify({ event: 'keepalive', ok: false, reason: 'SUPABASE_URL or SUPABASE_ANON_KEY missing' }))
    return { ok: false, status: 0 }
  }
  try {
    const res = await fetch(req.url, { headers: req.headers })
    const ok = res.ok
    console.log(JSON.stringify({ event: 'keepalive', ok, status: res.status }))
    return { ok, status: res.status }
  } catch (e) {
    console.log(JSON.stringify({ event: 'keepalive', ok: false, error: String(e).slice(0, 120) }))
    return { ok: false, status: 0 }
  }
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(keepAlive(env))
  },

  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      })
    }
    if (request.method !== 'POST' && request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405 })
    }

    // Updater stats sink (audit brewmie-41): once capacitor.config.ts statsUrl points here
    // (native release), the plugin posts download/set/rollback events. They are logged as
    // one JSON line each (wrangler tail / Workers logs); nothing is stored.
    if (request.method === 'GET' && new URL(request.url).pathname === '/keepalive') {
      const r = await keepAlive(env)
      return new Response(JSON.stringify(r), { status: r.ok ? 200 : 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
    }

    if (new URL(request.url).pathname === '/stats') {
      let stats = {}
      try { stats = await request.json() } catch { /* ignore */ }
      console.log(JSON.stringify({ event: 'updater_stats', ...stats }))
      return new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } })
    }

    let deviceVersion = '0.0.0'
    if (request.method === 'POST') {
      try {
        const body = await request.json()
        deviceVersion = body.version_name || body.version_build || '0.0.0'
      } catch { /* ignore */ }
    }

    // These constants are rewritten by scripts/ota_push.sh and scripts/ota_rollback.sh;
    // never edit them by hand on a live push.
    //
    // OTA_ENABLED=false serves "no_new_version_available" to all devices,
    // regardless of what they report.
    const OTA_ENABLED = true
    const LATEST_VERSION = '1.1.5'
    const LATEST_URL = 'https://brewmie.app/ota/builds/1.1.5.zip'
    const REVERT_TO_BUILTIN = false
    const NATIVE_VERSION = '1.1'

    // Rewritten by scripts/sale_flag.sh (on <until>|off); UTC ISO 8601, '' when off.
    const SALE_ACTIVE = true
    const SALE_UNTIL = '2027-10-20T00:00:00Z'

    if (new URL(request.url).pathname === '/sale') {
      return new Response(JSON.stringify(saleAnswer({ active: SALE_ACTIVE, until: SALE_UNTIL })), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store',
        },
      })
    }

    const body = decide(deviceVersion, {
      enabled: OTA_ENABLED, latestVersion: LATEST_VERSION, latestUrl: LATEST_URL,
      revertToBuiltin: REVERT_TO_BUILTIN, nativeVersion: NATIVE_VERSION,
    })
    if (body.url !== undefined) console.log(JSON.stringify({ event: 'update_offered', from: deviceVersion, to: body.version }))
    return new Response(JSON.stringify(body), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    })
  },
}
