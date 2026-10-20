import type { BrewmieState } from '../types'

const STORAGE_KEY = 'brewmie_v2'

export const defaultMaintenanceRecord = {
  lastBackflush: null,
  lastDescale: null,
  lastGrinderClean: null,
  shotsSinceBackflush: 0,
  shotsSinceDescale: 0,
}

export const defaultState: BrewmieState = {
  units: 'metric',
  machine: null,
  grinder: null,
  tamp: null,
  beans: null,
  currentGrind: null,
  shots: [],
  maintenance: defaultMaintenanceRecord,
  autoApplyAdjustments: false,
  userId: null,
  displayName: null,
  tier: 'free',
}

/**
 * Read persisted state from localStorage.
 * Returns defaultState if nothing is stored or the data is corrupt.
 */
export function loadState(): BrewmieState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultState
    const parsedRaw: unknown = JSON.parse(raw)
    // Shape check (audit brewmie-25): anything that is not a plain object is treated as
    // corrupt, and a shots field that is not an array is dropped so a bad write can never
    // blank the app at render time.
    if (parsedRaw === null || typeof parsedRaw !== 'object' || Array.isArray(parsedRaw)) {
      console.warn('[Brewmie] Persisted state is not an object, using defaults.')
      return defaultState
    }
    const parsed = parsedRaw as Partial<BrewmieState>
    if (parsed.shots !== undefined && !Array.isArray(parsed.shots)) {
      console.warn('[Brewmie] Persisted shots is not an array, dropping it.')
      delete parsed.shots
    }
    // Merge with defaults so new fields added in future versions are present
    return {
      ...defaultState,
      ...parsed,
      maintenance: {
        ...defaultMaintenanceRecord,
        ...(parsed.maintenance ?? {}),
      },
    }
  } catch {
    console.warn('[Brewmie] Failed to load persisted state, using defaults.')
    return defaultState
  }
}

/**
 * Write the current state to localStorage.
 */
export function saveState(state: BrewmieState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    console.warn('[Brewmie] Failed to persist state to localStorage.')
  }
}

/**
 * Wipe persisted state entirely (used on sign-out / reset).
 */
export function clearState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // swallow
  }
}
