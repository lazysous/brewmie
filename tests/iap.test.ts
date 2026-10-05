// The store-receipt handlers in src/lib/iap.ts. The plugin is mocked so the
// approved() and verified() callbacks can be driven directly.
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Handlers = { approved: Array<(tx: unknown) => Promise<void> | void>; verified: Array<(r: unknown) => Promise<void> | void> }
const fake = vi.hoisted(() => {
  const handlers: Handlers = { approved: [], verified: [] }
  const chain = {
    approved(cb: (tx: unknown) => void) { handlers.approved.push(cb); return chain },
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
  fake.handlers.verified.length = 0
  return await import('../src/lib/iap')
}

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
