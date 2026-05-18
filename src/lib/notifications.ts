// Brewmie notification scheduler.
//
// Five kinds of local notification, each with three copy variants in
// public/translations/*.json under the `notifications.*` namespace:
//
//   1001 maintBackflush  fires at 09:00 on the backflush due day
//   1002 maintDescale    fires at 09:00 on the descale due day
//   1003 maintGrinder    fires at 09:00 on the grinder clean due day
//   1004 habitDaily      repeats every day at the user's usual brew time
//   1005 rateReminder    fires 10 min after a shot is logged if not rated
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
  | 'habitDaily'
  | 'rateReminder'

export type MaintReminderType = 'maintBackflush' | 'maintDescale' | 'maintGrinder'

export const NOTIFICATION_IDS = {
  maintBackflush: 1001,
  maintDescale: 1002,
  maintGrinder: 1003,
  habitDaily: 1004,
  rateReminder: 1005,
} as const

const RATE_REMINDER_DELAY_MS = 10 * 60 * 1000

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

function nextOccurrenceOf(hour: number, minute: number, from: Date = new Date()): Date {
  const today = atTimeOnDay(from, hour, minute)
  if (today.getTime() > from.getTime()) return today
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  return tomorrow
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
 * Schedule a daily habit nudge at the user's usual brew time. If enabled is
 * false, cancels any previously scheduled habit nudge instead.
 *
 * Capacitor LocalNotifications doesn't expose a true cross-platform "daily
 * repeat" via our thin wrapper, so we schedule the next single occurrence
 * here. The caller is expected to re-run rescheduleAllReminders() on app
 * open, which will roll the nudge forward to the next day.
 */
export async function scheduleHabitNudge(
  timeOfDay: { hour: number; minute: number },
  enabled: boolean,
  t?: Translator,
): Promise<void> {
  const id = NOTIFICATION_IDS.habitDaily
  if (!enabled) {
    await cancelLocalNotification(id)
    return
  }
  await getEnDict()
  const at = nextOccurrenceOf(timeOfDay.hour, timeOfDay.minute)
  const { title, body } = pickVariant('habitDaily', t)
  await scheduleLocalNotification({ id, title, body, at })
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

export interface HabitSettings {
  enabled: boolean
  hour: number
  minute: number
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
 * Top-level idempotent scheduler. Cancels all four notification IDs and
 * re-schedules based on the current maintenance dates plus the supplied
 * habit settings. Safe to call repeatedly (on app open, after maintenance
 * edits, after habit-time change).
 *
 * Habit settings are not yet part of BrewmieState; pass them in until the
 * setup screen lands its own field. If omitted, the habit nudge is left
 * cancelled.
 */
export async function rescheduleAllReminders(
  state: BrewmieState,
  habit?: HabitSettings,
  t?: Translator,
): Promise<void> {
  // Always cancel first so a state with no maintenance dates leaves nothing
  // pending from a previous run. rateReminder is event-driven (scheduled by
  // BrewScreen when a shot lands) so it is NOT cancelled here.
  await Promise.all([
    cancelLocalNotification(NOTIFICATION_IDS.maintBackflush),
    cancelLocalNotification(NOTIFICATION_IDS.maintDescale),
    cancelLocalNotification(NOTIFICATION_IDS.maintGrinder),
    cancelLocalNotification(NOTIFICATION_IDS.habitDaily),
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
  if (habit) {
    await scheduleHabitNudge({ hour: habit.hour, minute: habit.minute }, habit.enabled, t)
  }
}
