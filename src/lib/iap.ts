// In-app purchase wrapper around cordova-plugin-purchase (CdvPurchase).
//
// One product only: brewmie_premium_lifetime, non-consumable, one-time unlock.
// The store SDK is only loaded on native; web is a no-op.
//
// Lifecycle:
//   1. initIAP(onOwnership) on app start (native only). Registers the product,
//      wires event handlers, calls store.initialize().
//   2. When the store reports an existing or new owned/verified receipt, we
//      invoke onOwnership('premium') so App.tsx can flip state.tier and
//      persist via Supabase.
//   3. purchasePremium() triggers a fresh order. Returns when the user has
//      either dismissed the store sheet or completed the transaction.

import { Capacitor } from '@capacitor/core'

export const PREMIUM_PRODUCT_ID = 'brewmie_premium_lifetime'

type CdvStore = {
  register: (products: Array<{ id: string; platform: string; type: string }>) => void
  initialize: (platforms: Array<{ platform: string; options?: object }>) => Promise<unknown[]>
  when: () => CdvWhen
  get: (id: string) => CdvProduct | undefined
  owned: (id: string) => boolean
  restorePurchases: () => Promise<unknown>
}

type CdvWhen = {
  productUpdated: (cb: (product: CdvProduct) => void) => CdvWhen
  approved: (cb: (transaction: CdvTransaction) => Promise<void> | void) => CdvWhen
  verified: (cb: (receipt: CdvReceipt) => Promise<void> | void) => CdvWhen
  unverified: (cb: (receipt: CdvReceipt) => void) => CdvWhen
}

type CdvProduct = {
  id: string
  owned?: boolean
  getOffer: () => { order: () => Promise<{ code?: number; message?: string } | null | undefined> } | undefined
}

type CdvTransaction = {
  verify: () => Promise<void>
  products?: Array<{ id: string }>
}

type CdvReceipt = {
  finish: () => Promise<void>
  transactions?: CdvTransaction[]
}

declare global {
  interface Window {
    CdvPurchase?: {
      store: CdvStore
      Platform: {
        APPLE_APPSTORE: string
        GOOGLE_PLAY: string
      }
      ProductType: {
        NON_CONSUMABLE: string
      }
      ErrorCode: {
        PAYMENT_CANCELLED: number
      }
    }
  }
}

let initialized = false
let initPromise: Promise<void> | null = null

function platformId(): string | null {
  const p = Capacitor.getPlatform()
  if (p === 'ios') return window.CdvPurchase?.Platform.APPLE_APPSTORE ?? null
  if (p === 'android') return window.CdvPurchase?.Platform.GOOGLE_PLAY ?? null
  return null
}

/**
 * Initialize the store on native platforms. Idempotent. The onOwnership
 * callback fires whenever the store confirms the user owns the premium
 * product (either from a freshly-verified purchase or a restored receipt
 * found during initialize / restore).
 */
export function initIAP(onOwnership: () => void): Promise<void> {
  if (!Capacitor.isNativePlatform()) return Promise.resolve()
  if (initialized && initPromise) return initPromise
  initialized = true

  initPromise = (async () => {
    // Wait for cordova_ready / device — the plugin sets up window.CdvPurchase
    // after deviceready fires.
    await new Promise<void>((resolve) => {
      if (window.CdvPurchase) return resolve()
      document.addEventListener('deviceready', () => resolve(), { once: true })
      // Safety net: if deviceready never fires (web/dev), bail after 4s.
      setTimeout(() => resolve(), 4000)
    })

    const ns = window.CdvPurchase
    if (!ns) return
    const platform = platformId()
    if (!platform) return

    ns.store.register([{
      id: PREMIUM_PRODUCT_ID,
      platform,
      type: ns.ProductType.NON_CONSUMABLE,
    }])

    ns.store.when()
      .approved(async (tx) => {
        console.log('[iap] approved', { products: tx.products, hasVerify: typeof tx.verify })
        // verify() asks the platform store to confirm authenticity. For IOS
        // this hands us a verified receipt; for Android same.
        // Belt-and-braces: also fire ownership on approved so a stuck
        // verify() chain (seen with StoreKit local-config on Simulator) can't
        // strand a paid user as free. We only register PREMIUM_PRODUCT_ID, so
        // any approved transaction is the premium order.
        if (tx.products?.some((p) => p.id === PREMIUM_PRODUCT_ID)) {
          console.log('[iap] approved->onOwnership (immediate)')
          onOwnership()
        }
        try {
          await tx.verify()
          console.log('[iap] verify() resolved')
        } catch (e) {
          console.warn('[iap] verify() threw', e)
        }
      })
      .verified(async (receipt) => {
        const txs = receipt.transactions ?? []
        // Receipt is considered ours if any transaction matches our product
        // id, OR if the products[] array is empty/absent — the StoreKit
        // local-config bridge on Simulator hands back receipts with no
        // products[] populated, so empty-but-verified is our case too. We
        // reject only when the array is populated with OTHER product ids
        // (e.g. the spurious bundle-id transaction the plugin emits).
        const owns = txs.length === 0 || txs.some((t) => {
          const ps = t.products ?? []
          if (ps.length === 0) return true
          return ps.some((p) => p.id === PREMIUM_PRODUCT_ID)
        })
        console.log('[iap] verified', { txCount: txs.length, owns })
        if (owns) {
          console.log('[iap] verified->onOwnership')
          onOwnership()
        }
        try {
          await receipt.finish()
          console.log('[iap] receipt.finish() resolved')
        } catch (e) {
          console.warn('[iap] receipt.finish() threw', e)
        }
      })

    await ns.store.initialize([{
      platform,
      options: {},
    }])
    console.log('[iap] store.initialize resolved, owned?', ns.store.owned(PREMIUM_PRODUCT_ID))

    // If the user already owns the product from a prior install, surface it
    // immediately so the UI flips to premium without requiring another tap.
    if (ns.store.owned(PREMIUM_PRODUCT_ID)) onOwnership()

    // Ask the store to re-deliver receipts on every launch — guards against
    // StoreKit local-config receipts not being cached across cold launches in
    // the Simulator. Cheap on real devices; runs in background.
    ns.store.restorePurchases().then(() => {
      console.log('[iap] restorePurchases resolved, owned?', ns.store.owned(PREMIUM_PRODUCT_ID))
      if (ns.store.owned(PREMIUM_PRODUCT_ID)) onOwnership()
    }).catch((e) => console.warn('[iap] restorePurchases threw', e))
  })()

  return initPromise
}

/**
 * Trigger the store purchase sheet for the Premium product. Resolves with
 * { ok: true } on success or { ok: false, cancelled?, message? } otherwise.
 * The actual ownership update flows through the verified() callback wired
 * up in initIAP, not this return value.
 */
export async function purchasePremium(): Promise<{ ok: boolean; cancelled?: boolean; message?: string }> {
  if (!Capacitor.isNativePlatform()) {
    return { ok: false, message: 'In-app purchase is only available in the Brewmie app.' }
  }
  const ns = window.CdvPurchase
  if (!ns) return { ok: false, message: 'Store not ready. Try again in a moment.' }

  const product = ns.store.get(PREMIUM_PRODUCT_ID)
  if (!product) return { ok: false, message: 'Premium product not found on the store.' }

  const offer = product.getOffer()
  if (!offer) return { ok: false, message: 'No purchase offer available right now.' }

  const err = await offer.order()
  if (!err) return { ok: true }
  if (err.code === ns.ErrorCode.PAYMENT_CANCELLED) return { ok: false, cancelled: true }
  return { ok: false, message: err.message ?? 'Purchase failed.' }
}

/**
 * Ask the store to re-deliver any prior purchases (e.g. after reinstall or
 * sign-in on a new device). The verified() handler from initIAP will fire if
 * a Premium receipt is found.
 */
export async function restorePurchases(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  await window.CdvPurchase?.store.restorePurchases()
}
