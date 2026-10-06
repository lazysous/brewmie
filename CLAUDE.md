# Brewmie

Last verified: 2026-10-07

Brewmie (brewmie.app) is an espresso shot dial-in coach for home baristas. The
codebase is a Vite + React + TypeScript web app wrapped in Capacitor for native
iOS and Android. Supabase is the backend (auth, data). Premium is a one-time
lifetime unlock bought through the stores; there is no trial.
Lazy Sous is the sister brand from the same studio.

## Build / serve / deploy (verified)

- Build: `npm run build` (`tsc && vite build`, output to `dist/`).
- Dev: `npm run dev` (Vite). Live site renders at brewmie.app and redirects to
  `/landing`.
- Hosting: Cloudflare Pages project `brewmie` (domains `brewmie.app`,
  `brewmie.pages.dev`).
- Deploys are MANUAL via wrangler. There is NO git auto-deploy: the Pages
  project has no Git provider connected, so pushing a commit does NOTHING until
  wrangler runs explicitly. The deploy happens inside `scripts/ota_push.sh`
  (`wrangler pages deploy dist --project-name brewmie ...`), driven by
  `scripts/release.sh ota <version>`.
- OTA is our OWN pipeline (Cloudflare Pages + the `brewmie-ota` Worker), not
  Capgo's SaaS. The `@capgo/capacitor-updater` plugin ships in the app but talks
  to our worker. `scripts/ota_push.sh` is the source of truth for OTA.
- Native release: `scripts/release.sh native` (iOS .ipa to App Store Connect,
  Android .aab to Play). See BUILD_AUTOMATION.md for the full flow and secrets.

## Scrape

No scraper exists in this repo as of the verified date: no script, no scheduled
job (launchd/cron), no code reference, empty `~/Library/Logs/brewmie-scrape`. If
a scraper is added, document it here and in the relevant doc. Do not assume one
runs.

## Purchase notifications

On a successful purchase, the app sends a fire-and-forget email notification.
Brewmie uses `capacitor-plugin-cdv-purchase` (no RevenueCat), so `src/lib/iap.ts`
(`notifyPurchase`, called from `purchasePremium` only on a new order success, not
on restore/launch) POSTs to a Firebase function `brewmiePurchaseWebhook` at
`https://us-central1-lazy-sous.cloudfunctions.net/brewmiePurchaseWebhook`. That
function lives in the **lazy-sous** Firebase project (Brewmie has no Firebase of
its own) and emails chef.lazysous@gmail.com, the same inbox as Lazy Sous. A shared
token (`PURCHASE_NOTIFY_TOKEN`) gates it against spam. The client side ships to
users only on the next OTA.

## Tests

`npm test` (vitest, offline, seconds) and `npm run typecheck` must be green
before any OTA. Suites live in `tests/`; see BUILD_AUTOMATION.md section 4b for
how the private algorithm functions are reached.

## Backend facts (verified live 2026-10-05, after the hardening SQL ran)

- Supabase project `pdbfmmtwgsdkattjraya`. The anon key is in `.env.local`
  (never committed). There is no service-role key or Supabase CLI login on this
  machine: schema changes go through the SQL editor in the dashboard, and the
  scripts that were applied live in `supabase/`
  (`2026-10-05_review_hardening.sql` is the latest, applied 2026-10-05).
- `shots` was created with `grind` / `dose` / `tamp` columns and only gained
  the camelCase ShotEntry columns the client writes on 2026-10-05. Before that
  every `upsertShot` and `bulkUpsertShots` failed with PGRST204 before RLS was
  consulted, silently (supabase-js returns `{ error }`, it does not throw).
  Since OTA 1.0.10 the client checks the error and backfills the device's
  history once per account (`brewmie_backfill_v1:<uid>` flag, set only on
  success), so personal history reaches the server on the first launch after
  the columns exist.
- The anon role has no access to `profiles` or `shots` (revoked 2026-10-05);
  the app never reads either before sign-in. `public_shots` still accepts
  anonymous inserts by design (the community dataset behind
  `get_algo_params`), bounded by the `public_shots_sane_ranges` CHECK.
- Until OTA 1.0.10 the client re-posted the newest public shot on every
  launch and every delete: 393 rows held 123 distinct shots. The duplicates
  skew `get_algo_params` until the optional dedupe block (section 7 of the
  hardening SQL) is run. Owner decision.
- The 7-day trial is gone: `start_trial`, `effective_tier` and
  `profiles.trial_started_at` were dropped on 2026-10-05. Nobody ever had one.
- Entitlement model: Premium is decided on the device by the store plugin
  (StoreKit 2 / Play Billing, no server-side receipt validation) and
  `profiles.tier` is READ-ONLY for clients since 2026-10-05. The
  authenticated role may insert and update every profile column except
  `tier` (column-level grants), so a profile upsert that includes `tier`
  fails as a whole; keep `tier` out of every profile payload. Restore
  Purchases carries ownership between devices, and the four profiles that
  already held `tier = 'premium'` keep it. The client stopped writing `tier`
  in the 1.1 release.
- `useTier` honours `localStorage.brewmie_tier_override` in dev builds only
  (`import.meta.env.DEV`). The production opt-in (`brewmie_devtest`) and the
  `DevTierPill` were removed on 2026-10-05.

## Native facts (verified 2026-10-06)

- **Android 1.1 (versionCode 7) is live on Play production** (2026-10-06).
  **iOS 1.1 (build 12) is WAITING_FOR_REVIEW** (submitted 2026-10-06); iOS
  1.0 build 11 stays READY_FOR_SALE until Apple approves. The App Review
  notes on the 1.1 version describe every change, including the location
  prompt. Binaries pick up OTA on launch.
- OTA must never go backwards from the shipping native version.
  `ota_push.sh` enforces it by reading `MARKETING_VERSION`, so every OTA from
  here is >= 1.1. Current bundle: 1.1.2.
- Minimum OS versions moved with this release: iOS 15.0 (Xcode 27 refuses
  below 15) and Android API 24 (Play refuses below 24). Details and the
  Podfile hook that makes the pods comply are in NATIVE_SETUP.md.
- iOS adopted the UIScene lifecycle (SceneDelegate.swift +
  `UIApplicationSceneManifest`). Mandatory under the iOS 26 SDK; Lazy Sous
  build 18 was rejected for its absence and the simulator does not reproduce
  it. Do not remove.
- Info.plist now has `NSLocationWhenInUseUsageDescription`, so iOS records
  weather against a shot from 1.1 onward. Every iOS shot logged on 1.0 has
  none.
- The permission string promises "rough location", so `src/lib/weather.ts`
  rounds the coordinates to one decimal place (about 11 km) before they go to
  Open-Meteo; a fence test keeps App.tsx from building that URL itself. The
  privacy policy (`public/privacy.html`, live at brewmie.app/privacy)
  discloses it under "Location and weather" and names every processor.
  Keep the three in step: plist string, rounding, policy.
- Every Capacitor plugin is on the 6.x line, matching the 6.2.1 core. The ATT
  plugin was removed (nothing called it). `npm install` still needs
  `--legacy-peer-deps`, now for one reason only:
  `@codetrix-studio/capacitor-google-auth@3.3.6` declares a peer of
  `@capacitor/core@^5`.
- `ios/` and `android/` are gitignored, so none of the native config above is
  in version control. NATIVE_SETUP.md is the only record of it.
- The release python scripts need pyjwt (iOS) and google-api-python-client
  (Play), which the system python3 lacks. Both scripts re-exec themselves in
  the Lazy Sous venv, or in `$BREWMIE_PYTHON` if set.

## Load-bearing gotchas

- Deploys are MANUAL wrangler only. No auto-deploy. A git push alone ships
  nothing.
- Never take the site offline. brewmie.app availability is a hard rule.
- No em dashes in user-facing prose. Rewrite or use periods. See BRAND_VOICE.md.

## Documentation maintenance (keep docs current)

These docs are the source of truth a fresh session loads via `/brewmie`, and they
MUST stay in sync with reality. When you change something, update the matching
doc in the SAME change. Never let code and docs drift.

- Build / deploy / OTA changes -> update `BUILD_AUTOMATION.md`.
- Native or app setup changes -> update `NATIVE_SETUP.md`.
- Brand / voice changes -> update `BRAND_VOICE.md`.

If you are unsure which doc a change belongs to, say so rather than guessing. No
em dashes in any of it.
