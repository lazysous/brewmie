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
