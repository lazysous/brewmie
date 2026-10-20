import { useEffect, useState } from 'react'
import { getCachedSale, loadSaleConfig, saleIsActive } from '../lib/sale'

// True while the sale flag (src/lib/sale.ts) says a sale is on. Draws from the
// cached answer at once and settles when a fresh answer lands, so the sheet
// never waits on the network.
export function useSale(open: boolean): boolean {
  const [on, setOn] = useState(() => saleIsActive(getCachedSale()))
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setOn(saleIsActive(getCachedSale()))
    loadSaleConfig().then((cfg) => { if (!cancelled) setOn(saleIsActive(cfg)) })
    return () => { cancelled = true }
  }, [open])
  return on
}
