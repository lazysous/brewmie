// Local notification scheduler. Re-runs on app open + after shot save so
// reminders track current state. Native-only (Capacitor); no-op on web.
//
// Three reminder kinds:
//   1. Backflush due — every BACKFLUSH_INTERVAL_DAYS after lastBackflush
//   2. Descale due — every DESCALE_INTERVAL_DAYS after lastDescale
//   3. Bean age stale — STALE_AGE_DAYS after roastDate
//
// IDs are stable per-kind so re-scheduling overwrites instead of stacking.

import { scheduleLocalNotification, cancelLocalNotification } from './native'
import type { BrewmieState } from '../types'

const ID_BACKFLUSH = 1001
const ID_DESCALE = 1002
const ID_GRINDER_CLEAN = 1003
const ID_BEANS_STALE = 1004

const BACKFLUSH_INTERVAL_DAYS = 14
const DESCALE_INTERVAL_DAYS = 90
const GRINDER_CLEAN_INTERVAL_DAYS = 28
const STALE_AGE_DAYS = 30

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

function isoToDate(iso: string | null): Date | null {
  if (!iso) return null
  const d = new Date(iso)
  return isNaN(d.getTime()) ? null : d
}

export async function rescheduleAllReminders(state: BrewmieState): Promise<void> {
  // Backflush
  const lastBackflush = isoToDate(state.maintenance?.lastBackflush ?? null)
  if (lastBackflush) {
    const at = addDays(lastBackflush, BACKFLUSH_INTERVAL_DAYS)
    if (at > new Date()) {
      await scheduleLocalNotification({
        id: ID_BACKFLUSH,
        title: 'Backflush due',
        body: "Two weeks since your last backflush. A quick clean keeps shots clean.",
        at,
      })
    } else {
      // Overdue — fire in 1 minute
      await scheduleLocalNotification({
        id: ID_BACKFLUSH,
        title: 'Backflush overdue',
        body: 'Your group head is overdue for a backflush.',
        at: new Date(Date.now() + 60_000),
      })
    }
  } else {
    await cancelLocalNotification(ID_BACKFLUSH)
  }

  // Descale
  const lastDescale = isoToDate(state.maintenance?.lastDescale ?? null)
  if (lastDescale) {
    const at = addDays(lastDescale, DESCALE_INTERVAL_DAYS)
    if (at > new Date()) {
      await scheduleLocalNotification({
        id: ID_DESCALE,
        title: 'Descale due',
        body: 'Three months since your last descale.',
        at,
      })
    }
  } else {
    await cancelLocalNotification(ID_DESCALE)
  }

  // Grinder clean
  const lastGrinderClean = isoToDate(state.maintenance?.lastGrinderClean ?? null)
  if (lastGrinderClean) {
    const at = addDays(lastGrinderClean, GRINDER_CLEAN_INTERVAL_DAYS)
    if (at > new Date()) {
      await scheduleLocalNotification({
        id: ID_GRINDER_CLEAN,
        title: 'Grinder clean due',
        body: 'Four weeks since your grinder got a clean.',
        at,
      })
    }
  } else {
    await cancelLocalNotification(ID_GRINDER_CLEAN)
  }

  // Bean age — schedule for when current bag hits STALE_AGE_DAYS
  const roast = isoToDate(state.beans?.roastDate ?? null)
  if (roast) {
    const at = addDays(roast, STALE_AGE_DAYS)
    if (at > new Date()) {
      await scheduleLocalNotification({
        id: ID_BEANS_STALE,
        title: 'Beans getting stale',
        body: "Your beans hit 30 days from roast today. Time to think about a new bag.",
        at,
      })
    }
  } else {
    await cancelLocalNotification(ID_BEANS_STALE)
  }
}
