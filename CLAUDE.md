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

**Secret guard (audit 2026-10, this repo is PUBLIC).** `scripts/git-hooks/pre-commit`
refuses a commit that stages a secret-shaped literal (Groq, Google, GitHub, Stripe,
Slack, AWS keys, private keys, bearer tokens, Instagram session dumps) or a secret or
signing file by name (.env, keystores, service-account JSON, provisioning profiles).
Install it once per clone with `scripts/install_hooks.sh` (sets `core.hooksPath`) and
prove it with `npm run test:secret-guard`. A PUBLIC literal that trips the content rule
goes on its own line in `scripts/git-hooks/secret-allowlist` (the Supabase anon key is a
JWT and does not trip it); anything else moves out of the repo. `.gitignore` carries the
matching filename patterns.

## Backend facts (verified live 2026-10-05, after the hardening SQL ran)

- Disaster recovery: the native shells and `~/.brewmie` are in an encrypted archive (local + iCloud Drive) since 2026-10-20; BUILD_AUTOMATION.md section 7b has the restore steps. The Supabase schema is not in it (needs DB access this Mac does not have).
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

- **The gear profile is never overwritten by an empty device** (OTA 1.1.7, audit brewmie-07): the config upsert waits until this session has hydrated that account's profile (`src/lib/hydration.ts`, marked by App after the sign-in fetch), and null server columns are skipped when merging (`mergeServerConfig`), so neither a fresh install nor a sparse profile row erases saved gear.
- **Shots sync by union, deletes leave tombstones** (OTA 1.1.6, audit brewmie-01/-02/-33/-61): a hydrate from the server (`HYDRATE_SHOTS`) unions with the local list (server copy wins for shared ids, local-only shots are kept and uploaded with `bulkUpsertShots`), `DELETE_SHOT` records the id in `state.deletedShotIds` (bounded, `src/lib/shots.ts`) so the next hydrate never resurrects it, and every tombstone is sent once per session with `deleteShot()` while signed in (a silent no-op server side until the DELETE policy exists on `shots`: owner SQL, brewmie-02). `fetchShots` pages through PostgREST's row cap. 'Clear all shot history' clears every shot, not the free-tier 30-day view. Gear-profile overwrite on account switch (brewmie-07) is still open.
- **Typed values commit on blur or Enter, days are local days** (OTA 1.1.5, audit brewmie-05/-30/-44): the main-screen dose, volume, time, grind and tamp fields keep the typed text in `editing` state and clamp/snap when the field is left (the stepper path is unchanged); the shot temperature field keeps its text and converts F to C on blur; `src/lib/dates.ts` (`localDateKey`, `todayKey`, `parseLocalDate`) replaces every `toISOString().slice(0, 10)` and every `new Date('YYYY-MM-DD')`, so the date picker's max, Insights day groups and maintenance reminders use the device's calendar day. Weather still displays in Celsius (open item in brewmie-44).
- **A render error shows a recover screen, never a blank app** (`src/components/ErrorBoundary.tsx` wraps `<App>` in `main.tsx` since OTA 1.1.3): reload, export the local data, clear it, and on a device go back to the store bundle (`resetToStoreBundle()`). The error is reported as a `js_error` analytics event (opt-out respected). `loadState()` treats a non-object or a non-array `shots` as corrupt instead of rendering it. Every analytics event carries `bundle_version` (from the updater via `getBundleVersion()`; `web` off-device, `builtin` on an untouched store binary), and swallowed Supabase sync failures emit `sync_failed` with an `op` only. The OTA worker logs `update_offered` lines and accepts updater stats on `/stats` (the native `statsUrl` still has to point there at the next native release).
- **The OTA worker deploys only via `wrangler deploy -c ota/wrangler.toml`** (all three scripts do). The config carries the daily cron that keeps the free-tier Supabase project awake (one anonymous public_shots read; `GET /keepalive` runs it on demand) and the `SUPABASE_URL` var; the anon key is the Worker secret `SUPABASE_ANON_KEY`. A bare `wrangler deploy ota/worker.js` would silently drop the cron.
- **Always ship through `scripts/ota_push.sh`, never a bare `wrangler pages deploy`.** A Pages deploy replaces the whole site, so a bare deploy deletes the live OTA zip while `ota/worker.js` still advertises it and every device gets a download error. Since 2026-10-20 the script keeps the currently advertised zip in `dist/ota/builds`, refuses a dirty or unpushed tree, a reused or backwards version, a missing or placeholder `.env.local`, a bundle without the real Supabase URL, runs `npm test` and `tsc` (SKIP_TESTS=1 shouts and is recorded in the tag), proves the uploaded zip is live as application/zip at the exact size (`scripts/ota_smoke.sh`, tested by `npm run test:ota-smoke`), and commits + tags `ota-v<version>`.

- Deploys are MANUAL wrangler only. No auto-deploy. A git push alone ships
  nothing.
- Never take the site offline. brewmie.app availability is a hard rule.
- No em dashes in user-facing prose. Rewrite or use periods. See BRAND_VOICE.md.
- **Sales are store-side, the badge is a worker flag.** The Premium sheet shows
  the live store price; the gold "Sale price" badge is switched by
  `scripts/sale_flag.sh on <until-utc>|off`, which rewrites `SALE_ACTIVE` and
  `SALE_UNTIL` in `ota/worker.js` and redeploys the worker (`GET /sale`). Lower
  the store prices before switching it on, switch it off before they go back
  up. See BUILD_AUTOMATION.md section 4c.

## Documentation maintenance (keep docs current)

These docs are the source of truth a fresh session loads via `/brewmie`, and they
MUST stay in sync with reality. When you change something, update the matching
doc in the SAME change. Never let code and docs drift.

- Build / deploy / OTA changes -> update `BUILD_AUTOMATION.md`.
- Native or app setup changes -> update `NATIVE_SETUP.md`.
- Brand / voice changes -> update `BRAND_VOICE.md`.

If you are unsure which doc a change belongs to, say so rather than guessing. No
em dashes in any of it.
