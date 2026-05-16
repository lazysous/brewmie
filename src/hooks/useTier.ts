import { useSyncExternalStore } from 'react'
import type { Tier, BrewmieState } from '../types'

// In dev, localStorage.brewmie_tier_override = 'free' | 'premium' overrides the
// real tier so designers can flip between modes without touching the backend.
const OVERRIDE_KEY = 'brewmie_tier_override'
const EVENT = 'brewmie:tier-override'

function readOverride(): Tier | null {
  if (typeof window === 'undefined') return null
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
 * Returns the effective tier. Dev override (if set) wins over real state.
 * Pass the user's actual tier from state; this hook layers the dev override on top.
 */
export function useTier(state: BrewmieState): Tier {
  const override = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  return override ?? state.tier
}

export function isPremium(state: BrewmieState): boolean {
  const override = readOverride()
  return (override ?? state.tier) === 'premium'
}
