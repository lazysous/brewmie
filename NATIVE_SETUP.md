# Native build requirements

JS wiring is in place for the items below, but the native iOS/Android build
needs one-time config when the dev environment has CocoaPods + Xcode set up.

## App Tracking Transparency (iOS)

Plugin: `@capgo/capacitor-app-tracking-transparency` (installed).

Required Info.plist key in `ios/App/App/Info.plist`:

```xml
<key>NSUserTrackingUsageDescription</key>
<string>Brewmie uses anonymous usage data to improve dialling-in recommendations for all users. No personal data is ever included.</string>
```

The plugin call site is `requestAppTrackingPermission()` in `src/lib/native.ts`,
invoked once on app launch from `src/App.tsx`. Without the Info.plist key the
prompt won't appear (system silently denies).

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

Reminders are scheduled from `src/lib/reminders.ts`, triggered on app open and
whenever maintenance dates or bean roast date change.

## 7-day Premium trial

Server-side. Run the migration once:

```bash
psql $DATABASE_URL -f supabase/add_trial_started_at.sql
```

Or paste the SQL into the Supabase dashboard SQL editor.

After the migration runs, every user gets premium for 7 days starting from
their first authenticated read. The client polls `effective_tier` view and
treats `effective_tier='premium'` as full Premium for the duration.

## Deferred

- Move app to `/testing.html` + landing at `/` — needs Vite multi-entry +
  Capacitor entrypoint workaround. Done in isolation when the native bundle
  can be re-synced and tested. Current landing lives at `/landing.html`.
