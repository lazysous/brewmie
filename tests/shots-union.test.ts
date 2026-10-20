// Shot merge rules (audit brewmie-01 / -02 / -61).
import { describe, it, expect } from 'vitest'
import { unionShots, localOnly, addTombstone, MAX_TOMBSTONES } from '../src/lib/shots'
import type { ShotEntry } from '../src/types'

const shot = (id: string, ts: string, extra: Partial<ShotEntry> = {}) => ({ id, timestamp: ts, inputGrind: 1, ...extra } as unknown as ShotEntry)

describe('unionShots', () => {
  it('keeps local-only shots, takes the server copy for shared ids, newest first', () => {
    const local = [shot('a', '2026-10-21T10:00:00.000Z', { score: 50 }), shot('b', '2026-10-20T10:00:00.000Z')]
    const server = [shot('a', '2026-10-21T10:00:00.000Z', { score: 80 }), shot('c', '2026-10-22T10:00:00.000Z')]
    const out = unionShots(local, server)
    expect(out.map((s) => s.id)).toEqual(['c', 'a', 'b'])
    expect(out.find((s) => s.id === 'a')!.score).toBe(80)
  })
  it('never resurrects a tombstoned id, from either side', () => {
    const out = unionShots([shot('x', '2026-10-21T10:00:00.000Z')], [shot('x', '2026-10-21T10:00:00.000Z'), shot('y', '2026-10-21T11:00:00.000Z')], ['x'])
    expect(out.map((s) => s.id)).toEqual(['y'])
  })
  it('an empty server list keeps every local shot (the old code replaced the list)', () => {
    const local = [shot('a', '2026-10-21T10:00:00.000Z')]
    expect(unionShots(local, [])).toEqual(local)
  })
})

describe('localOnly', () => {
  it('returns the shots the server lacks, excluding tombstones', () => {
    const local = [shot('a', '2026-10-21T10:00:00.000Z'), shot('b', '2026-10-20T10:00:00.000Z'), shot('d', '2026-10-19T10:00:00.000Z')]
    expect(localOnly(local, [shot('a', '2026-10-21T10:00:00.000Z')], ['d']).map((s) => s.id)).toEqual(['b'])
  })
})

describe('addTombstone', () => {
  it('appends once and stays bounded', () => {
    expect(addTombstone(undefined, 'a')).toEqual(['a'])
    expect(addTombstone(['a'], 'a')).toEqual(['a'])
    const many = Array.from({ length: MAX_TOMBSTONES }, (_, i) => `s${i}`)
    const out = addTombstone(many, 'new')
    expect(out).toHaveLength(MAX_TOMBSTONES)
    expect(out.at(-1)).toBe('new')
    expect(out[0]).toBe('s1')
  })
})
