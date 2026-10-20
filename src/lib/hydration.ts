// Per-session record of which accounts have had their profile hydrated from the server
// (audit brewmie-07). The config upsert must not run before the hydrate for that account
// has landed: on a fresh device the local config is empty, and pushing it first overwrote
// the saved gear profile with empty values. Memory only; a new launch hydrates again.
const hydrated = new Set<string>()

export function markConfigHydrated(userId: string): void {
  hydrated.add(userId)
}

export function isConfigHydrated(userId: string | null | undefined): boolean {
  return !!userId && hydrated.has(userId)
}

/** For tests. */
export function resetHydration(): void {
  hydrated.clear()
}

/** Server columns to merge over local state: null and undefined mean "no data", never
 *  "erase what the device has" (audit brewmie-07). */
export function mergeServerConfig<T extends Record<string, unknown>>(server: T | null | undefined): Partial<T> {
  const out: Partial<T> = {}
  if (!server) return out
  for (const [k, v] of Object.entries(server)) {
    if (v !== null && v !== undefined) (out as Record<string, unknown>)[k] = v
  }
  return out
}
