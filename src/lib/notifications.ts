// Brewmie notification scheduler.
//
// Seven kinds of local notification, each with three copy variants in
// public/translations/*.json under the `notifications.*` namespace:
//
//   1001 maintBackflush  fires at 09:00 on the backflush due day
//   1002 maintDescale    fires at 09:00 on the descale due day
//   1003 maintGrinder    fires at 09:00 on the grinder clean due day
//   1004 dailyPing       fires 24h after the most recent shot save
//   1005 rateReminder    fires 10 min after a shot is logged if not rated
//   1006 beansPeak       fires at 09:00 on day 7 from roastDate (positive)
//   1007 beansStale      fires at 09:00 on day 30 from roastDate
//
// Variants are picked at schedule time so the message is fixed for that
// scheduled fire. Variant selection is uniform random across the three.
//
// The translation lookup expects the active locale strings to be loaded.
// We accept a t() function so the caller can pass the same translator the
// React tree uses. If no t() is provided, English copy is loaded directly
// from public/translations/en.json so the scheduler still works outside a
// React render (e.g. fired from a Capacitor lifecycle hook).

import { scheduleLocalNotification, cancelLocalNotification } from './native'
import { loadTranslations, resolveKey, type TranslationDict } from './i18n'
import type { BrewmieState } from '../types'

export type NotificationType =
  | 'maintBackflush'
  | 'maintDescale'
  | 'maintGrinder'
  | 'dailyPing'
  | 'rateReminder'
  | 'beansPeak'
  | 'beansStale'

export type MaintReminderType = 'maintBackflush' | 'maintDescale' | 'maintGrinder'

export const NOTIFICATION_IDS = {
  maintBackflush: 1001,
  maintDescale: 1002,
  maintGrinder: 1003,
  dailyPing: 1004,
  rateReminder: 1005,
  beansPeak: 1006,
  beansStale: 1007,
} as const

const RATE_REMINDER_DELAY_MS = 10 * 60 * 1000
const DAILY_PING_DELAY_MS = 24 * 60 * 60 * 1000
const BEANS_PEAK_DAYS = 7
const BEANS_STALE_DAYS = 30

const VARIANT_COUNT = 3

// Cached English dictionary for the no-t() path. Loaded on first use.
let cachedEn: TranslationDict | null = null
async function getEnDict(): Promise<TranslationDict | null> {
  if (cachedEn) return cachedEn
  const d = await loadTranslations('en')
  if (d) cachedEn = d
  return cachedEn
}

type Translator = (key: string) => string

/**
 * Pick one of the three copy variants for the given notification type. Uses
 * Math.random so each schedule call produces a fresh roll. If the translator
 * is not provided, falls back to the cached English dictionary.
 */
export function pickVariant(
  type: NotificationType,
  t?: Translator,
): { title: string; body: string } {
  const n = Math.floor(Math.random() * VARIANT_COUNT) + 1
  const titleKey = `notifications.${type}.title${n}`
  const bodyKey = `notifications.${type}.body${n}`
  if (t) {
    return { title: t(titleKey), body: t(bodyKey) }
  }
  // Synchronous path with no t(): fall back to whatever English we've cached.
  // If nothing is cached yet, return the raw key so the caller knows to
  // pre-load by awaiting prefetchNotificationCopy() first.
  const dict = cachedEn
  return {
    title: (dict && resolveKey(titleKey, dict)) || titleKey,
    body: (dict && resolveKey(bodyKey, dict)) || bodyKey,
  }
}

/**
 * Optional warmup: load English translations into the module cache so a
 * later synchronous pickVariant() call without a t() returns real copy.
 */
export async function prefetchNotificationCopy(): Promise<void> {
  await getEnDict()
}

function atTimeOnDay(day: Date, hour: number, minute: number): Date {
  const r = new Date(day)
  r.setHours(hour, minute, 0, 0)
  return r
}


/**
 * Schedule a one-shot maintenance reminder at 09:00 local on the due day.
 * If the due day is already in the past, fires at 09:00 the next morning.
 * Re-scheduling with the same type overwrites the previous one (stable ID).
 */
export async function scheduleMaintReminder(
  type: MaintReminderType,
  dueDate: Date,
  t?: Translator,
): Promise<void> {
  await getEnDict()
  const id = NOTIFICATION_IDS[type]
  const fireDay = dueDate.getTime() < Date.now() ? new Date() : new Date(dueDate)
  let at = atTimeOnDay(fireDay, 9, 0)
  if (at.getTime() <= Date.now()) {
    // Same-day past 09:00, or recovering from an overdue: fire 09:00 tomorrow.
    const tomorrow = new Date(at)
    tomorrow.setDate(tomorrow.getDate() + 1)
    at = tomorrow
  }
  const { title, body } = pickVariant(type, t)
  await scheduleLocalNotification({ id, title, body, at })
}

/**
 * Schedule the 24-hour-after-coffee daily ping. Call this every time a shot
 * is saved. Stable ID means each new shot overwrites the previous schedule,
 * so the ping naturally rolls forward to fire 24h after the most recent shot.
 * If the user keeps brewing daily, it never fires. If they stop, it lands once.
 */
export async function scheduleDailyPing(t?: Translator): Promise<void> {
  await getEnDict()
  const id = NOTIFICATION_IDS.dailyPing
  const at = new Date(Date.now() + DAILY_PING_DELAY_MS)
  const { title, body } = pickVariant('dailyPing', t)
  await scheduleLocalNotification({ id, title, body, at })
}

export async function cancelDailyPing(): Promise<void> {
  await cancelLocalNotification(NOTIFICATION_IDS.dailyPing)
}

/**
 * Schedule bean-age reminders relative to the current bag's roast date.
 * Two notifications: a positive ping at day 7 (peak window) and a swap-out
 * nudge at day 30 (stale). Both at 09:00 local.
 */
export async function scheduleBeanReminders(
  roastDate: Date,
  t?: Translator,
): Promise<void> {
  await getEnDict()
  const now = Date.now()
  const peakAt = atTimeOnDay(addDays(roastDate, BEANS_PEAK_DAYS), 9, 0)
  const staleAt = atTimeOnDay(addDays(roastDate, BEANS_STALE_DAYS), 9, 0)
  if (peakAt.getTime() > now) {
    const { title, body } = pickVariant('beansPeak', t)
    await scheduleLocalNotification({ id: NOTIFICATION_IDS.beansPeak, title, body, at: peakAt })
  }
  if (staleAt.getTime() > now) {
    const { title, body } = pickVariant('beansStale', t)
    await scheduleLocalNotification({ id: NOTIFICATION_IDS.beansStale, title, body, at: staleAt })
  }
}

/**
 * Schedule the rate-the-taste reminder. Call this right after a shot is
 * logged. Fires 10 minutes later if the user hasn't already rated. The
 * caller must call cancelRateReminder() the moment the user rates so
 * the notification is suppressed.
 */
export async function scheduleRateReminder(t?: Translator): Promise<void> {
  await getEnDict()
  const id = NOTIFICATION_IDS.rateReminder
  const at = new Date(Date.now() + RATE_REMINDER_DELAY_MS)
  const { title, body } = pickVariant('rateReminder', t)
  await scheduleLocalNotification({ id, title, body, at })
}

export async function cancelRateReminder(): Promise<void> {
  await cancelLocalNotification(NOTIFICATION_IDS.rateReminder)
}

const BACKFLUSH_INTERVAL_DAYS = 14
const DESCALE_INTERVAL_DAYS = 90
const GRINDER_CLEAN_INTERVAL_DAYS = 28

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

function isoToDate(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const d = new Date(iso)
  return isNaN(d.getTime()) ? null : d
}

/**
 * Top-level idempotent scheduler. Cancels the date-driven notification IDs
 * and re-schedules based on the current maintenance dates and roast date.
 * Safe to call repeatedly (on app open, after maintenance edits, after
 * roast date change).
 *
 * The two event-driven notifications (rateReminder and dailyPing) are NOT
 * cancelled here: they're scheduled by the shot-save path with stable IDs
 * that overwrite on each new shot.
 */
export async function rescheduleAllReminders(
  state: BrewmieState,
  t?: Translator,
): Promise<void> {
  await Promise.all([
    cancelLocalNotification(NOTIFICATION_IDS.maintBackflush),
    cancelLocalNotification(NOTIFICATION_IDS.maintDescale),
    cancelLocalNotification(NOTIFICATION_IDS.maintGrinder),
    cancelLocalNotification(NOTIFICATION_IDS.beansPeak),
    cancelLocalNotification(NOTIFICATION_IDS.beansStale),
  ])

  const m = state.maintenance
  const lastBackflush = isoToDate(m?.lastBackflush)
  if (lastBackflush) {
    await scheduleMaintReminder('maintBackflush', addDays(lastBackflush, BACKFLUSH_INTERVAL_DAYS), t)
  }
  const lastDescale = isoToDate(m?.lastDescale)
  if (lastDescale) {
    await scheduleMaintReminder('maintDescale', addDays(lastDescale, DESCALE_INTERVAL_DAYS), t)
  }
  const lastGrinderClean = isoToDate(m?.lastGrinderClean)
  if (lastGrinderClean) {
    await scheduleMaintReminder('maintGrinder', addDays(lastGrinderClean, GRINDER_CLEAN_INTERVAL_DAYS), t)
  }
  const roastDate = isoToDate(state.beans?.roastDate)
  if (roastDate) {
    await scheduleBeanReminders(roastDate, t)
  }
}
