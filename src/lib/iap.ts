// In-app purchase wrapper. Uses capacitor-plugin-cdv-purchase, which is the
// Capacitor-native fork of cordova-plugin-purchase. iOS goes through StoreKit 2
// (Apple's modern API, required by Apple Review on iOS 15+); Android goes through
// Google Play Billing v8.
//
// One product only: brewmie_premium_lifetime, non-consumable, one-time unlock.
// The store SDK is only loaded on native; web is a no-op.
//
// Lifecycle:
//   1. initIAP(onOwnership, opts) at app start REGISTERS the product + wires
//      event handlers.
//   2. syncStoreOwnership() is then called once at launch (audit brewmie-08).
//      It runs store.initialize(), which replays any approved-but-unfinished
//      purchase through the handlers (so verify() + finish() acknowledge it,
//      and a missed Android acknowledgement can no longer refund the order),
//      then reads owned products: owned grants Premium, an affirmative "not
//      owned" after a store-granted Premium revokes it (brewmie-65). If the
//      store cannot be queried nothing changes. Never throws.
//   3. ensureIAPInitialized() is also called by purchasePremium() and
//      restorePurchases(). One cached promise, so it never runs twice
//      concurrently; a failure (a rejection, or errors with no product
//      loaded, which is how a failed Play Billing setup arrives) resets it so
//      the next tap retries (brewmie-09).
//   4. A deferred (Ask to Buy) or Android pending order is reported as
//      pending, never as success (brewmie-64); Premium arrives later through
//      the approved/verified handlers or the next launch check.
//
// The store-granted flag (STORE_PREMIUM_KEY) records that Premium came from a
// store receipt on this device, so a legacy Supabase-granted Premium is never
// downgraded by the launch check.

import { Capacitor } from '@capacitor/core'
import { store, Platform, ProductType, ErrorCode, type Transaction, type VerifiedReceipt } from 'capacitor-plugin-cdv-purchase'

export const PREMIUM_PRODUCT_ID = 'brewmie_premium_lifetime'

let registered = false
let initPromise: Promise<void> | null = null
let onOwnershipCallback: (() => void) | null = null
let onNotOwnedCallback: (() => void) | null = null
let pendingSeen = false

export const STORE_PREMIUM_KEY = 'brewmie_premium_from_store'
export const STRIKES_KEY = 'brewmie_not_owned_strikes'
export const STRIKES_TO_REVOKE = 2
export const PENDING_MESSAGE_KEY = 'premium.purchasePending'

function markStoreOwned(): void {
  try { localStorage.setItem(STORE_PREMIUM_KEY, '1') } catch {}
  onOwnershipCallback?.()
}

function heldFromStore(): boolean {
  try { return localStorage.getItem(STORE_PREMIUM_KEY) === '1' } catch { return false }
}

function clearStoreOwned(): void {
  try { localStorage.removeItem(STORE_PREMIUM_KEY) } catch {}
}

function readStrikes(): number {
  try { return Number(localStorage.getItem(STRIKES_KEY)) || 0 } catch { return 0 }
}

function writeStrikes(n: number): void {
  try {
    if (n <= 0) localStorage.removeItem(STRIKES_KEY)
    else localStorage.setItem(STRIKES_KEY, String(n))
  } catch {}
}

// Purchase-notification email. Fire-and-forget POST to a Firebase function
// (hosted in the lazy-sous project, same Gmail inbox) when a NEW purchase
// completes. Never blocks or throws into the purchase flow: a failure here
// must never affect the user's unlock. Token matches SHARED_TOKEN in the
// function (functions/brewmie-purchase.js).
const PURCHASE_NOTIFY_URL = 'https://us-central1-lazy-sous.cloudfunctions.net/brewmiePurchaseWebhook'
const PURCHASE_NOTIFY_TOKEN = 'bru_ntfy_k7Qm2Zp9Lx4w'

// Server-side dedupe id. The webhook accepts transactionId (string, max 200)
// and 400s on any other unknown key, so this is the only extra key we send.
const TX_ID_MAX = 200

/** Store transaction id: Transaction.transactionId on both platforms (base
 *  class in store.d.ts), falling back to GooglePlay nativePurchase.orderId. */
function transactionIdOf(tx: unknown): string {
  const t = tx as { transactionId?: unknown; nativePurchase?: { orderId?: unknown } } | null | undefined
  for (const v of [t?.transactionId, t?.nativePurchase?.orderId]) {
    if (typeof v === 'string' && v.trim() !== '') return v.slice(0, TX_ID_MAX)
  }
  return ''
}

const isPremiumTx = (t: Transaction): boolean =>
  (t?.products ?? []).some((p: { id: string }) => p.id === PREMIUM_PRODUCT_ID)

let lastPremiumTxId = ''

function currentPremiumTxId(): string {
  if (lastPremiumTxId) return lastPremiumTxId
  try {
    const txs = ((store.localTransactions ?? []) as Transaction[]).filter(isPremiumTx)
    for (let i = txs.length - 1; i >= 0; i--) {
      const id = transactionIdOf(txs[i])
      if (id) return id
    }
  } catch {
    // ignore
  }
  return ''
}

function notifyPurchase(detail: { productId: string; platform: string; price: string; transactionId?: string }): void {
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
export function initIAP(onOwnership: () => void, opts?: { onNotOwned?: () => void }): Promise<void> {
  if (!Capacitor.isNativePlatform()) return Promise.resolve()

  onOwnershipCallback = onOwnership
  if (opts?.onNotOwned) onNotOwnedCallback = opts.onNotOwned

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
    .pending((tx: Transaction) => {
      if (tx.products?.some((p: { id: string }) => p.id === PREMIUM_PRODUCT_ID)) pendingSeen = true
    })
    .approved(async (tx: Transaction) => {
      console.log('[iap] approved', { products: tx.products, hasVerify: typeof tx.verify })
      // Belt-and-braces: also fire ownership on approved so a stuck verify()
      // chain can't strand a paid user as free. We only register one product,
      // so any approved transaction is the premium order.
      if (tx.products?.some((p: { id: string }) => p.id === PREMIUM_PRODUCT_ID)) {
        console.log('[iap] approved->onOwnership (immediate)')
        pendingSeen = false
        lastPremiumTxId = transactionIdOf(tx) || lastPremiumTxId
        markStoreOwned()
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
      // Ours only when a transaction names our product. An earlier version
      // also accepted an empty receipt or a transaction with no products
      // (to cope with the Simulator), which meant a user who owned nothing
      // could be granted Premium by a verified application receipt. The
      // approved() handler above and the owned() check after initialize
      // still unlock a real purchase, so nothing legitimate is lost.
      const owns = txs.some((t: Transaction) =>
        (t.products ?? []).some((p: { id: string }) => p.id === PREMIUM_PRODUCT_ID))
      console.log('[iap] verified', { txCount: txs.length, owns })
      if (owns) {
        console.log('[iap] verified->onOwnership')
        pendingSeen = false
        for (const t of txs) {
          if (isPremiumTx(t)) lastPremiumTxId = transactionIdOf(t) || lastPremiumTxId
        }
        markStoreOwned()
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
 * Call store.initialize() once. It talks to the storefront and may surface the
 * StoreKit auth prompt on a device whose App Store session has expired; that
 * is accepted since brewmie-08 (Premium must be discovered at launch).
 *
 * Idempotent: concurrent callers share one promise. A failure resets the
 * state so the next call retries, and re-throws so callers can show the text.
 */
async function ensureIAPInitialized(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  if (!registered) {
    throw new Error('IAP not registered yet — call initIAP first.')
  }
  if (initPromise) return initPromise

  const platform = platformId()
  if (!platform) return

  initPromise = (async () => {
    try {
      const errors = (await store.initialize([platform])) as Array<{ message?: string; code?: number }> | undefined
      // A failed Play Billing setup RESOLVES with an error list and no product
      // (it does not reject), so treat "errors and no product" as a failure.
      if (errors && errors.length > 0 && !store.get(PREMIUM_PRODUCT_ID)) {
        throw new Error(errors[0]?.message || `code ${errors[0]?.code ?? 'unknown'}`)
      }
      console.log('[iap] store.initialize resolved, owned?', store.owned(PREMIUM_PRODUCT_ID))
      // Cache the localized price so future modal opens can show it
      // immediately without re-initializing the store.
      cachePremiumPrice()
      if (store.owned(PREMIUM_PRODUCT_ID)) markStoreOwned()
    } catch (e) {
      initPromise = null
      throw e
    }
  })()

  return initPromise
}

/**
 * Launch-time store check (brewmie-08 / brewmie-65). Initialises the store,
 * which replays unfinished purchases through the handlers (acknowledging
 * them), then reads ownership. Resolves 'owned', 'not-owned' or 'unknown';
 * never throws. Only an affirmative not-owned answer, after Premium was
 * previously granted by the store on this device, fires onNotOwned.
 */
export async function syncStoreOwnership(): Promise<'owned' | 'not-owned' | 'unknown'> {
  if (!Capacitor.isNativePlatform()) return 'unknown'
  try {
    await ensureIAPInitialized()
  } catch (e) {
    console.warn('[iap] launch check could not query the store', e)
    return 'unknown'
  }
  if (store.owned(PREMIUM_PRODUCT_ID)) {
    writeStrikes(0)
    return 'owned'
  }
  // Two consecutive launches must both answer not-owned before Premium is
  // revoked, in case ownership was read before a replayed transaction landed.
  if (heldFromStore()) {
    const strikes = readStrikes() + 1
    if (strikes >= STRIKES_TO_REVOKE) {
      writeStrikes(0)
      clearStoreOwned()
      onNotOwnedCallback?.()
    } else {
      writeStrikes(strikes)
    }
  }
  return 'not-owned'
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
 * Re-run the store fetch for the price (audit brewmie-18 retry). Initialises
 * the store if needed (an explicit tap, so an auth prompt is acceptable), then
 * returns the display price or null. Never throws.
 */
export async function refreshPremiumPrice(): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) return null
  try {
    await ensureIAPInitialized()
  } catch (e) {
    console.warn('[iap] price refresh could not reach the store', e)
    return getPremiumPriceDisplay()
  }
  cachePremiumPrice()
  return getPremiumPriceDisplay()
}

/**
 * Trigger the store purchase sheet for the Premium product. Lazily
 * initializes the store on first call. Resolves with { ok: true } on
 * success or { ok: false, cancelled?, message? } otherwise.
 */
export async function purchasePremium(): Promise<{ ok: boolean; cancelled?: boolean; pending?: boolean; message?: string }> {
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

  pendingSeen = false
  lastPremiumTxId = ''
  const err = await offer.order()
  if (!err) {
    // Ask to Buy and Android pending orders resolve order() with no error but
    // leave the transaction PENDING. That is not a purchase yet (brewmie-64).
    if (isPremiumPending()) return { ok: false, pending: true }
    const pricing = product.pricing
    const transactionId = currentPremiumTxId()
    notifyPurchase({
      productId: PREMIUM_PRODUCT_ID,
      platform: Capacitor.getPlatform(),
      price: pricing?.price
        ? (pricing.currency ? `${pricing.price} ${pricing.currency}` : String(pricing.price))
        : '?',
      ...(transactionId ? { transactionId } : {}),
    })
    return { ok: true }
  }
  if (err.code === ErrorCode.PAYMENT_CANCELLED) return { ok: false, cancelled: true }
  const detail = err.message || `code ${err.code ?? 'unknown'}`
  return { ok: false, message: `Purchase failed: ${detail}` }
}

function isPremiumPending(): boolean {
  if (pendingSeen) return true
  try {
    const txs = (store.localTransactions ?? []) as Transaction[]
    return txs.some((t) =>
      (t.products ?? []).some((p: { id: string }) => p.id === PREMIUM_PRODUCT_ID) &&
      (t.state === 'pending' || t.isPending === true))
  } catch {
    return false
  }
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
    // Surface the text to the sheet (brewmie-09); the next tap retries.
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(`Store not ready: ${msg}`)
  }
  await store.restorePurchases()
}
