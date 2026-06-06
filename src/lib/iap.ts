// In-app purchase wrapper. Uses capacitor-plugin-cdv-purchase, which is the
// Capacitor-native fork of cordova-plugin-purchase. iOS goes through StoreKit 2
// (Apple's modern API, required by Apple Review on iOS 15+); Android goes through
// Google Play Billing v8.
//
// One product only: brewmie_premium_lifetime, non-consumable, one-time unlock.
// The store SDK is only loaded on native; web is a no-op.
//
// Lifecycle (lazy):
//   1. initIAP(onOwnership) at app start REGISTERS the product + wires event
//      handlers. It does NOT call store.initialize() — that talks to Apple's
//      storefront and surfaces a native auth prompt on devices whose
//      App Store session has expired. We defer the initialize call until the
//      user actually triggers an IAP-related action.
//   2. ensureIAPInitialized() is called lazily by purchasePremium() and
//      restorePurchases() before they do real work. Idempotent + cached.
//   3. When the store reports an owned/verified receipt, onOwnership() fires
//      so App.tsx can flip state.tier and persist via Supabase.
//
// Net effect: returning users who don't tap purchase or restore won't see
// the StoreKit auth prompt at launch. Source of truth for tier remains
// Supabase (set on sign-in); StoreKit ownership is a fallback for users
// who reinstall without signing in.

import { Capacitor } from '@capacitor/core'
import { store, Platform, ProductType, ErrorCode, type Transaction, type VerifiedReceipt } from 'capacitor-plugin-cdv-purchase'

export const PREMIUM_PRODUCT_ID = 'brewmie_premium_lifetime'

let registered = false
let initialized = false
let initPromise: Promise<void> | null = null
let onOwnershipCallback: (() => void) | null = null

// Purchase-notification email. Fire-and-forget POST to a Firebase function
// (hosted in the lazy-sous project, same Gmail inbox) when a NEW purchase
// completes. Never blocks or throws into the purchase flow: a failure here
// must never affect the user's unlock. Token matches SHARED_TOKEN in the
// function (functions/brewmie-purchase.js).
const PURCHASE_NOTIFY_URL = 'https://us-central1-lazy-sous.cloudfunctions.net/brewmiePurchaseWebhook'
const PURCHASE_NOTIFY_TOKEN = 'bru_ntfy_k7Qm2Zp9Lx4w'

function notifyPurchase(detail: { productId: string; platform: string; price: string }): void {
  try {
    fetch(PURCHASE_NOTIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Brewmie-Token': PURCHASE_NOTIFY_TOKEN },
      body: JSON.stringify(detail),
    }).catch(() => {})
  } catch {
    // ignore — notification is best-effort
  }
}

function platformId() {
  const p = Capacitor.getPlatform()
  if (p === 'ios') return Platform.APPLE_APPSTORE
  if (p === 'android') return Platform.GOOGLE_PLAY
  return null
}

/**
 * Register the product + wire event handlers. Safe to call at app launch:
 * no network, no auth, no native dialog. Stores the onOwnership callback
 * for later — it fires once ensureIAPInitialized() has run and the store
 * reports a verified receipt for our product id.
 *
 * Idempotent: subsequent calls are no-ops except for updating the callback.
 */
export function initIAP(onOwnership: () => void): Promise<void> {
  if (!Capacitor.isNativePlatform()) return Promise.resolve()

  onOwnershipCallback = onOwnership

  if (registered) return Promise.resolve()
  registered = true

  const platform = platformId()
  if (!platform) return Promise.resolve()

  store.register([{
    id: PREMIUM_PRODUCT_ID,
    platform,
    type: ProductType.NON_CONSUMABLE,
  }])

  store.when()
    .approved(async (tx: Transaction) => {
      console.log('[iap] approved', { products: tx.products, hasVerify: typeof tx.verify })
      // Belt-and-braces: also fire ownership on approved so a stuck verify()
      // chain can't strand a paid user as free. We only register one product,
      // so any approved transaction is the premium order.
      if (tx.products?.some((p: { id: string }) => p.id === PREMIUM_PRODUCT_ID)) {
        console.log('[iap] approved->onOwnership (immediate)')
        onOwnershipCallback?.()
      }
      try {
        await tx.verify()
        console.log('[iap] verify() resolved')
      } catch (e) {
        console.warn('[iap] verify() threw', e)
      }
    })
    .verified(async (receipt: VerifiedReceipt) => {
      const txs = (receipt as unknown as { transactions?: Transaction[] }).transactions ?? []
      // Receipt is ours if any transaction matches our product id, OR if the
      // products[] array is empty/absent (StoreKit local-config / Simulator
      // hands back receipts with no products[] populated).
      const owns = txs.length === 0 || txs.some((t: Transaction) => {
        const ps = t.products ?? []
        if (ps.length === 0) return true
        return ps.some((p: { id: string }) => p.id === PREMIUM_PRODUCT_ID)
      })
      console.log('[iap] verified', { txCount: txs.length, owns })
      if (owns) {
        console.log('[iap] verified->onOwnership')
        onOwnershipCallback?.()
      }
      try {
        await receipt.finish()
        console.log('[iap] receipt.finish() resolved')
      } catch (e) {
        console.warn('[iap] receipt.finish() threw', e)
      }
    })

  return Promise.resolve()
}

/**
 * Lazily call store.initialize(). This is the call that talks to Apple's
 * storefront and may trigger the StoreKit auth prompt on a device whose
 * App Store session has expired. Only call this from user-initiated
 * flows (purchase, restore) — never at launch.
 *
 * Idempotent. Cached after first success. Re-throws so callers can show
 * a real error message if init fails.
 */
async function ensureIAPInitialized(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  if (!registered) {
    throw new Error('IAP not registered yet — call initIAP first.')
  }
  if (initialized && initPromise) return initPromise

  initialized = true
  const platform = platformId()
  if (!platform) return

  initPromise = (async () => {
    await store.initialize([platform])
    console.log('[iap] store.initialize resolved, owned?', store.owned(PREMIUM_PRODUCT_ID))
    // Cache the localized price so future modal opens can show it
    // immediately without re-initializing the store.
    cachePremiumPrice()
    if (store.owned(PREMIUM_PRODUCT_ID)) onOwnershipCallback?.()
  })()

  // If initialize fails, reset so the next user action can retry.
  initPromise.catch(() => {
    initialized = false
    initPromise = null
  })

  return initPromise
}

// Localized price persistence. We cache the most recent localized price
// returned by the store so future modal opens can show it immediately —
// without re-triggering ensureIAPInitialized (which can surface a system
// auth prompt on devices with a stale App Store session). The cache is
// written after any successful init (purchase, restore) and read on
// modal open. First-time users with no cache see the translation
// fallback; their cache populates on the first IAP action.
const PRICE_CACHE_KEY = 'brewmie_premium_price'

function cachePremiumPrice(): void {
  if (!Capacitor.isNativePlatform()) return
  try {
    const product = store.get(PREMIUM_PRODUCT_ID)
    const pricing = product?.pricing
    if (!pricing?.price) return
    const display = pricing.currency ? `${pricing.price} ${pricing.currency}` : pricing.price
    localStorage.setItem(PRICE_CACHE_KEY, display)
  } catch {
    // localStorage may be disabled in some webviews — silent.
  }
}

/**
 * Returns the localized price display for the Premium product, e.g.
 * "AU$10.99 AUD" or "€5.99 EUR".
 *
 * Read order:
 *   1. Live product (if the store has been initialized this session)
 *   2. localStorage cache from a prior session
 *   3. null — caller should show a translation fallback
 *
 * Crucially: does NOT trigger ensureIAPInitialized. Safe to call from
 * any UI surface without risking a StoreKit auth prompt.
 */
export function getPremiumPriceDisplay(): string | null {
  if (!Capacitor.isNativePlatform()) return null
  const product = store.get(PREMIUM_PRODUCT_ID)
  const pricing = product?.pricing
  if (pricing?.price) {
    const live = pricing.currency ? `${pricing.price} ${pricing.currency}` : pricing.price
    // Refresh cache on every live read so the next session has the latest.
    try { localStorage.setItem(PRICE_CACHE_KEY, live) } catch {}
    return live
  }
  try {
    return localStorage.getItem(PRICE_CACHE_KEY)
  } catch {
    return null
  }
}

/**
 * Trigger the store purchase sheet for the Premium product. Lazily
 * initializes the store on first call. Resolves with { ok: true } on
 * success or { ok: false, cancelled?, message? } otherwise.
 */
export async function purchasePremium(): Promise<{ ok: boolean; cancelled?: boolean; message?: string }> {
  if (!Capacitor.isNativePlatform()) {
    return { ok: false, message: 'In-app purchase is only available in the Brewmie app.' }
  }

  try {
    await ensureIAPInitialized()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, message: `Store not ready: ${msg}` }
  }

  const product = store.get(PREMIUM_PRODUCT_ID)
  if (!product) return { ok: false, message: 'Premium product not loaded. Reopen the app and try again.' }

  const offer = product.getOffer()
  if (!offer) return { ok: false, message: 'No purchase offer available. Check your network and try again.' }

  const err = await offer.order()
  if (!err) {
    const pricing = product.pricing
    notifyPurchase({
      productId: PREMIUM_PRODUCT_ID,
      platform: Capacitor.getPlatform(),
      price: pricing?.price
        ? (pricing.currency ? `${pricing.price} ${pricing.currency}` : String(pricing.price))
        : '?',
    })
    return { ok: true }
  }
  if (err.code === ErrorCode.PAYMENT_CANCELLED) return { ok: false, cancelled: true }
  const detail = err.message || `code ${err.code ?? 'unknown'}`
  return { ok: false, message: `Purchase failed: ${detail}` }
}

/**
 * Ask the store to re-deliver any prior purchases. Lazily initializes
 * the store on first call. The verified() handler from initIAP fires if
 * a Premium receipt is found.
 */
export async function restorePurchases(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    await ensureIAPInitialized()
  } catch (e) {
    console.warn('[iap] ensureIAPInitialized threw during restore', e)
    return
  }
  await store.restorePurchases()
}
