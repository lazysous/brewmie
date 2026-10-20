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

export default {
  async fetch(request) {
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
    const LATEST_VERSION = '1.1.3'
    const LATEST_URL = 'https://brewmie.app/ota/builds/1.1.3.zip'
    const REVERT_TO_BUILTIN = false
    const NATIVE_VERSION = '1.1'

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
