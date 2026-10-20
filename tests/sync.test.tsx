// The data layer rewrite (2026-10-05): what reaches Supabase and when, who
// owns the data on a device, and what MERGE / RESET do. Real reducer and
// real hook under @testing-library/react; supabase helpers mocked.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { ShotEntry, BrewmieState } from '../src/types'

const calls = vi.hoisted(() => ({
  upsertShot: vi.fn(async () => ({ error: null })),
  upsertPublicShot: vi.fn(async () => ({ error: null })),
  upsertUserConfig: vi.fn(async () => ({ error: null })),
  bulkUpsertShots: vi.fn(async () => ({ error: null as { message: string } | null })),
  deleteShot: vi.fn(async () => ({ error: null })),
}))
vi.mock('../src/lib/supabase', () => calls)

import { markConfigHydrated, resetHydration } from '../src/lib/hydration'
import { useBrewmie } from '../src/hooks/useBrewmie'
import { defaultState } from '../src/lib/storage'
// The one real function under test from the otherwise-mocked module.
const { normaliseShotRow } = await vi.importActual<typeof import('../src/lib/supabase')>('../src/lib/supabase')

function shot(id: string, over: Partial<ShotEntry> = {}): ShotEntry {
  return {
    id, timestamp: '2026-10-01T08:00:00.000Z',
    inputGrind: 15, inputDose: 18, inputTamp: 50, targetVolume: 36, targetTime: 27,
    actualVolume: 36, actualTime: 27, score: 100,
    grindAdjust: 0, doseAdjust: 0, volumeAdjust: 0, timeAdjust: 0, tampAdjust: 0,
    crema: null, tasteFlavor: null, tasteStrength: null, beanAge: null, roastLevel: null, temp: null, humidity: null,
    ...over,
  }
}

function seed(state: Partial<BrewmieState>) {
  localStorage.setItem('brewmie_v2', JSON.stringify({ ...defaultState, ...state }))
}
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

beforeEach(() => {
  localStorage.clear()
  for (const fn of Object.values(calls)) fn.mockClear()
  calls.bulkUpsertShots.mockImplementation(async () => ({ error: null }))
})

describe('backfill of existing shots to the signed-in account', () => {
  it('runs once on mount, uploads every local shot, and marks the account done', async () => {
    seed({ userId: 'A', dataOwnerId: 'A', shots: [shot('1'), shot('2'), shot('3')] })
    renderHook(() => useBrewmie())
    await flush()
    expect(calls.bulkUpsertShots).toHaveBeenCalledTimes(1)
    const [shots, uid] = calls.bulkUpsertShots.mock.calls[0] as unknown as [ShotEntry[], string]
    expect(shots.map((s) => s.id)).toEqual(['1', '2', '3'])
    expect(uid).toBe('A')
    expect(localStorage.getItem('brewmie_backfill_v1:A')).toBe('1')
    expect(calls.upsertShot).not.toHaveBeenCalled()
    expect(calls.upsertPublicShot).not.toHaveBeenCalled()
  })

  it('does not mark the account done when the server rejects the rows, so the next launch retries', async () => {
    calls.bulkUpsertShots.mockImplementation(async () => ({ error: { message: "Could not find the 'beanAge' column" } }))
    seed({ userId: 'A', dataOwnerId: 'A', shots: [shot('1')] })
    renderHook(() => useBrewmie())
    await flush()
    expect(localStorage.getItem('brewmie_backfill_v1:A')).toBeNull()
  })

  it('is skipped once the flag is set', async () => {
    localStorage.setItem('brewmie_backfill_v1:A', '1')
    seed({ userId: 'A', dataOwnerId: 'A', shots: [shot('1')] })
    renderHook(() => useBrewmie())
    await flush()
    expect(calls.bulkUpsertShots).not.toHaveBeenCalled()
  })
})

describe('change-based sync', () => {
  it('a new shot syncs once to the account and once to the public dataset', async () => {
    seed({ userId: 'A', dataOwnerId: 'A', shots: [shot('1')] })
    localStorage.setItem('brewmie_backfill_v1:A', '1')
    const { result } = renderHook(() => useBrewmie())
    await flush()
    act(() => result.current.dispatch({ type: 'ADD_SHOT', payload: shot('2', { score: 88 }) }))
    await flush()
    expect(calls.upsertShot).toHaveBeenCalledTimes(1)
    expect((calls.upsertShot.mock.calls[0] as unknown as [ShotEntry, string])[0].id).toBe('2')
    expect(calls.upsertPublicShot).toHaveBeenCalledTimes(1)
    expect((calls.upsertPublicShot.mock.calls[0] as unknown as [ShotEntry])[0].id).toBe('2')
  })

  it('an edited shot (taste added later) syncs to the account and is NOT re-posted publicly', async () => {
    seed({ userId: 'A', dataOwnerId: 'A', shots: [shot('1')] })
    localStorage.setItem('brewmie_backfill_v1:A', '1')
    const { result } = renderHook(() => useBrewmie())
    await flush()
    act(() => result.current.dispatch({ type: 'UPDATE_SHOT', payload: { id: '1', updates: { tasteFlavor: 'sour' } } }))
    await flush()
    expect(calls.upsertShot).toHaveBeenCalledTimes(1)
    expect((calls.upsertShot.mock.calls[0] as unknown as [ShotEntry, string])[0].tasteFlavor).toBe('sour')
    expect(calls.upsertPublicShot).not.toHaveBeenCalled()
  })

  it('deleting a shot writes no upserts, sends one server delete and leaves a tombstone (audit brewmie-02)', async () => {
    seed({ userId: 'A', dataOwnerId: 'A', shots: [shot('1'), shot('2')] })
    localStorage.setItem('brewmie_backfill_v1:A', '1')
    const { result } = renderHook(() => useBrewmie())
    await flush()
    act(() => result.current.dispatch({ type: 'DELETE_SHOT', payload: '2' }))
    await flush()
    expect(calls.upsertShot).not.toHaveBeenCalled()
    expect(calls.upsertPublicShot).not.toHaveBeenCalled()
    expect(calls.deleteShot).toHaveBeenCalledTimes(1)
    expect(calls.deleteShot).toHaveBeenCalledWith('2')
    expect(result.current.state.deletedShotIds).toEqual(['2'])
  })

  it('a hydrate from the server unions with local shots and never resurrects a tombstone', async () => {
    seed({ userId: 'A', dataOwnerId: 'A', shots: [shot('1'), shot('2')], deletedShotIds: ['9'] })
    localStorage.setItem('brewmie_backfill_v1:A', '1')
    const { result } = renderHook(() => useBrewmie())
    await flush()
    act(() => result.current.dispatch({ type: 'HYDRATE_SHOTS', payload: [shot('2'), shot('3'), shot('9')] }))
    expect(result.current.state.shots.map((s) => s.id).sort()).toEqual(['1', '2', '3'])
  })

  it('launching with shots already present posts nothing publicly (the old code re-posted the newest shot every launch)', async () => {
    seed({ userId: null, shots: [shot('1'), shot('2')] })
    renderHook(() => useBrewmie())
    await flush()
    expect(calls.upsertPublicShot).not.toHaveBeenCalled()
  })

  it('signed out: a new shot goes to the public dataset only', async () => {
    seed({ userId: null, shots: [] })
    const { result } = renderHook(() => useBrewmie())
    await flush()
    act(() => result.current.dispatch({ type: 'ADD_SHOT', payload: shot('9') }))
    await flush()
    expect(calls.upsertShot).not.toHaveBeenCalled()
    expect(calls.upsertPublicShot).toHaveBeenCalledTimes(1)
  })

  it('analytics opt-out stops the public write', async () => {
    seed({ userId: null, shots: [] })
    localStorage.setItem('analyticsOptOut', 'true')
    const { result } = renderHook(() => useBrewmie())
    await flush()
    act(() => result.current.dispatch({ type: 'ADD_SHOT', payload: shot('9') }))
    await flush()
    expect(calls.upsertPublicShot).not.toHaveBeenCalled()
  })

  it('a failed sync is logged, not thrown, and not retried on an unrelated change', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    calls.upsertShot.mockImplementationOnce(async () => ({ error: { message: 'nope' } }))
    seed({ userId: 'A', dataOwnerId: 'A', shots: [] })
    localStorage.setItem('brewmie_backfill_v1:A', '1')
    const { result } = renderHook(() => useBrewmie())
    await flush()
    act(() => result.current.dispatch({ type: 'ADD_SHOT', payload: shot('1') }))
    await flush()
    act(() => result.current.dispatch({ type: 'SET_AUTO_APPLY', payload: true }))
    await flush()
    expect(calls.upsertShot).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith('[Brewmie] shot sync failed:', 'nope')
    warn.mockRestore()
  })
})

describe('who owns the data on this device', () => {
  it('a different account signing in starts clean and uploads nothing of the previous account', async () => {
    seed({ userId: null, dataOwnerId: 'A', shots: [shot('1')], machine: { brand: 'Gaggia', model: 'Classic', basketSize: 18, basketType: 'stock', shotTemp: 93 }, tier: 'premium' })
    const { result } = renderHook(() => useBrewmie())
    await flush()
    act(() => result.current.dispatch({ type: 'SET_USER', payload: 'B' }))
    await flush()
    expect(result.current.state.shots).toEqual([])
    expect(result.current.state.machine).toBeNull()
    expect(result.current.state.tier).toBe('free')
    expect(result.current.state.dataOwnerId).toBe('B')
    expect(calls.bulkUpsertShots).not.toHaveBeenCalled()
  })

  it('the same account signing back in after sign-out keeps everything', async () => {
    seed({ userId: 'A', dataOwnerId: 'A', shots: [shot('1')] })
    localStorage.setItem('brewmie_backfill_v1:A', '1')
    const { result } = renderHook(() => useBrewmie())
    act(() => result.current.dispatch({ type: 'SET_USER', payload: null }))
    expect(result.current.state.shots).toHaveLength(1)
    expect(result.current.state.userId).toBeNull()
    act(() => result.current.dispatch({ type: 'SET_USER', payload: 'A' }))
    expect(result.current.state.shots).toHaveLength(1)
    expect(result.current.state.dataOwnerId).toBe('A')
  })

  it('data recorded while signed out belongs to whoever signs in first', async () => {
    seed({ userId: null, shots: [shot('1')] })
    const { result } = renderHook(() => useBrewmie())
    await flush()
    act(() => result.current.dispatch({ type: 'SET_USER', payload: 'A' }))
    await flush()
    expect(result.current.state.shots).toHaveLength(1)
    expect(result.current.state.dataOwnerId).toBe('A')
    expect(calls.bulkUpsertShots).toHaveBeenCalledTimes(1)
  })

  it('a save from before dataOwnerId existed infers the owner from the persisted userId', async () => {
    localStorage.setItem('brewmie_v2', JSON.stringify({ ...defaultState, userId: 'A', shots: [shot('1')] }))
    const { result } = renderHook(() => useBrewmie())
    act(() => result.current.dispatch({ type: 'SET_USER', payload: null }))
    expect(result.current.state.dataOwnerId).toBe('A')
    act(() => result.current.dispatch({ type: 'SET_USER', payload: 'B' }))
    expect(result.current.state.shots).toEqual([])
  })
})

describe('MERGE and RESET', () => {
  it('MERGE applies a partial over the live state and never downgrades premium to free', () => {
    seed({ userId: 'A', dataOwnerId: 'A', tier: 'premium', units: 'imperial' })
    const { result } = renderHook(() => useBrewmie())
    act(() => result.current.dispatch({ type: 'MERGE', payload: { shots: [shot('7')], tier: 'free' } }))
    expect(result.current.state.shots.map((s) => s.id)).toEqual(['7'])
    expect(result.current.state.units).toBe('imperial')
    expect(result.current.state.tier).toBe('premium')
  })

  it('RESET clears the persisted state and returns to defaults', () => {
    seed({ userId: 'A', dataOwnerId: 'A', shots: [shot('1')] })
    const { result } = renderHook(() => useBrewmie())
    act(() => result.current.dispatch({ type: 'RESET' }))
    expect(result.current.state.shots).toEqual([])
    expect(result.current.state.userId).toBeNull()
    // the persist effect writes defaults straight back, which is the intended end state
    expect(JSON.parse(localStorage.getItem('brewmie_v2') || '{}').shots).toEqual([])
  })
})

describe('normaliseShotRow', () => {
  it('maps a legacy row (grind/dose/tamp columns, no camelCase fields) onto a usable ShotEntry', () => {
    const row = { id: 'x', timestamp: '2026-05-01T00:00:00Z', grind: 12.5, dose: 18, tamp: 50, actualVolume: 36, actualTime: 27, score: 90, user_id: 'A', created_at: 'whatever' } as never
    const s = normaliseShotRow(row)
    expect(s.inputGrind).toBe(12.5)
    expect(s.inputDose).toBe(18)
    expect(s.inputTamp).toBe(50)
    expect(s.targetVolume).toBe(0)
    expect(s.crema).toBeNull()
    expect((s as unknown as Record<string, unknown>).user_id).toBeUndefined()
  })
  it('prefers the camelCase columns when both exist', () => {
    const s = normaliseShotRow({ id: 'y', timestamp: 't', inputGrind: 20, grind: 12 } as never)
    expect(s.inputGrind).toBe(20)
  })
})

describe('config sync waits for the hydrate (audit brewmie-07)', () => {
  it('a fresh sign-in does not push the empty device config before the profile has been hydrated', async () => {
    resetHydration()
    seed({ userId: 'A', dataOwnerId: 'A', shots: [] })
    localStorage.setItem('brewmie_backfill_v1:A', '1')
    const { result } = renderHook(() => useBrewmie())
    await flush()
    expect(calls.upsertUserConfig).not.toHaveBeenCalled()
    markConfigHydrated('A')
    act(() => result.current.dispatch({ type: 'SET_UNITS', payload: 'imperial' }))
    await flush()
    expect(calls.upsertUserConfig).toHaveBeenCalledTimes(1)
  })
})

describe('community uploads are for shots recorded this session (audit brewmie-06)', () => {
  it('shots that arrive from the server on sign-in are not re-posted publicly', async () => {
    seed({ userId: 'A', dataOwnerId: 'A', shots: [] })
    localStorage.setItem('brewmie_backfill_v1:A', '1')
    const { result } = renderHook(() => useBrewmie())
    await flush()
    const old = { ...shot('h1'), timestamp: '2026-01-01T10:00:00.000Z' }
    act(() => result.current.dispatch({ type: 'HYDRATE_SHOTS', payload: [old, { ...shot('h2'), timestamp: '2026-02-01T10:00:00.000Z' }] }))
    await flush()
    expect(calls.upsertPublicShot).not.toHaveBeenCalled()
  })
  it('a shot recorded now is still posted once', async () => {
    seed({ userId: null, shots: [] })
    const { result } = renderHook(() => useBrewmie())
    await flush()
    act(() => result.current.dispatch({ type: 'ADD_SHOT', payload: { ...shot('n1'), timestamp: new Date().toISOString() } }))
    await flush()
    expect(calls.upsertPublicShot).toHaveBeenCalledTimes(1)
  })
})
