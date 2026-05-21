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

    let deviceVersion = '0.0.0'
    if (request.method === 'POST') {
      try {
        const body = await request.json()
        deviceVersion = body.version_name || body.version_build || '0.0.0'
      } catch { /* ignore */ }
    }

    // Bump these when pushing a new OTA bundle.
    //
    // OTA_ENABLED=false serves "no_new_version_available" to all devices,
    // regardless of what they report. This is the safe default — flip to
    // true only when LATEST_URL points at a verified-good bundle ZIP.
    const OTA_ENABLED = false
    const LATEST_VERSION = '0.1.0'
    const LATEST_URL = 'https://brewmie.app/ota/builds/0.1.0.zip'

    if (!OTA_ENABLED || deviceVersion === LATEST_VERSION) {
      return new Response(JSON.stringify({
        message: 'No new version available',
        error: 'no_new_version_available',
        version: deviceVersion,
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      })
    }

    return new Response(JSON.stringify({
      version: LATEST_VERSION,
      url: LATEST_URL,
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    })
  },
}
