# Store privacy labels (Apple App Privacy and Google Play Data safety)

Last verified: 2026-10-22 (audit brewmie-10). Derived from the code, not from memory. Each row
cites the file that proves it. The public policy is `public/privacy.html`; the three must say the
same thing. If a flow below changes in code, change this file, the policy and both consoles in the
same release.

Facts that drive every answer:

- Consent gate: `consentState()` in `src/lib/analytics.ts`. Google Analytics events and the
  anonymous community post run only when it is 'granted' (opt-in for everyone, brewmie-11).
- Google Analytics is the web `gtag.js` loaded from googletagmanager.com on first consented event
  (`src/lib/analytics.ts` `loadGtag`). `allow_google_signals: false`, `allow_ad_personalization_signals: false`,
  no user id, no display name, no location. No ATT plugin (removed; nothing called it).
- No advertising SDK, no data sold, no tracking across other companies' apps or sites.
- Every network URL in `src/` is https (supabase, api.met.no, workers.dev, cloudfunctions.net, googletagmanager.com), so
  encryption in transit = yes.
- Not collected anywhere in the code: contacts, photos, microphone, health, browsing history, precise location.

## 1. What leaves the device (the flow table)

| # | Flow | Fields | Goes to | Needs | Source |
|---|------|--------|---------|-------|--------|
| 1 | Account and sync | email and name from the sign-in provider, account id, display name, shots (all ShotEntry fields incl. taste), gear (machine, grinder, tamp, beans), units | Supabase (`profiles`, `shots`) | signed in | `src/lib/supabase.ts` upsertShot, bulkUpsertShots, upsertUserConfig, setDisplayName |
| 2 | Community dataset | machine brand, grinder type, tamp type and value, grind, dose, target and actual volume and time, score, taste flavour and strength, bean age bucket, roast level, temp, humidity. No user id, no device id. | Supabase `public_shots` | consent 'granted' and a taste rating | `upsertPublicShot` in `src/lib/supabase.ts`; gate in `src/hooks/useBrewmie.ts` |
| 3 | Analytics events | app_open, screen_view, shot_logged (shot number, score, roast level, bean age bucket), premium_* events (platform, trigger), sync_failed (op only), js_error (message up to 120 chars, bundle), every event also `bundle_version` | Google Analytics | consent 'granted' | `src/lib/analytics.ts`, `BrewScreen.tsx`, `PremiumModal`, `ErrorBoundary.tsx` |
| 4 | OTA update check | updater payload: random install id (`device_id`), app and bundle version, platform, OS version, plugin version, emulator and prod flags | Brewmie update worker on Cloudflare (`brewmie-ota.richbwilliamson.workers.dev`) | native app, automatic, no opt-out | `capacitor.config.ts` CapacitorUpdater; `ota/worker.js` reads only `version_name` and `version_build`, logs versions only; `statsUrl` is '' so no updater stats are sent |
| 5 | Sale flag check | nothing app-specific (IP only) | same worker, `GET /sale` | native or web, premium sheet open | `src/lib/sale.ts` |
| 6 | Purchase notification | productId, platform, price string | developer's Firebase function `brewmiePurchaseWebhook` (project lazy-sous, us-central1), emails the developer | a new purchase succeeds | `src/lib/iap.ts` notifyPurchase. No user id, email or receipt. |
| 7 | Weather | latitude and longitude rounded to 1 decimal (about 11 km) | MET Norway `api.met.no`; only temp and humidity come back and are stored on the shot | location permission granted | `src/lib/weather.ts`, `src/App.tsx` |
| 8 | Community reads | none (anonymous RPCs `global_shot_count`, `get_algo_params`) | Supabase | app open | `src/lib/supabase.ts` |
| 9 | Sign-in | provider identity token to Supabase | Apple, Google (native and web), GitHub (web only) | user taps a provider | `src/lib/supabase.ts`, `src/components/AuthModal.tsx` (`signInWithMeta` exists but no button calls it) |
| 10 | Purchases | handled by the store | App Store, Google Play via `capacitor-plugin-cdv-purchase` | native | `src/lib/iap.ts` |

Hosting: Cloudflare Pages serves brewmie.app. Fonts are self-hosted (`public/fonts`), no Google Fonts call.

## 2. Apple App Privacy (App Store Connect, App Privacy)

Tracking: answer **No** to "Do you or your third-party partners use data for tracking?" Google signals and ad
personalisation are off (`src/lib/analytics.ts`), there is no ad SDK and no ATT prompt. Do not add
`NSUserTrackingUsageDescription`.

Declare these data types. "Linked" means linked to the person's identity; all items collected only after sign-in
or consent are still declared because they can be collected.

| Apple data type | Collected | Linked to user | Tracking | Purposes | Why |
|---|---|---|---|---|---|
| Contact Info: Email Address | yes (signed in) | yes | no | App Functionality | flow 1, 9 |
| Contact Info: Name | yes (signed in, display name) | yes | no | App Functionality | flow 1 |
| Identifiers: User ID | yes (account id) | yes | no | App Functionality | flow 1 |
| Identifiers: Device ID | yes (random updater install id) | no | no | App Functionality | flow 4. The worker discards it, but Cloudflare receives it; declared to be safe. Owner may drop it if comfortable that nothing retains it. |
| User Content: Other User Content | yes (shots, gear, taste, beans) | yes (flow 1); the community copy is not linked (flow 2) | no | App Functionality, Product Personalization | flow 1, 2 |
| Usage Data: Product Interaction | yes (consent only) | no | no | Analytics | flow 3 |
| Diagnostics: Other Diagnostic Data | yes (consent only; js_error, sync_failed, bundle_version) | no | no | Analytics | flow 3 |
| Location: Coarse Location | yes (rounded to about 11 km, sent to MET Norway; not stored by us) | no | no | App Functionality | flow 7 |
| Purchases: Purchase History | yes (product, platform, price in the notice, no identity) | no | no | Analytics | flow 6 |

Do not declare: Financial Info (the store holds the card), Contacts, Photos, Health, Browsing History, Search History,
Precise Location, Sensitive Info, Advertising Data.

"Data not collected" is therefore NOT the right label; the label is "Data Linked to You" (email, name, user id, other
user content) plus "Data Not Linked to You" (device id, product interaction, diagnostics, coarse location, purchase history).

## 3. Google Play Data safety

Top-level questions:

- Does your app collect or share any of the required user data types? **Yes**.
- Is all of the user data collected by your app encrypted in transit? **Yes** (every URL is https).
- Do you provide a way for users to request that their data be deleted? **Yes**.
  - Account deletion URL: `https://brewmie.app/delete-account` (in-app: Setup, Privacy, Delete account).
  - Also say the data deleted: account, shots, gear, display name. Anonymous community rows are not deletable
    because they carry no identity (stated on the page).
- Data collected from third-party sign-in is covered by the rows below. Supabase, Cloudflare and the developer's
  own Firebase function act as service providers for the developer, which Play does not count as "sharing".

| Play category and type | Collected | Shared | Optional or required | Purposes | Why |
|---|---|---|---|---|---|
| Personal info: Email address | yes | no | optional (only if the person signs in) | App functionality, Account management | flow 1 |
| Personal info: Name | yes | no | optional | App functionality, Account management | flow 1 |
| Personal info: User IDs | yes | no | optional | App functionality, Account management | flow 1 |
| App activity: App interactions | yes | no | optional (consent) | Analytics | flow 3 |
| App activity: Other user-generated content | yes (shots, gear, taste) | no | optional (account sync and consent for the community copy) | App functionality | flow 1, 2 |
| App info and performance: Diagnostics (other) | yes | no | optional (consent) | Analytics | flow 3 |
| App info and performance: Crash logs | yes (js_error render errors only) | no | optional (consent) | Analytics | `ErrorBoundary.tsx` |
| Device or other IDs | yes (random updater id) | no | required (automatic update check) | App functionality | flow 4 |
| Financial info: Purchase history | yes (notice carries product, platform, price) | no | required (sent on every new purchase) | Analytics | flow 6 |
| Location: Approximate location | NOT YET. Android never asks today. Declare it in the release that adds the permission (BUILD_AUTOMATION.md, "Next native release checklist"). | yes, to MET Norway when declared (it is a lookup by a third party, so declare shared to be safe) | optional | App functionality | flow 7 |

Do not tick: Precise location, Contacts, Photos and videos, Audio, Health and fitness, Web browsing, SMS or call log,
Calendar, Files and docs, Messages. Do not tick "Data is processed ephemerally" for any row.

## 4. SDK questions

| SDK or service | Present | Answer and source |
|---|---|---|
| Google Analytics (gtag.js, not the Firebase SDK) | yes, web script inside the WebView | `src/lib/analytics.ts`; consent-gated; Google signals and ad personalisation off. Play asks you to list it under analytics purposes. |
| Google Sign-In | yes, `@codetrix-studio/capacitor-google-auth` (Android and iOS) | `package.json`, `capacitor.config.ts`; returns an id token that goes to Supabase |
| Sign in with Apple | yes, `@capacitor-community/apple-sign-in`, iOS native; Apple OAuth on the web | `src/lib/supabase.ts` signInWithApple; entitlement `com.apple.developer.applesignin` |
| Capgo updater | yes, `@capgo/capacitor-updater` 6.45.10, pointed at OUR worker, not Capgo's cloud | `capacitor.config.ts`; JS and asset bundles only, never native code (Play policy on code downloaded after install is met because the bundle is interpreted by the WebView) |
| Supabase | yes, `@supabase/supabase-js` | `src/lib/supabase.ts`; project ref `pdbfmmtwgsdkattjraya` |
| In-app purchases | yes, `capacitor-plugin-cdv-purchase` (StoreKit 2 and Play Billing) | `src/lib/iap.ts` |
| Advertising SDKs, Facebook SDK, crash reporters (Crashlytics, Sentry) | none | `package.json` |

Apple third-party SDK privacy manifests: check that the Capacitor core, GoogleSignIn and Firebase-free pods in the
archive carry `PrivacyInfo.xcprivacy` when you next archive (the upload email from App Store Connect lists any missing).

## 5. How to update the consoles (owner steps)

1. Read this file against `public/privacy.html`; both must still match the code. If you changed a flow, update both first.
2. App Store Connect: App, App Privacy, Edit. Set the data types in section 2, mark tracking No, set the privacy
   policy URL to `https://brewmie.app/privacy`, Publish. The label applies to the next version submission; it can be
   edited at any time.
3. Play Console: App content, Data safety, Manage. Fill section 3, set the deletion URL, confirm encryption in transit,
   Save, Submit. In the same section confirm the privacy policy URL (`https://brewmie.app/privacy`).
4. Play Console: App content, Account deletion (if shown), enter `https://brewmie.app/delete-account`.
5. After the Android location release ships, add Approximate location to Data safety (row above) in the same console visit.
6. Re-check both consoles at every native release and whenever `src/lib/analytics.ts`, `src/lib/supabase.ts` or
   `src/lib/iap.ts` change.

Items I could not ground in code: the Supabase data-centre region (not in the URL, `.env.local` or `supabase/`; read it
in the Supabase dashboard, Project Settings, and add it to the policy's "Where your data goes" paragraph), whether the
Google Analytics property is set to the 14-month retention (a GA console setting), and Cloudflare's own Workers log retention.
