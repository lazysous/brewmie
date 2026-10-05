# Brewmie

Last verified: 2026-10-05

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

## Native facts

- iOS 1.0 build 11 is READY_FOR_SALE; Android 1.0 versionCode 6 is in
  production. Both embed an old bundle and pick up OTA on launch.
- Info.plist has no `NSLocationWhenInUseUsageDescription`, so weather is
  never recorded on iOS (see NATIVE_SETUP.md). Needs a native release.
- `@capacitor/filesystem`, `local-notifications`, `share` and the Capgo ATT
  plugin are 8.x against Capacitor 6.2 core (`npm install` needs
  `--legacy-peer-deps`). It builds and ships today; treat it as fragile and
  align versions at the next native release.

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
