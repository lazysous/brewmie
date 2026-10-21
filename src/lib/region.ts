// Shared by the consent banner and the consent gate in analytics.ts.
export function isEURegion(): boolean {
  if (typeof Intl === 'undefined') return false
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''
    // EU member states + UK + Norway/Switzerland/Iceland (EEA) + Ceuta
    return tz.startsWith('Europe/') || tz === 'Africa/Ceuta' || tz === 'Atlantic/Canary' || tz === 'Atlantic/Madeira' || tz === 'Atlantic/Azores'
  } catch {
    return false
  }
}
