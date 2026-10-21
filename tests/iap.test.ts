// The store-receipt handlers in src/lib/iap.ts. The plugin is mocked so the
// approved() and verified() callbacks can be driven directly.
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Handlers = { pending: Array<(tx: unknown) => void>; approved: Array<(tx: unknown) => Promise<void> | void>; verified: Array<(r: unknown) => Promise<void> | void> }
const fake = vi.hoisted(() => {
  const handlers: Handlers = { pending: [], approved: [], verified: [] }
  const chain = {
    approved(cb: (tx: unknown) => void) { handlers.approved.push(cb); return chain },
    pending(cb: (tx: unknown) => void) { handlers.pending.push(cb); return chain },
    verified(cb: (r: unknown) => void) { handlers.verified.push(cb); return chain },
  }
  return {
    handlers,
    store: {
      register: vi.fn(),
      when: () => chain,
      initialize: vi.fn(async () => {}),
      owned: vi.fn(() => false),
      get: vi.fn(() => undefined),
      restorePurchases: vi.fn(async () => undefined),
    },
  }
})
vi.mock('capacitor-plugin-cdv-purchase', () => ({
  store: fake.store,
  Platform: { APPLE_APPSTORE: 'ios-appstore', GOOGLE_PLAY: 'android-playstore' },
  ProductType: { NON_CONSUMABLE: 'non consumable' },
  ErrorCode: { PAYMENT_CANCELLED: 6777006 },
}))
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' },
}))

async function freshIap() {
  vi.resetModules()
  fake.handlers.approved.length = 0
  fake.handlers.pending.length = 0
  fake.store.initialize.mockReset(); fake.store.initialize.mockImplementation(async () => [])
  fake.store.owned.mockReset(); fake.store.owned.mockReturnValue(false)
  fake.store.get.mockReset(); fake.store.get.mockReturnValue(undefined)
  fake.store.restorePurchases.mockClear()
  try { localStorage.clear() } catch {}
  fake.handlers.verified.length = 0
  return await import('../src/lib/iap')
}

const mem: Record<string, string> = {}
vi.stubGlobal('localStorage', {
  getItem: (k: string) => (k in mem ? mem[k] : null),
  setItem: (k: string, v: string) => { mem[k] = String(v) },
  removeItem: (k: string) => { delete mem[k] },
  clear: () => { for (const k of Object.keys(mem)) delete mem[k] },
})
beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true }))) })

describe('verified receipts', () => {
  it('a receipt with no transactions does NOT grant Premium (it used to)', async () => {
    const iap = await freshIap()
    const owned = vi.fn()
    await iap.initIAP(owned)
    await fake.handlers.verified[0]({ transactions: [], finish: async () => {} })
    expect(owned).not.toHaveBeenCalled()
  })

  it('a transaction with an empty products list does NOT grant Premium (it used to)', async () => {
    const iap = await freshIap()
    const owned = vi.fn()
    await iap.initIAP(owned)
    await fake.handlers.verified[0]({ transactions: [{ products: [] }], finish: async () => {} })
    expect(owned).not.toHaveBeenCalled()
  })

  it("the application receipt (product id = the app's bundle id) does NOT grant Premium", async () => {
    const iap = await freshIap()
    const owned = vi.fn()
    await iap.initIAP(owned)
    await fake.handlers.verified[0]({ transactions: [{ products: [{ id: 'app.brewmie.brewmie' }] }], finish: async () => {} })
    expect(owned).not.toHaveBeenCalled()
  })

  it('a transaction naming brewmie_premium_lifetime grants Premium and finishes the receipt', async () => {
    const iap = await freshIap()
    const owned = vi.fn()
    const finish = vi.fn(async () => {})
    await iap.initIAP(owned)
    await fake.handlers.verified[0]({ transactions: [{ products: [{ id: 'brewmie_premium_lifetime' }] }], finish })
    expect(owned).toHaveBeenCalledTimes(1)
    expect(finish).toHaveBeenCalledTimes(1)
  })
})

describe('approved transactions', () => {
  it('an approved transaction for the product grants Premium immediately and then verifies', async () => {
    const iap = await freshIap()
    const owned = vi.fn()
    const verify = vi.fn(async () => {})
    await iap.initIAP(owned)
    await fake.handlers.approved[0]({ products: [{ id: 'brewmie_premium_lifetime' }], verify })
    expect(owned).toHaveBeenCalledTimes(1)
    expect(verify).toHaveBeenCalledTimes(1)
  })

  it('an approved transaction for some other product grants nothing', async () => {
    const iap = await freshIap()
    const owned = vi.fn()
    await iap.initIAP(owned)
    await fake.handlers.approved[0]({ products: [{ id: 'something_else' }], verify: async () => {} })
    expect(owned).not.toHaveBeenCalled()
  })
})

describe('purchase notification', () => {
  it('is sent once on a successful order and never on a cancelled one', async () => {
    const iap = await freshIap()
    await iap.initIAP(() => {})
    const order = vi.fn(async () => undefined)
    fake.store.get.mockReturnValue({ pricing: { price: 'A$2.99', currency: 'AUD' }, getOffer: () => ({ order }) } as never)
    const ok = await iap.purchasePremium()
    expect(ok).toEqual({ ok: true })
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/brewmiePurchaseWebhook$/)
    expect(JSON.parse(init.body as string)).toEqual({ productId: 'brewmie_premium_lifetime', platform: 'ios', price: 'A$2.99 AUD' })

    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockClear()
    order.mockImplementationOnce(async () => ({ isError: true, code: 6777006, message: 'cancelled' }) as never)
    const cancelled = await iap.purchasePremium()
    expect(cancelled).toEqual({ ok: false, cancelled: true })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('purchase notification transactionId', () => {
  const ALLOWED = ['productId', 'platform', 'price', 'transactionId', 'orderId', 'receiptHash', 'token']
  const premium = [{ id: 'brewmie_premium_lifetime' }]
  // setup runs inside order(), like the real store firing approved() mid-order.
  async function buy(setup?: () => Promise<void> | void) {
    const iap = await freshIap()
    await iap.initIAP(() => {})
    ;(fake.store as Record<string, unknown>).localTransactions = []
    const order = async () => { if (setup) await setup(); return undefined }
    fake.store.get.mockReturnValue({ pricing: { price: 'A$2.99', currency: 'AUD' }, getOffer: () => ({ order }) } as never)
    await iap.purchasePremium()
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    return JSON.parse(init.body as string) as Record<string, unknown>
  }

  it('includes transactionId from the approved transaction', async () => {
    const body = await buy(async () => { await fake.handlers.approved[0]({ transactionId: 'tx-123', products: premium, verify: async () => {} }) })
    expect(body).toEqual({ productId: 'brewmie_premium_lifetime', platform: 'ios', price: 'A$2.99 AUD', transactionId: 'tx-123' })
  })

  it('falls back to localTransactions and to nativePurchase.orderId', async () => {
    const body = await buy(() => {
      ;(fake.store as Record<string, unknown>).localTransactions = [{ products: premium, state: 'approved', nativePurchase: { orderId: 'GPA.1' } }]
    })
    expect(body.transactionId).toBe('GPA.1')
  })

  it('omits transactionId when absent or empty', async () => {
    expect('transactionId' in (await buy())).toBe(false)
    const body = await buy(async () => { await fake.handlers.approved[0]({ transactionId: '', products: premium, verify: async () => {} }) })
    expect('transactionId' in body).toBe(false)
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockClear()
    const nonString = await buy(async () => { await fake.handlers.approved[0]({ transactionId: 42, products: premium, verify: async () => {} }) })
    expect('transactionId' in nonString).toBe(false)
  })

  it('only sends keys the server allows, all string values, transactionId capped at 200', async () => {
    const body = await buy(async () => { await fake.handlers.approved[0]({ transactionId: 'x'.repeat(500), products: premium, verify: async () => {} }) })
    for (const k of Object.keys(body)) expect(ALLOWED).toContain(k)
    for (const v of Object.values(body)) expect(typeof v).toBe('string')
    expect((body.transactionId as string).length).toBe(200)
  })
})

const PRODUCT = { pricing: { price: 'A$2.99', currency: 'AUD' }, getOffer: () => ({ order: async () => undefined }) }

describe('launch-time store check (brewmie-08)', () => {
  it('initialises the store once, even for concurrent callers, and grants Premium when owned', async () => {
    const iap = await freshIap()
    const owned = vi.fn()
    await iap.initIAP(owned)
    fake.store.owned.mockReturnValue(true)
    const [a, b] = await Promise.all([iap.syncStoreOwnership(), iap.syncStoreOwnership()])
    expect([a, b]).toEqual(['owned', 'owned'])
    expect(fake.store.initialize).toHaveBeenCalledTimes(1)
    expect(owned).toHaveBeenCalledTimes(1)
  })

  it('an approved-but-unfinished purchase replayed at init is verified and finished (acknowledged)', async () => {
    const iap = await freshIap()
    const owned = vi.fn()
    await iap.initIAP(owned)
    fake.store.initialize.mockImplementation(async () => {
      const verify = vi.fn(async () => {})
      await fake.handlers.approved[0]({ products: [{ id: 'brewmie_premium_lifetime' }], verify })
      expect(verify).toHaveBeenCalledTimes(1)
      const finish = vi.fn(async () => {})
      await fake.handlers.verified[0]({ transactions: [{ products: [{ id: 'brewmie_premium_lifetime' }] }], finish })
      expect(finish).toHaveBeenCalledTimes(1)
      return []
    })
    await iap.syncStoreOwnership()
    expect(owned).toHaveBeenCalled()
  })
})

describe('init failure is recoverable (brewmie-09)', () => {
  it('a Play Billing setup failure (errors, no product) resets so the next tap retries, and surfaces the text', async () => {
    const iap = await freshIap()
    await iap.initIAP(() => {})
    fake.store.initialize.mockImplementationOnce(async () => [{ code: 6777001, message: 'Billing unavailable' }])
    const first = await iap.purchasePremium()
    expect(first).toEqual({ ok: false, message: 'Store not ready: Billing unavailable' })
    await expect(iap.restorePurchases()).resolves.toBeUndefined()
    expect(fake.store.initialize).toHaveBeenCalledTimes(2)
  })

  it('a rejected initialize also resets, and restore throws the error text', async () => {
    const iap = await freshIap()
    await iap.initIAP(() => {})
    fake.store.initialize.mockImplementationOnce(async () => { throw new Error('boom') })
    await expect(iap.restorePurchases()).rejects.toThrow('Store not ready: boom')
    await expect(iap.restorePurchases()).resolves.toBeUndefined()
    expect(fake.store.initialize).toHaveBeenCalledTimes(2)
  })
})

describe('pending purchases (brewmie-64)', () => {
  it('a deferred / pending order is pending, grants nothing and sends no notification', async () => {
    const iap = await freshIap()
    const owned = vi.fn()
    await iap.initIAP(owned)
    fake.store.get.mockReturnValue({ ...PRODUCT, getOffer: () => ({ order: async () => {
      fake.handlers.pending[0]({ products: [{ id: 'brewmie_premium_lifetime' }] })
      return undefined
    } }) } as never)
    const r = await iap.purchasePremium()
    expect(r).toEqual({ ok: false, pending: true })
    expect(owned).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('a pending transaction in the local queue is also reported pending', async () => {
    const iap = await freshIap()
    await iap.initIAP(() => {})
    ;(fake.store as Record<string, unknown>).localTransactions = [{ state: 'pending', products: [{ id: 'brewmie_premium_lifetime' }] }]
    fake.store.get.mockReturnValue(PRODUCT as never)
    expect(await iap.purchasePremium()).toEqual({ ok: false, pending: true })
    ;(fake.store as Record<string, unknown>).localTransactions = []
  })
})

describe('revocation (brewmie-65)', () => {
  const grant = () => fake.handlers.verified[0]({ transactions: [{ products: [{ id: 'brewmie_premium_lifetime' }] }], finish: async () => {} })

  it('the first not-owned launch does not revoke; the second consecutive one does, once', async () => {
    const iap = await freshIap()
    const notOwned = vi.fn()
    await iap.initIAP(() => {}, { onNotOwned: notOwned })
    await grant()
    expect(await iap.syncStoreOwnership()).toBe('not-owned')
    expect(notOwned).not.toHaveBeenCalled()
    expect(localStorage.getItem('brewmie_not_owned_strikes')).toBe('1')
    expect(await iap.syncStoreOwnership()).toBe('not-owned')
    expect(notOwned).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('brewmie_not_owned_strikes')).toBeNull()
  })

  it('an owned result between two not-owned launches resets the counter', async () => {
    const iap = await freshIap()
    const notOwned = vi.fn()
    await iap.initIAP(() => {}, { onNotOwned: notOwned })
    await grant()
    await iap.syncStoreOwnership()
    fake.store.owned.mockReturnValue(true)
    expect(await iap.syncStoreOwnership()).toBe('owned')
    expect(localStorage.getItem('brewmie_not_owned_strikes')).toBeNull()
    fake.store.owned.mockReturnValue(false)
    await iap.syncStoreOwnership()
    expect(notOwned).not.toHaveBeenCalled()
  })

  it('an unknown result never changes the counter', async () => {
    const iap = await freshIap()
    await iap.initIAP(() => {}, { onNotOwned: () => {} })
    localStorage.setItem('brewmie_premium_from_store', '1')
    localStorage.setItem('brewmie_not_owned_strikes', '1')
    fake.store.initialize.mockImplementationOnce(async () => { throw new Error('offline') })
    expect(await iap.syncStoreOwnership()).toBe('unknown')
    expect(localStorage.getItem('brewmie_not_owned_strikes')).toBe('1')
  })

  it('not owned with no store-granted flag (legacy server Premium) does NOT downgrade', async () => {
    const iap = await freshIap()
    const notOwned = vi.fn()
    await iap.initIAP(() => {}, { onNotOwned: notOwned })
    expect(await iap.syncStoreOwnership()).toBe('not-owned')
    expect(notOwned).not.toHaveBeenCalled()
  })

  it('a store that cannot be queried never downgrades', async () => {
    const iap = await freshIap()
    const notOwned = vi.fn()
    await iap.initIAP(() => {}, { onNotOwned: notOwned })
    await fake.handlers.verified[0]({ transactions: [{ products: [{ id: 'brewmie_premium_lifetime' }] }], finish: async () => {} })
    fake.store.initialize.mockImplementationOnce(async () => { throw new Error('offline') })
    expect(await iap.syncStoreOwnership()).toBe('unknown')
    expect(notOwned).not.toHaveBeenCalled()
  })
})

describe('refreshPremiumPrice (brewmie-18) and signed-out purchase (brewmie-17)', () => {
  it('re-runs the store fetch and returns the price once the store answers', async () => {
    const iap = await freshIap()
    await iap.initIAP(() => {})
    fake.store.get.mockReturnValue({ pricing: { price: 'AU$3.99', currency: 'AUD' } })
    expect(await iap.refreshPremiumPrice()).toBe('AU$3.99 AUD')
    expect(fake.store.initialize).toHaveBeenCalled()
  })
  it('returns null (never throws) when the store cannot be reached', async () => {
    const iap = await freshIap()
    await iap.initIAP(() => {})
    fake.store.initialize.mockRejectedValue(new Error('offline'))
    expect(await iap.refreshPremiumPrice()).toBeNull()
  })
  it('the purchase notification and the iap module never read a user id', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('src/lib/iap.ts', 'utf8')
    expect(src).not.toMatch(/userId|user_id/i)
  })
})
