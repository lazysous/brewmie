// The sale flag reader behind the gold "Sale price" badge (src/lib/sale.ts).
// What is pinned: active only with active:true and a valid end time still
// ahead; one request per five minutes shared by concurrent callers; a failing,
// slow or malformed answer means no sale and never a rejection.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { saleIsActive, loadSaleConfig, getCachedSale, _resetSaleCache, SALE_URL } from '../src/lib/sale'

const FUTURE = '2099-01-01T00:00:00Z'
const PAST = '2000-01-01T00:00:00Z'
const NOW = Date.parse('2026-11-01T00:00:00Z')

describe('saleIsActive', () => {
  it('is on only with active:true and a parseable end time still ahead', () => {
    expect(saleIsActive({ active: true, until: FUTURE }, NOW)).toBe(true)
    expect(saleIsActive({ active: true, from: PAST, until: FUTURE }, NOW)).toBe(true)
    expect(saleIsActive({ active: false, until: FUTURE }, NOW)).toBe(false)
    expect(saleIsActive({ active: 'true', until: FUTURE }, NOW)).toBe(false)
    expect(saleIsActive({ active: true, until: PAST }, NOW)).toBe(false)
    expect(saleIsActive({ active: true }, NOW)).toBe(false)
    expect(saleIsActive({ active: true, until: null }, NOW)).toBe(false)
    expect(saleIsActive({ active: true, until: 'next tuesday' }, NOW)).toBe(false)
    expect(saleIsActive({ active: true, from: FUTURE, until: '2099-02-01T00:00:00Z' }, NOW)).toBe(false)
    expect(saleIsActive({ active: true, from: 'garbage', until: FUTURE }, NOW)).toBe(true)
  })
  it('rejects anything that is not a plain object', () => {
    expect(saleIsActive(null, NOW)).toBe(false)
    expect(saleIsActive(undefined, NOW)).toBe(false)
    expect(saleIsActive('yes', NOW)).toBe(false)
    expect(saleIsActive([], NOW)).toBe(false)
    expect(saleIsActive(42, NOW)).toBe(false)
  })
})

describe('loadSaleConfig', () => {
  beforeEach(() => { _resetSaleCache() })
  afterEach(() => { vi.unstubAllGlobals() })

  it('reads the worker once, caches the answer, and shares one request between concurrent callers', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ active: true, until: FUTURE }) }))
    vi.stubGlobal('fetch', fetchMock)
    const [a, b] = await Promise.all([loadSaleConfig(NOW), loadSaleConfig(NOW + 10)])
    expect(a).toEqual({ active: true, until: FUTURE })
    expect(b).toBe(a)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(SALE_URL)
    expect(opts.cache).toBe('no-store')
    expect(opts.credentials).toBe('omit')
    expect(getCachedSale()).toEqual({ active: true, until: FUTURE })
    await loadSaleConfig(NOW + 4 * 60 * 1000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await loadSaleConfig(NOW + 5 * 60 * 1000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('a network failure resolves to null and never rejects', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    await expect(loadSaleConfig(NOW)).resolves.toBeNull()
    expect(getCachedSale()).toBeNull()
  })

  it('a non-200 or non-object answer is treated as no sale', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({ active: true, until: FUTURE }) })))
    expect(await loadSaleConfig(NOW)).toBeNull()
    _resetSaleCache()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => 'sale!' })))
    expect(await loadSaleConfig(NOW)).toBeNull()
    _resetSaleCache()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [1, 2] })))
    expect(await loadSaleConfig(NOW)).toBeNull()
  })

  it('a hung worker is abandoned after three seconds with no sale', async () => {
    vi.useFakeTimers()
    try {
      vi.stubGlobal('fetch', vi.fn((_url: string, opts: RequestInit) => new Promise((_resolve, reject) => {
        opts.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })))
      const p = loadSaleConfig(NOW)
      await vi.advanceTimersByTimeAsync(3001)
      await expect(p).resolves.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
