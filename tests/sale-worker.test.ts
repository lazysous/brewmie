// The OTA worker's /sale answer (ota/worker.js saleAnswer()), which scripts/sale_flag.sh
// switches by rewriting SALE_ACTIVE and SALE_UNTIL. Pinned: the worker itself says false
// for an expired or malformed flag, so a forgotten flag cannot label the regular price a
// sale; the OTA decision is untouched by the new route.
import { describe, it, expect } from 'vitest'
import worker, { saleAnswer, decide } from '../ota/worker.js'

const NOW = Date.parse('2026-11-01T00:00:00Z')

describe('saleAnswer()', () => {
  it('answers active with the end time while the flag is on and the end time is ahead', () => {
    expect(saleAnswer({ active: true, until: '2026-11-10T13:00:00Z' }, NOW)).toEqual({ active: true, until: '2026-11-10T13:00:00Z' })
  })
  it('answers inactive when the flag is off, expired, missing or malformed', () => {
    expect(saleAnswer({ active: false, until: '2026-11-10T13:00:00Z' }, NOW)).toEqual({ active: false, until: null })
    expect(saleAnswer({ active: true, until: '2026-10-01T00:00:00Z' }, NOW)).toEqual({ active: false, until: null })
    expect(saleAnswer({ active: true, until: '' }, NOW)).toEqual({ active: false, until: null })
    expect(saleAnswer({ active: true, until: 'soon' }, NOW)).toEqual({ active: false, until: null })
    expect(saleAnswer({ active: 'true', until: '2026-11-10T13:00:00Z' }, NOW)).toEqual({ active: false, until: null })
  })
})

describe('GET /sale on the worker', () => {
  it('serves JSON with CORS and no caching, and the committed flag is off', async () => {
    const res = await worker.fetch(new Request('https://brewmie-ota.richbwilliamson.workers.dev/sale'))
    expect(res.headers.get('Content-Type')).toBe('application/json')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(await res.json()).toEqual({ active: false, until: null })
  })
  it('leaves the OTA answer on the root path unchanged', async () => {
    const res = await worker.fetch(new Request('https://brewmie-ota.richbwilliamson.workers.dev/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version_name: '0.0.1' }),
    }))
    const body = await res.json()
    expect(typeof body.version).toBe('string')
    expect(decide('0.0.1', { enabled: true, latestVersion: body.version, latestUrl: body.url, revertToBuiltin: false, nativeVersion: '1.1' })).toEqual(body)
  })
})
