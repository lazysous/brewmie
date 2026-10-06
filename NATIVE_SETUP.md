# Native build requirements

Last verified: 2026-10-05

What the native iOS and Android shells need beyond the web bundle.
Everything below is in place as of the 1.1 release (2026-10-05); the notes
say why each piece exists so nobody removes it.

## UIScene lifecycle (iOS, mandatory)

Xcode 27 builds against the iOS 26 SDK, and Apple rejects apps that have not
adopted the UIScene lifecycle. Lazy Sous build 18 was rejected for exactly
this; the simulator does not reproduce it and the reason only shows in App
Store Connect, not in the rejection email. Brewmie adopted it on 2026-10-05:

- `ios/App/App/SceneDelegate.swift` forwards URL contexts and user
  activities to `ApplicationDelegateProxy.shared` so Capacitor deep links
  and plugin callbacks keep working.
- `AppDelegate.swift` returns a `UISceneConfiguration` named
  "Default Configuration" from `configurationForConnecting`.
- `Info.plist` carries `UIApplicationSceneManifest` pointing at
  `$(PRODUCT_MODULE_NAME).SceneDelegate` and the `Main` storyboard.
- `project.pbxproj` registers `SceneDelegate.swift` in the App target.

`npx cap sync ios` does not touch any of these. Do not remove them.

## Location (weather at shot time)

`src/App.tsx` asks for the device position on every launch to record
ambient temperature and humidity against each shot (the algorithm's weather
modifier and the public dataset's `temp` / `humidity` columns). Info.plist
has carried `NSLocationWhenInUseUsageDescription` since 1.1 (build 12).
Builds before it never showed the permission prompt, so every iOS shot from
1.0 has no weather (36% of the public dataset had none on 2026-10-05).

## Local notifications (iOS + Android)

Plugin: `@capacitor/local-notifications` (6.x, matching the Capacitor 6
core). Reminders are scheduled from `src/lib/notifications.ts` (rate-later,
maintenance, bean age), triggered on app open and whenever maintenance dates
or the bean roast date change. Info.plist has no `UIBackgroundModes` entry
and local notifications do not need one; the `remote-notification`
background mode is only required if push is ever added. The Android manifest
gets its permission from the plugin.

## Minimum OS versions (forced by the toolchains, 2026-10-06)

- **iOS 15.0.** Xcode 27 builds against the iOS 26 SDK and refuses any
  deployment target below 15.0. 1.0 was built at 13.0. The App target's
  `IPHONEOS_DEPLOYMENT_TARGET` is now 15.0, and `ios/App/Podfile` carries a
  `post_install` hook that raises every pod target to 15.0 as well: the
  Capacitor 6 podspecs each declare 13.0, and Capacitor's own
  `assertDeploymentTarget` only enforces a floor of 13.0, so neither the
  Podfile `platform` line nor the App target's value reaches them. Without
  the hook the archive fails with one error per pod. Drops iOS 13 and 14.
- **Android API 24 (7.0).** Play refuses an upload below 24 with "Play
  automatic protection requires a minimum SDK version of 24 or higher".
  `android/variables.gradle` now sets `minSdkVersion = 24`. 1.0 shipped 23,
  so devices on Android 6.0 keep the version they have and stop receiving
  updates.

## Plugin versions

Capacitor core, iOS and Android are 6.2.1. Every `@capacitor/*` plugin is on
the 6.x line (filesystem 6.0.4, local-notifications 6.1.3, share 6.0.4), as
is `@capgo/capacitor-updater` (it talks to our own OTA worker, not Capgo's
SaaS). Keep plugin majors equal to the core major; 1.0 shipped 8.x plugins
on the 6.2 core and only built because nothing in the mismatched surface was
called.

The ATT plugin (`@capgo/capacitor-app-tracking-transparency`) was removed on
2026-10-05: Brewmie has no tracking SDK, nothing called it, and Info.plist
never had `NSUserTrackingUsageDescription`. Re-adding tracking means adding
both the plugin and the plist key, or the app crashes on launch.

## Removed

- The 7-day Premium trial. Its SQL (`start_trial`, `effective_tier`,
  `profiles.trial_started_at`) was dropped from the database on 2026-10-05
  and `supabase/add_trial_started_at.sql` deleted. Premium is a one-time
  lifetime unlock through the stores; see CLAUDE.md "Backend facts" for the
  entitlement model.

## These files are NOT in git

`.gitignore` excludes `ios/` and `android/` wholesale, so everything on this
page lives only on this machine: the SceneDelegate, the Info.plist keys, the
Podfile hook, the deployment targets, the signing config and both version
numbers. `npx cap sync` does not recreate any of it. If the native projects
are ever regenerated from scratch, work through this page top to bottom
before archiving, and expect the 1.0 defaults (iOS 13.0, minSdk 23, no
UIScene, no location key) to come back.

## Deferred

- Move app to `/testing.html` + landing at `/`: needs Vite multi-entry +
  Capacitor entrypoint workaround. Current landing lives at `/landing.html`.
