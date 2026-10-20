// fetchShots pages through the PostgREST row cap (audit brewmie-61).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const fake = vi.hoisted(() => {
  const ranges: Array<[number, number]> = []
  let pages: unknown[][] = []
  const builder = () => {
    const b = {
      select: () => b, eq: () => b, order: () => b,
      range: async (from: number, to: number) => { ranges.push([from, to]); const i = Math.floor(from / 1000); return { data: pages[i] ?? [], error: null } },
    }
    return b
  }
  return { ranges, setPages: (p: unknown[][]) => { pages = p }, client: { from: () => builder(), rpc: async () => ({ data: null, error: null }), auth: { signOut: async () => ({ error: null }) } } }
})
vi.mock('@supabase/supabase-js', () => ({ createClient: () => fake.client }))
import { fetchShots, FETCH_PAGE } from '../src/lib/supabase'

const row = (i: number) => ({ id: `s${i}`, timestamp: '2026-10-21T10:00:00.000Z', inputGrind: 1, inputDose: 18, inputTamp: 1, targetVolume: 36, targetTime: 28, actualVolume: 36, actualTime: 28 })

beforeEach(() => { fake.ranges.length = 0 })

describe('fetchShots', () => {
  it('stops after one short page', async () => {
    fake.setPages([[row(1), row(2)]])
    const out = await fetchShots('u1')
    expect(out).toHaveLength(2)
    expect(fake.ranges).toEqual([[0, FETCH_PAGE - 1]])
  })
  it('keeps requesting while pages are full and concatenates them', async () => {
    fake.setPages([Array.from({ length: FETCH_PAGE }, (_, i) => row(i)), [row(9999)]])
    const out = await fetchShots('u1')
    expect(out).toHaveLength(FETCH_PAGE + 1)
    expect(fake.ranges).toEqual([[0, FETCH_PAGE - 1], [FETCH_PAGE, 2 * FETCH_PAGE - 1]])
  })
})
