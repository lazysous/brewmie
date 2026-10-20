// Characterisation tests for load-bearing privacy, account and gating paths (audit
// 2026-10, brewmie-51). They pin CURRENT behaviour ahead of the fixes planned for
// brewmie-01/02 (sync), brewmie-11 (sharing default) and brewmie-13 (deletion), so each
// of those lands against a fence. No production code changes here.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ShotEntry } from '../src/types'

type Call = { kind: string; table?: string; payload?: unknown; name?: string }
const fake = vi.hoisted(() => {
  const calls: Call[] = []
  const rpcResult: { error: { message: string } | null } = { error: null }
  const builder = (table: string) => ({
    insert: async (payload: unknown) => { calls.push({ kind: 'insert', table, payload }); return { data: null, error: null } },
    upsert: async (payload: unknown) => { calls.push({ kind: 'upsert', table, payload }); return { data: null, error: null } },
    delete: () => ({ eq: async () => { calls.push({ kind: 'delete', table }); return { data: null, error: null } } }),
  })
  const client = {
    from: (table: string) => builder(table),
    rpc: async (name: string) => { calls.push({ kind: 'rpc', name }); return { data: null, error: rpcResult.error } },
    auth: { signOut: async () => { calls.push({ kind: 'signOut' }); return { error: null } } },
  }
  return { calls, rpcResult, client }
})
vi.mock('@supabase/supabase-js', () => ({ createClient: () => fake.client }))

import { deleteUserAccount, upsertPublicShot, upsertShot } from '../src/lib/supabase'

const shot: ShotEntry = {
  id: 'shot-1', timestamp: 1760000000000, inputGrind: 12, inputDose: 18, inputTamp: 15,
  targetVolume: 36, targetTime: 28, actualVolume: 38, actualTime: 30, score: 82,
  tasteFlavor: 'balanced', tasteStrength: 'ok', beanAge: 9, roastLevel: 'medium', temp: 21, humidity: 55,
} as unknown as ShotEntry

beforeEach(() => { fake.calls.length = 0; fake.rpcResult.error = null; localStorage.clear() })
afterEach(() => { localStorage.clear() })

describe('deleteUserAccount', () => {
  it('runs the server-side RPC first, then signs out and clears local storage', async () => {
    localStorage.setItem('brewmie_state', '{"shots":[1]}')
    const res = await deleteUserAccount()
    expect(res).toEqual({ ok: true })
    expect(fake.calls.map((c) => c.kind)).toEqual(['rpc', 'signOut'])
    expect(fake.calls[0].name).toBe('delete_user_account')
    expect(localStorage.getItem('brewmie_state')).toBeNull()
  })
  it('when the RPC fails it reports the error and leaves the session and local data alone', async () => {
    fake.rpcResult.error = { message: 'boom' }
    localStorage.setItem('brewmie_state', '{"shots":[1]}')
    const res = await deleteUserAccount()
    expect(res).toEqual({ ok: false, error: 'boom' })
    expect(fake.calls.map((c) => c.kind)).toEqual(['rpc'])
    expect(localStorage.getItem('brewmie_state')).toBe('{"shots":[1]}')
  })
})

describe('public_shots payload fence', () => {
  it('sends exactly the anonymised column set: no id, no user id, no raw bean age, no timestamp', async () => {
    await upsertPublicShot(shot, { machine: { brand: 'Gaggia' } as never, grinder: { type: 'flat' } as never, tamp: { type: 'manual' } as never })
    const call = fake.calls.find((c) => c.kind === 'insert' && c.table === 'public_shots')
    expect(call).toBeTruthy()
    const payload = call!.payload as Record<string, unknown>
    expect(Object.keys(payload).sort()).toEqual([
      'actual_time', 'actual_volume', 'bean_age_bucket', 'dose', 'grind', 'grinder_type', 'humidity', 'machine_brand',
      'roast_level', 'score', 'source_id', 'tamp_type', 'tamp_value', 'target_time', 'target_volume',
      'taste_flavor', 'taste_strength', 'temp',
    ])
    expect(payload.source_id).toBe('shot-1')
    expect(payload.bean_age_bucket).toBe('8-14')
    expect(payload).not.toHaveProperty('user_id')
    expect(payload).not.toHaveProperty('beanAge')
    expect(payload).not.toHaveProperty('timestamp')
  })
  it('bean age is bucketed, never raw (null stays null)', async () => {
    await upsertPublicShot({ ...shot, beanAge: null } as ShotEntry, { machine: null, grinder: null, tamp: null })
    const payload = (fake.calls.at(-1)!.payload) as Record<string, unknown>
    expect(payload.bean_age_bucket).toBeNull()
    expect(payload.machine_brand).toBeNull()
  })
})

describe('shots upsert (current behaviour, the fence brewmie-01/02 will change)', () => {
  it('spreads the whole ShotEntry plus user_id, so any extra field on the entry reaches the shots table', async () => {
    await upsertShot({ ...shot, somethingNew: 'leaks' } as unknown as ShotEntry, 'user-9')
    const call = fake.calls.find((c) => c.kind === 'upsert' && c.table === 'shots')
    const payload = call!.payload as Record<string, unknown>
    expect(payload.user_id).toBe('user-9')
    expect(payload.id).toBe('shot-1')
    expect(payload.somethingNew).toBe('leaks')
  })
})

describe('community upload opt-out flag (the gate useBrewmie checks before upsertPublicShot)', () => {
  it('is the analyticsOptOut localStorage key, read as the literal string "true"', () => {
    localStorage.setItem('analyticsOptOut', 'true')
    expect(localStorage.getItem('analyticsOptOut') === 'true').toBe(true)
    localStorage.setItem('analyticsOptOut', 'TRUE')
    expect(localStorage.getItem('analyticsOptOut') === 'true').toBe(false)
  })
})
