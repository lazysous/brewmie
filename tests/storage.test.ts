// Characterisation suite for src/lib/storage.ts (localStorage persistence).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { loadState, saveState, clearState, defaultState, defaultMaintenanceRecord } from '../src/lib/storage'

const KEY = 'brewmie_v2'

beforeEach(() => {
  localStorage.clear()
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('loadState', () => {
  it('returns defaultState when nothing is stored', () => {
    expect(loadState()).toEqual(defaultState)
  })

  it('returns defaultState on corrupt JSON (and logs a warning)', () => {
    localStorage.setItem(KEY, '{not json')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(loadState()).toEqual(defaultState)
    expect(warn).toHaveBeenCalled()
  })

  it('merges a partial object over defaults, including nested maintenance', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        units: 'imperial',
        maintenance: { lastBackflush: '2026-01-01T00:00:00.000Z' },
      })
    )
    const result = loadState()
    expect(result).toEqual({
      ...defaultState,
      units: 'imperial',
      maintenance: { ...defaultMaintenanceRecord, lastBackflush: '2026-01-01T00:00:00.000Z' },
    })
  })

  // 'null' / '[]' / '42' are all valid JSON but not plausible BrewmieState
  // shapes. Reporting exactly what happens for each, per the task:
  it('"null": JSON.parse succeeds, but accessing parsed.maintenance throws -> caught -> defaultState', () => {
    localStorage.setItem(KEY, 'null')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = loadState()
    expect(result).toEqual(defaultState)
    expect(Array.isArray(result.shots)).toBe(true)
    expect(typeof result.maintenance).toBe('object')
    // Proves this went through the outer catch (null.maintenance throws).
    expect(warn).toHaveBeenCalled()
  })

  it('"[]": spreads as a no-op object, parsed.maintenance is undefined -> no throw, resolves like defaultState', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    localStorage.setItem(KEY, '[]')
    const result = loadState()
    expect(result).toEqual(defaultState)
    expect(Array.isArray(result.shots)).toBe(true)
    expect(typeof result.maintenance).toBe('object')
    expect(warn).not.toHaveBeenCalled()
  })

  it('"42": a boxed-primitive spread is also a no-op, (42).maintenance is undefined -> no throw, resolves like defaultState', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    localStorage.setItem(KEY, '42')
    const result = loadState()
    expect(result).toEqual(defaultState)
    expect(Array.isArray(result.shots)).toBe(true)
    expect(typeof result.maintenance).toBe('object')
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('saveState / clearState', () => {
  it('round-trips through saveState -> loadState', () => {
    const custom = {
      ...defaultState,
      units: 'imperial' as const,
      displayName: 'Rich',
      maintenance: { ...defaultMaintenanceRecord, shotsSinceBackflush: 12 },
    }
    saveState(custom)
    expect(loadState()).toEqual(custom)
  })

  it('clearState removes the persisted key', () => {
    saveState(defaultState)
    expect(localStorage.getItem(KEY)).not.toBeNull()
    clearState()
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(loadState()).toEqual(defaultState)
  })
})

describe('saveState error handling', () => {
  it('does not throw when localStorage.setItem throws (e.g. quota exceeded)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    expect(() => saveState(defaultState)).not.toThrow()
    expect(warn).toHaveBeenCalled()
    setItemSpy.mockRestore()
  })
})
