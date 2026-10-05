// Characterisation suite for src/hooks/useTier.ts.
// GATING_ENABLED / OVERRIDE_ENABLED are computed once at module load from
// Capacitor.isNativePlatform() / import.meta.env.DEV, so each case needs a
// fresh module instance (vi.resetModules() + dynamic import) after setting
// up the mocked platform / env / localStorage for that case.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, cleanup } from '@testing-library/react'
import type { BrewmieState, Tier } from '../src/types'

let mockIsNative = false
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => mockIsNative },
}))

function makeState(tier: Tier): BrewmieState {
  return {
    units: 'metric',
    machine: null,
    grinder: null,
    tamp: null,
    beans: null,
    currentGrind: null,
    shots: [],
    maintenance: {
      lastBackflush: null,
      lastDescale: null,
      lastGrinderClean: null,
      shotsSinceBackflush: 0,
      shotsSinceDescale: 0,
    },
    autoApplyAdjustments: false,
    userId: null,
    displayName: null,
    tier,
  }
}

async function freshUseTier() {
  vi.resetModules()
  return await import('../src/hooks/useTier')
}

beforeEach(() => {
  localStorage.clear()
  mockIsNative = false
})
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('web (non-native): gating is off', () => {
  it('useTier always returns premium, ignoring state.tier', async () => {
    mockIsNative = false
    const mod = await freshUseTier()
    const { result } = renderHook(() => mod.useTier(makeState('free')))
    expect(result.current).toBe('premium')
  })

  it('isPremium is always true and isGatingEnabled is false', async () => {
    mockIsNative = false
    const mod = await freshUseTier()
    expect(mod.isPremium(makeState('free'))).toBe(true)
    expect(mod.isGatingEnabled()).toBe(false)
  })
})

describe('native: gating is on, falls back to state.tier with no override', () => {
  it('useTier mirrors state.tier', async () => {
    mockIsNative = true
    const mod = await freshUseTier()
    const { result: free } = renderHook(() => mod.useTier(makeState('free')))
    expect(free.current).toBe('free')
    const { result: premium } = renderHook(() => mod.useTier(makeState('premium')))
    expect(premium.current).toBe('premium')
  })

  it('isPremium mirrors state.tier', async () => {
    mockIsNative = true
    const mod = await freshUseTier()
    expect(mod.isPremium(makeState('free'))).toBe(false)
    expect(mod.isPremium(makeState('premium'))).toBe(true)
  })
})

describe('native + override, DEV mode (import.meta.env.DEV is true under vitest)', () => {
  it('a "free" override wins over a premium state.tier', async () => {
    mockIsNative = true
    localStorage.setItem('brewmie_tier_override', 'free')
    const mod = await freshUseTier()
    const { result } = renderHook(() => mod.useTier(makeState('premium')))
    expect(result.current).toBe('free')
    expect(mod.isPremium(makeState('premium'))).toBe(false)
  })

  it('a "premium" override wins over a free state.tier', async () => {
    mockIsNative = true
    localStorage.setItem('brewmie_tier_override', 'premium')
    const mod = await freshUseTier()
    const { result } = renderHook(() => mod.useTier(makeState('free')))
    expect(result.current).toBe('premium')
  })
})

describe('native + override, production opt-in (import.meta.env.DEV stubbed to false)', () => {
  it('the override is IGNORED without the brewmie_devtest opt-in flag', async () => {
    mockIsNative = true
    vi.stubEnv('DEV', false)
    localStorage.setItem('brewmie_tier_override', 'premium') // no opt-in flag set
    const mod = await freshUseTier()
    const { result } = renderHook(() => mod.useTier(makeState('free')))
    expect(result.current).toBe('free')
  })

  // FINDING: see report. A production user who flips brewmie_devtest=1 can
  // self-grant premium for free via brewmie_tier_override, on native.
  it('[FINDING] brewmie_devtest=1 + brewmie_tier_override=premium grants Premium for free in production', async () => {
    mockIsNative = true
    vi.stubEnv('DEV', false)
    localStorage.setItem('brewmie_devtest', '1')
    localStorage.setItem('brewmie_tier_override', 'premium')
    const mod = await freshUseTier()
    const { result } = renderHook(() => mod.useTier(makeState('free')))
    expect(result.current).toBe('premium')
    expect(mod.isPremium(makeState('free'))).toBe(true)
  })
})
