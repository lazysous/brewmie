import { useReducer, useEffect, useRef, useCallback } from 'react'
import type { BrewmieState, AppAction } from '../types'
import { loadState, saveState, clearState, defaultState } from '../lib/storage'
import { upsertShot, upsertPublicShot, upsertUserConfig, bulkUpsertShots } from '../lib/supabase'

// ─── Reducer ──────────────────────────────────────────────────────────────────

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
      }

    case 'UPDATE_MAINTENANCE':
      return {
        ...state,
        maintenance: { ...state.maintenance, ...action.payload },
      }

    case 'SET_AUTO_APPLY':
      return { ...state, autoApplyAdjustments: action.payload }

    case 'SET_USER':
      // Clearing user also clears their cached displayName
      return { ...state, userId: action.payload, displayName: action.payload ? state.displayName : null }

    case 'SET_DISPLAY_NAME':
      return { ...state, displayName: action.payload }

    case 'SET_TIER':
      return { ...state, tier: action.payload }

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

export function useBrewmie(): UseBrewmieReturn {
  // Initialise from localStorage on first render
  const [state, dispatch] = useReducer(brewmieReducer, undefined, () => loadState())
  const prevUserIdRef = useRef<string | null>(state.userId)

  // Persist to localStorage on every state change
  useEffect(() => {
    saveState(state)
  }, [state])

  // First-login migration: push existing localStorage shots to Supabase
  useEffect(() => {
    const prevUserId = prevUserIdRef.current
    prevUserIdRef.current = state.userId
    if (prevUserId === null && state.userId !== null && state.shots.length > 0) {
      bulkUpsertShots(state.shots, state.userId).catch(() => {})
    }
  }, [state.userId, state.shots])

  // Sync newest shot to personal Supabase store (logged-in only)
  useEffect(() => {
    if (!state.userId || state.shots.length === 0) return
    const latest = state.shots[0]
    upsertShot(latest, state.userId).catch((err) =>
      console.warn('[Brewmie] shot sync failed:', err)
    )
  }, [state.shots.length, state.userId])

  // Write anonymised shot to global dataset (anyone, respects consent)
  useEffect(() => {
    if (state.shots.length === 0) return
    if (localStorage.getItem('analyticsOptOut') === 'true') return
    const latest = state.shots[0]
    upsertPublicShot(latest, {
      machine: state.machine,
      grinder: state.grinder,
      tamp: state.tamp,
    }).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.shots.length])

  // Sync equipment config to Supabase when setup changes
  useEffect(() => {
    if (!state.userId) return
    upsertUserConfig(state.userId, {
      units: state.units,
      machine: state.machine,
      grinder: state.grinder,
      tamp: state.tamp,
      beans: state.beans,
    }).catch(() => {})
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
    (shot: Parameters<typeof brewmieReducer>[1] extends { type: 'ADD_SHOT'; payload: infer P } ? P : never) =>
      dispatch({ type: 'ADD_SHOT', payload: shot }),
    [dispatch]
  )

  return { addShot }
}
