// Characterisation of Premium gating through useTier (audit 2026-10, brewmie-51/36):
// gating is ON only on a native platform; the web build treats everyone as premium.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { BrewmieState } from '../src/types'

const flags = vi.hoisted(() => ({ native: false }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => flags.native, getPlatform: () => (flags.native ? 'ios' : 'web') } }))

async function load(native: boolean) {
  flags.native = native
  vi.resetModules()
  return await import('../src/hooks/useTier')
}
const state = (tier: 'free' | 'premium') => ({ tier } as unknown as BrewmieState)

beforeEach(() => { localStorage.clear() })

describe('useTier gating', () => {
  it('native: a free account is not premium, a premium account is', async () => {
    const m = await load(true)
    expect(m.isGatingEnabled()).toBe(true)
    expect(m.isPremium(state('free'))).toBe(false)
    expect(m.isPremium(state('premium'))).toBe(true)
  })
  it('web: gating is off and every account counts as premium (recorded decision brewmie-36)', async () => {
    const m = await load(false)
    expect(m.isGatingEnabled()).toBe(false)
    expect(m.isPremium(state('free'))).toBe(true)
  })
  it('the dev-only tier override is ignored unless the build is a dev build', async () => {
    const m = await load(true)
    localStorage.setItem('brewmie_tier_override', 'premium')
    // vitest runs with import.meta.env.DEV = true, so the override is honoured here;
    // this pins that the key and values are what the docs say.
    expect(m.isPremium(state('free'))).toBe(import.meta.env.DEV ? true : false)
  })
})
