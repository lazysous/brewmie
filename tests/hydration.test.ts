// Gear profile must not be overwritten by an empty device or by null server columns
// (audit brewmie-07).
import { describe, it, expect, beforeEach } from 'vitest'
import { markConfigHydrated, isConfigHydrated, resetHydration, mergeServerConfig } from '../src/lib/hydration'

beforeEach(() => resetHydration())

describe('hydration registry', () => {
  it('is false until the account is marked, per account', () => {
    expect(isConfigHydrated('A')).toBe(false)
    markConfigHydrated('A')
    expect(isConfigHydrated('A')).toBe(true)
    expect(isConfigHydrated('B')).toBe(false)
    expect(isConfigHydrated(null)).toBe(false)
  })
})

describe('mergeServerConfig', () => {
  it('drops null and undefined columns so they cannot erase local values', () => {
    expect(mergeServerConfig({ units: 'imperial', machine: null, grinder: undefined, tamp: { type: 'manual' } }))
      .toEqual({ units: 'imperial', tamp: { type: 'manual' } })
  })
  it('an empty or missing profile merges nothing', () => {
    expect(mergeServerConfig(null)).toEqual({})
    expect(mergeServerConfig({})).toEqual({})
  })
})
