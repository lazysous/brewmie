# Native build requirements

Last verified: 2026-10-05

JS wiring is in place for the items below, but the native iOS/Android build
needs one-time config when the dev environment has CocoaPods + Xcode set up.

## App Tracking Transparency (iOS)

Plugin: `@capgo/capacitor-app-tracking-transparency` (installed).

Required Info.plist key in `ios/App/App/Info.plist`:

```xml
<key>NSUserTrackingUsageDescription</key>
<string>Brewmie uses anonymous usage data to improve dialling-in recommendations for all users. No personal data is ever included.</string>
```

The plugin call site is `requestAppTrackingPermission()` in `src/lib/native.ts`.
It is NOT called anywhere (checked 2026-10-05): `src/App.tsx` deliberately skips
ATT because Brewmie has no tracking SDK, and the Info.plist has no
NSUserTrackingUsageDescription. Calling it without the key crashes on launch.
Leave both as they are unless a tracking SDK is added.

## Local notifications (iOS + Android)

Plugin: `@capacitor/local-notifications` (installed).

Required Info.plist key:

```xml
<key>UIBackgroundModes</key>
<array>
  <string>remote-notification</string>
</array>
```

Android manifest already declares the permission via the plugin.

Reminders are scheduled from `src/lib/notifications.ts` (there is no
`reminders.ts`), triggered on app open and whenever maintenance dates or bean
roast date change. The Info.plist currently has NO UIBackgroundModes entry and
local notifications do not need one; the block above is only required if push
is ever added.

## Location (weather at shot time)

`src/App.tsx` asks for the device position on every launch to record ambient
temperature and humidity against each shot (the algorithm's weather modifier
and the public dataset's `temp` / `humidity` columns). The iOS Info.plist has
NO `NSLocationWhenInUseUsageDescription`, so on iOS the request fails silently
and every iOS shot is recorded with no weather (36% of the public dataset had
none on 2026-10-05). Add before the next native build:

```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>Brewmie uses your rough location once per session to record the weather alongside each shot, because humidity and temperature change how espresso extracts.</string>
```

## 7-day Premium trial

Server-side. Run the migration once:

```bash
psql $DATABASE_URL -f supabase/add_trial_started_at.sql
```

Or paste the SQL into the Supabase dashboard SQL editor.

The migration has been applied (the `start_trial` function and
`effective_tier` view exist in production) but the CLIENT NEVER CALLS EITHER:
as of 2026-10-05 nothing in `src/` references `start_trial`, `effective_tier`
or a trial. No user has ever had a trial. Either wire it (call `start_trial`
on first sign-in and treat `now < trial_started_at + 7 days` as Premium in
`useTier`) or drop the SQL; see the review notes in CLAUDE.md.

## Deferred

- Move app to `/testing.html` + landing at `/` — needs Vite multi-entry +
  Capacitor entrypoint workaround. Done in isolation when the native bundle
  can be re-synced and tested. Current landing lives at `/landing.html`.
