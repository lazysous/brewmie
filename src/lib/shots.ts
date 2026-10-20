// Shot-list merge rules (audit 2026-10, brewmie-01 / brewmie-02). Hydrating from the server
// used to REPLACE the local list, so a shot that never uploaded (recorded signed out, or
// while a sync failed) was thrown away the next time the account loaded. Now the lists are
// unioned: the server copy wins for an id both sides hold, local-only shots are kept (and
// uploaded by the caller), and ids the user deleted on this device (tombstones) never come
// back from the server.
import type { ShotEntry } from '../types'

export const MAX_TOMBSTONES = 500

export function unionShots(local: ShotEntry[], server: ShotEntry[], deletedIds: readonly string[] = []): ShotEntry[] {
  const dead = new Set(deletedIds)
  const byId = new Map<string, ShotEntry>()
  for (const s of local) if (s && s.id && !dead.has(s.id)) byId.set(s.id, s)
  for (const s of server) if (s && s.id && !dead.has(s.id)) byId.set(s.id, s)
  return [...byId.values()].sort((a, b) => (b.timestamp > a.timestamp ? 1 : b.timestamp < a.timestamp ? -1 : 0))
}

/** Local shots the server does not hold (the ones to upload after a hydrate). */
export function localOnly(local: ShotEntry[], server: ShotEntry[], deletedIds: readonly string[] = []): ShotEntry[] {
  const have = new Set(server.map((s) => s.id))
  const dead = new Set(deletedIds)
  return local.filter((s) => s && s.id && !have.has(s.id) && !dead.has(s.id))
}

/** Append a deleted id to the tombstone list, newest last, bounded. */
export function addTombstone(ids: readonly string[] | undefined, id: string): string[] {
  const next = (ids ?? []).filter((x) => x !== id)
  next.push(id)
  return next.length > MAX_TOMBSTONES ? next.slice(next.length - MAX_TOMBSTONES) : next
}
