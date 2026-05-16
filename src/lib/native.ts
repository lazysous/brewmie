// Thin wrappers around Capacitor plugins. All functions are safe to call on
// web — they no-op or fall through when running outside a native shell.
// Plugins resolve lazily so the web bundle doesn't pay for native code.

import { Capacitor } from '@capacitor/core'

const isNative = Capacitor.isNativePlatform()

/**
 * Trigger the OS in-app review sheet. Apple's SKStoreReviewController and
 * Play's In-App Review Library both decide whether to actually show the
 * sheet — calling this doesn't guarantee a prompt, just opts the user in
 * if the OS thinks it's a good moment.
 *
 * Apple's hard cap: 3 prompts per app per 365 days.
 */
export async function maybeRequestReview(): Promise<void> {
  if (!isNative) return
  try {
    const { InAppReview } = await import('@capacitor-community/in-app-review')
    await InAppReview.requestReview()
  } catch {
    /* plugin unavailable, ignore */
  }
}

/**
 * Subtle haptic for the BREW button press. Single light impact on iOS,
 * default vibration on Android. Silent on web.
 */
export async function brewTap(): Promise<void> {
  if (!isNative) return
  try {
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics')
    await Haptics.impact({ style: ImpactStyle.Light })
  } catch {
    /* plugin unavailable, ignore */
  }
}

/**
 * Stronger haptic for shot save (the satisfying "done" feel).
 */
export async function shotSavedHaptic(): Promise<void> {
  if (!isNative) return
  try {
    const { Haptics, NotificationType } = await import('@capacitor/haptics')
    await Haptics.notification({ type: NotificationType.Success })
  } catch {}
}

/**
 * Tell the Capacitor Updater that the app loaded successfully. If we don't
 * call this within ~10s of app launch on a freshly-installed OTA bundle, the
 * plugin auto-rolls back to the previous good bundle. Safety net against
 * shipping broken JS.
 */
export async function notifyAppReady(): Promise<void> {
  if (!isNative) return
  try {
    const { CapacitorUpdater } = await import('@capgo/capacitor-updater')
    await CapacitorUpdater.notifyAppReady()
  } catch {}
}

/**
 * iOS App Tracking Transparency. Required by Apple before any IDFA-style
 * tracking. Brewmie doesn't track across apps, but Apple still requires the
 * prompt for any analytics SDK. Call once shortly after first launch.
 *
 * Info.plist must include NSUserTrackingUsageDescription on iOS, otherwise the
 * prompt won't appear. The plist string is set in capacitor.config.ts/ios.
 */
export async function requestAppTrackingPermission(): Promise<'authorized' | 'denied' | 'notDetermined' | 'restricted' | 'unavailable'> {
  if (!isNative || Capacitor.getPlatform() !== 'ios') return 'unavailable'
  try {
    const mod = await import('@capgo/capacitor-app-tracking-transparency')
    const AppTrackingTransparency = (mod as { AppTrackingTransparency: { requestPermission: () => Promise<{ status: string }> } }).AppTrackingTransparency
    const res = await AppTrackingTransparency.requestPermission()
    return res.status as 'authorized' | 'denied' | 'notDetermined' | 'restricted'
  } catch {
    return 'unavailable'
  }
}

/**
 * Schedule a local notification. Works on iOS + Android via Capacitor.
 * No APNs needed — local notifications don't require a push server.
 */
export async function scheduleLocalNotification(opts: {
  id: number
  title: string
  body: string
  at: Date
}): Promise<boolean> {
  if (!isNative) return false
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    const perm = await LocalNotifications.requestPermissions()
    if (perm.display !== 'granted') return false
    await LocalNotifications.schedule({
      notifications: [{
        id: opts.id,
        title: opts.title,
        body: opts.body,
        schedule: { at: opts.at },
      }],
    })
    return true
  } catch {
    return false
  }
}

export async function cancelLocalNotification(id: number): Promise<void> {
  if (!isNative) return
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    await LocalNotifications.cancel({ notifications: [{ id }] })
  } catch {}
}
