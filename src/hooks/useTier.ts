import { useSyncExternalStore } from 'react'
import { Capacitor } from '@capacitor/core'
import type { Tier, BrewmieState } from '../types'

// In dev, localStorage.brewmie_tier_override = 'free' | 'premium' overrides the
// real tier so designers can flip between modes without touching the backend.
// In production we ignore any stale value unless the user has explicitly
// opted into devtest mode — otherwise a stray write during testing would
// leak a 'premium' override into the shipped app.
const OVERRIDE_KEY = 'brewmie_tier_override'
const PROD_OPT_IN_KEY = 'brewmie_devtest'
const EVENT = 'brewmie:tier-override'

const OVERRIDE_ENABLED: boolean = (() => {
  if (import.meta.env.DEV) return true
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(PROD_OPT_IN_KEY) === '1' } catch { return false }
})()

// While we're testing on web, gating is OFF. Every feature is available, no
// modal, no locks, no PREMIUM badges. Native apps (iOS/Android) keep the full
// free/premium model — they're where monetisation will live once shipped.
const GATING_ENABLED = Capacitor.isNativePlatform()

function readOverride(): Tier | null {
  if (typeof window === 'undefined') return null
  if (!OVERRIDE_ENABLED) return null
  const v = localStorage.getItem(OVERRIDE_KEY)
  return v === 'free' || v === 'premium' ? v : null
}

export function setTierOverride(tier: Tier | null) {
  if (typeof window === 'undefined') return
  if (tier === null) localStorage.removeItem(OVERRIDE_KEY)
  else localStorage.setItem(OVERRIDE_KEY, tier)
  // Notify same-tab listeners (storage event only fires across tabs).
  window.dispatchEvent(new Event(EVENT))
}

function subscribe(cb: () => void) {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(EVENT, cb)
  window.addEventListener('storage', cb)
  return () => {
    window.removeEventListener(EVENT, cb)
    window.removeEventListener('storage', cb)
  }
}

function getSnapshot(): Tier | null {
  return readOverride()
}

function getServerSnapshot(): Tier | null {
  return null
}

/**
 * Returns the effective tier. Dev override wins; then on web (no gating) we
 * always return 'premium' so every feature is available. Native falls back to
 * state.tier.
 */
export function useTier(state: BrewmieState): Tier {
  const override = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  // On web, gating is off — always return premium and ignore any stale override.
  if (!GATING_ENABLED) return 'premium'
  if (override) return override
  return state.tier
}

export function isPremium(state: BrewmieState): boolean {
  if (!GATING_ENABLED) return true
  const override = readOverride()
  if (override) return override === 'premium'
  return state.tier === 'premium'
}

/** True when Premium gating is active (native only right now). */
export const isGatingEnabled = (): boolean => GATING_ENABLED
