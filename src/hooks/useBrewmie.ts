import { useReducer, useEffect, useRef, useCallback } from 'react'
import type { BrewmieState, AppAction, ShotEntry } from '../types'
import { loadState, saveState, clearState, defaultState, defaultMaintenanceRecord } from '../lib/storage'
import { upsertShot, upsertPublicShot, upsertUserConfig, bulkUpsertShots } from '../lib/supabase'
import { track } from '../lib/analytics'
import { unionShots, addTombstone } from '../lib/shots'
import { isConfigHydrated } from '../lib/hydration'
import { deleteShot } from '../lib/supabase'

// ─── Reducer ──────────────────────────────────────────────────────────────────

// Everything that belongs to an account, as opposed to the device.
function wipeAccountData(state: BrewmieState): BrewmieState {
  return {
    ...state,
    shots: [],
    machine: null,
    grinder: null,
    tamp: null,
    beans: null,
    currentGrind: null,
    maintenance: { ...defaultMaintenanceRecord },
    displayName: null,
    tier: 'free',
  }
}

function brewmieReducer(state: BrewmieState, action: AppAction): BrewmieState {
  switch (action.type) {
    case 'SET_UNITS':
      return { ...state, units: action.payload }

    case 'SET_MACHINE':
      return { ...state, machine: action.payload }

    case 'SET_GRINDER':
      return { ...state, grinder: action.payload }

    case 'SET_TAMP':
      return { ...state, tamp: action.payload }

    case 'SET_BEANS':
      return { ...state, beans: action.payload }

    case 'SET_CURRENT_GRIND':
      return { ...state, currentGrind: action.payload }

    case 'ADD_SHOT': {
      const updated = [action.payload, ...state.shots]
      return {
        ...state,
        shots: updated,
        maintenance: {
          ...state.maintenance,
          shotsSinceBackflush: state.maintenance.shotsSinceBackflush + 1,
          shotsSinceDescale: state.maintenance.shotsSinceDescale + 1,
        },
      }
    }

    case 'UPDATE_SHOT':
      return {
        ...state,
        shots: state.shots.map((s) =>
          s.id === action.payload.id ? { ...s, ...action.payload.updates } : s
        ),
      }

    case 'DELETE_SHOT':
      return {
        ...state,
        shots: state.shots.filter((s) => s.id !== action.payload),
        // Tombstone so the next hydrate from the server does not bring it back.
        deletedShotIds: addTombstone(state.deletedShotIds, action.payload),
      }

    case 'HYDRATE_SHOTS':
      // Union, never replace: local-only shots survive, the server copy wins for shared
      // ids, tombstoned ids stay gone (audit brewmie-01 / brewmie-02).
      return { ...state, shots: unionShots(state.shots, action.payload, state.deletedShotIds ?? []) }

    case 'UPDATE_MAINTENANCE':
      return {
        ...state,
        maintenance: { ...state.maintenance, ...action.payload },
      }

    case 'SET_AUTO_APPLY':
      return { ...state, autoApplyAdjustments: action.payload }

    case 'SET_USER': {
      const uid = action.payload
      // The account the local data belongs to. Older saves have no
      // dataOwnerId; the persisted userId is the next best evidence.
      const owner = state.dataOwnerId ?? state.userId ?? null
      if (uid === null) {
        // Sign-out keeps the data on the device (the same person signing
        // back in finds everything) but remembers whose it is.
        return { ...state, userId: null, displayName: null, dataOwnerId: owner }
      }
      if (owner !== null && owner !== uid) {
        // A different account on this device: start clean rather than show
        // the previous account's shots and upload them under the new id.
        return { ...wipeAccountData(state), userId: uid, dataOwnerId: uid }
      }
      return { ...state, userId: uid, dataOwnerId: uid }
    }

    case 'SET_DISPLAY_NAME':
      return { ...state, displayName: action.payload }

    case 'SET_TIER':
      // Premium is a one-way trip. Two effects race on launch — the IAP
      // restore callback dispatches SET_TIER:premium when the store reports
      // ownership, and fetchTier(uid) from Supabase dispatches the persisted
      // value. If Supabase hasn't been updated yet (e.g. the previous
      // purchase finished after the user backgrounded the app), the
      // Supabase path would otherwise overwrite premium back to free.
      if (state.tier === 'premium' && action.payload === 'free') return state
      return { ...state, tier: action.payload }

    case 'MERGE': {
      const { tier, ...rest } = action.payload
      const next = { ...state, ...rest }
      if (tier !== undefined && !(state.tier === 'premium' && tier === 'free')) next.tier = tier
      return next
    }

    case 'HYDRATE':
      return action.payload

    case 'RESET':
      clearState()
      return { ...defaultState }

    default:
      return state
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseBrewmieReturn {
  state: BrewmieState
  dispatch: React.Dispatch<AppAction>
  /** Convenience: true once initial hydration from localStorage is done */
  isReady: boolean
}

// One backfill per account per device. Set only after the server accepted
// the rows, so a failed attempt is retried on the next launch.
const BACKFILL_FLAG_PREFIX = 'brewmie_backfill_v1:'

function readFlag(key: string): boolean {
  try { return localStorage.getItem(key) === '1' } catch { return false }
}
function writeFlag(key: string): void {
  try { localStorage.setItem(key, '1') } catch { /* ignore */ }
}

export function useBrewmie(): UseBrewmieReturn {
  // Initialise from localStorage on first render
  const [state, dispatch] = useReducer(brewmieReducer, undefined, () => loadState())

  // Persist to localStorage on every state change
  useEffect(() => {
    saveState(state)
  }, [state])

  // One-time backfill of the device's shots to the signed-in account. Covers
  // the first sign-in (data recorded before signing in) and every install
  // whose earlier syncs failed. Idempotent: upsert on the shot id.
  useEffect(() => {
    const uid = state.userId
    if (!uid || state.shots.length === 0) return
    const flag = BACKFILL_FLAG_PREFIX + uid
    if (readFlag(flag)) return
    let cancelled = false
    bulkUpsertShots(state.shots, uid).then(({ error }) => {
      if (cancelled) return
      if (error) {
        console.warn('[Brewmie] shot backfill failed:', error.message)
        track('sync_failed', { op: 'backfill' })
        return
      }
      writeFlag(flag)
    }).catch((err) => { console.warn('[Brewmie] shot backfill threw:', err); track('sync_failed', { op: 'backfill' }) })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.userId])

  // Deletes reach the server (audit brewmie-02): every tombstone is sent once per session
  // while signed in. A missing DELETE policy makes the call a silent no-op server side, so
  // the local tombstone stays the source of truth either way.
  const deletedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const uid = state.userId
    if (!uid) return
    for (const id of state.deletedShotIds ?? []) {
      if (deletedRef.current.has(id)) continue
      deletedRef.current.add(id)
      deleteShot(id).then(({ error }) => {
        if (error) { console.warn('[Brewmie] shot delete failed:', error.message); track('sync_failed', { op: 'delete' }) }
      }).catch(() => { track('sync_failed', { op: 'delete' }) })
    }
  }, [state.userId, state.deletedShotIds])

  // Sync shots that changed since the last render to the personal store
  // (signed-in only). Compares each shot's content, so an added shot and an
  // edited shot (taste, corrected actuals) both sync, and a deleted shot
  // causes no write. The first run only records what is there: those rows
  // are the backfill's job. Each change is attempted once; the backfill is
  // the retry path, so a broken connection does not turn every save into a
  // storm of failing requests.
  const attemptedRef = useRef<Map<string, string> | null>(null)
  useEffect(() => {
    const uid = state.userId
    const current = new Map(state.shots.map((s) => [s.id, JSON.stringify(s)]))
    if (attemptedRef.current === null || !uid) {
      attemptedRef.current = current
      return
    }
    const previous = attemptedRef.current
    attemptedRef.current = current
    for (const shot of state.shots) {
      if (previous.get(shot.id) === current.get(shot.id)) continue
      upsertShot(shot, uid).then(({ error }) => {
        if (error) { console.warn('[Brewmie] shot sync failed:', error.message); track('sync_failed', { op: 'shot' }) }
      }).catch((err) => { console.warn('[Brewmie] shot sync threw:', err); track('sync_failed', { op: 'shot' }) })
    }
  }, [state.shots, state.userId])

  // Write anonymised shots to the global dataset (anyone, respects consent).
  // One row per NEW shot. The first run only records the ids present, so a
  // launch, a hydration from the server, an edit or a delete never posts:
  // before this, the newest shot was re-posted on every launch and every
  // delete, and two thirds of the public dataset was duplicates.
  const publicSeenRef = useRef<Set<string> | null>(null)
  // Only shots recorded in THIS session are posted to the community dataset: a shot that
  // arrives from the server (sign-in on a new device, reinstall, account switch) was posted
  // when it was recorded, so re-posting it duplicated the user's whole history (audit
  // brewmie-06). A minute of slack covers clock skew between the shot and the mount.
  const sessionStartRef = useRef<number>(Date.now() - 60_000)
  useEffect(() => {
    const ids = new Set(state.shots.map((s) => s.id))
    if (publicSeenRef.current === null) {
      publicSeenRef.current = ids
      return
    }
    const seen = publicSeenRef.current
    publicSeenRef.current = ids
    let optedOut = false
    try { optedOut = localStorage.getItem('analyticsOptOut') === 'true' } catch { /* ignore */ }
    if (optedOut) return
    for (const shot of state.shots) {
      if (seen.has(shot.id)) continue
      const recordedAt = Date.parse(shot.timestamp)
      if (Number.isFinite(recordedAt) && recordedAt < sessionStartRef.current) continue
      upsertPublicShot(shot, {
        machine: state.machine,
        grinder: state.grinder,
        tamp: state.tamp,
      }).then(({ error }) => {
        if (error) { console.warn('[Brewmie] public shot write failed:', error.message); track('sync_failed', { op: 'public' }) }
      }).catch(() => { track('sync_failed', { op: 'public' }) })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.shots])

  // Sync equipment config to Supabase when setup changes. Never before this account's
  // profile has been hydrated in this session (audit brewmie-07): on a fresh device the
  // local config is empty and pushing it first wiped the saved gear profile.
  useEffect(() => {
    if (!state.userId || !isConfigHydrated(state.userId)) return
    upsertUserConfig(state.userId, {
      units: state.units,
      machine: state.machine,
      grinder: state.grinder,
      tamp: state.tamp,
      beans: state.beans,
    }).then(({ error }) => {
      if (error) { console.warn('[Brewmie] config sync failed:', error.message); track('sync_failed', { op: 'config' }) }
    }).catch(() => { track('sync_failed', { op: 'config' }) })
  }, [state.userId, state.machine, state.grinder, state.tamp, state.beans, state.units])

  return {
    state,
    dispatch,
    isReady: true,
  }
}

// ─── Action creators (optional convenience wrappers) ──────────────────────────

export function useBrewmieActions(dispatch: React.Dispatch<AppAction>) {
  const addShot = useCallback(
    (shot: ShotEntry) => dispatch({ type: 'ADD_SHOT', payload: shot }),
    [dispatch]
  )

  return { addShot }
}
