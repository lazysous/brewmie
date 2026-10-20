// Temporary sale label (2026-10). The price on the Premium sheet is the live
// store price, so lowering the store price needs no app release. What the
// store cannot tell the app is that the price IS a sale, so the sheet asks the
// OTA worker (GET /sale, two constants rewritten by scripts/sale_flag.sh and
// redeployed in seconds, no bundle version) and shows a gold "Sale price"
// badge while the answer says the sale is on. A sale with no valid end time
// never shows, so a forgotten flag cannot label the regular price a sale for
// ever, and any fetch failure means no badge, never a blocked sheet.

export const SALE_URL = 'https://brewmie-ota.richbwilliamson.workers.dev/sale'
const TTL_MS = 5 * 60 * 1000
const TIMEOUT_MS = 3000

export interface SaleConfig {
  active?: unknown
  from?: unknown
  until?: unknown
}

export function saleIsActive(cfg: unknown, now: number = Date.now()): boolean {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return false
  const c = cfg as SaleConfig
  if (c.active !== true) return false
  const until = Date.parse(String(c.until))
  if (Number.isNaN(until) || now >= until) return false
  if (c.from !== undefined && c.from !== null) {
    const from = Date.parse(String(c.from))
    if (!Number.isNaN(from) && now < from) return false
  }
  return true
}

let cached: SaleConfig | null = null
let fetchedAt = 0
let inFlight: Promise<SaleConfig | null> | null = null

export function getCachedSale(): SaleConfig | null {
  return cached
}

// Resolves to the sale config or null and never rejects. One request per five
// minutes; concurrent callers share it.
export function loadSaleConfig(now: number = Date.now()): Promise<SaleConfig | null> {
  if (!inFlight || now - fetchedAt >= TTL_MS) {
    fetchedAt = now
    inFlight = fetchSale()
  }
  return inFlight
}

async function fetchSale(): Promise<SaleConfig | null> {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null
  const timer = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT_MS) : null
  try {
    const res = await fetch(SALE_URL, { cache: 'no-store', credentials: 'omit', signal: ctrl ? ctrl.signal : undefined })
    if (res.ok) {
      const cfg: unknown = await res.json()
      cached = cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? (cfg as SaleConfig) : null
    }
  } catch {
    // No sale information: the badge stays hidden.
  } finally {
    if (timer) clearTimeout(timer)
  }
  return cached
}

// Test seam.
export function _resetSaleCache(): void {
  cached = null
  fetchedAt = 0
  inFlight = null
}
