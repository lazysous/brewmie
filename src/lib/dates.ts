// Local-date helpers (audit 2026-10, brewmie-30). Everything the user reads as a "day",
// the date picker's maximum, Insights day groups, maintenance due days, is a LOCAL
// calendar day. `toISOString().slice(0, 10)` was UTC, so "today" was still yesterday east
// of UTC after local midnight, and `new Date('YYYY-MM-DD')` is UTC midnight, which west of
// UTC is the previous evening, so reminders fired a day early there.
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const pad = (n: number) => String(n).padStart(2, '0')

/** YYYY-MM-DD of the LOCAL calendar day for a Date, epoch ms or ISO string.
 *  A date-only string is already a calendar day and passes through unchanged. */
export function localDateKey(d: Date | string | number): string {
  if (typeof d === 'string' && DATE_ONLY.test(d)) return d
  const date = d instanceof Date ? d : new Date(d)
  if (isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Today's LOCAL calendar day; computed on every call, never cached across midnight. */
export function todayKey(now: Date = new Date()): string {
  return localDateKey(now)
}

/** A stored date: a date-only string is LOCAL midnight of that day (not UTC midnight);
 *  a full ISO timestamp is parsed as usual. Null when empty or unparseable. */
export function parseLocalDate(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const d = DATE_ONLY.test(iso)
    ? new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))
    : new Date(iso)
  return isNaN(d.getTime()) ? null : d
}
