# Brewmie

Last verified: 2026-10-05

Brewmie (brewmie.app) is an espresso shot dial-in coach for home baristas. The
codebase is a Vite + React + TypeScript web app wrapped in Capacitor for native
iOS and Android. Supabase is the backend (auth, data). A 7-day trial exists only as unused SQL.
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

## Backend facts (verified live 2026-10-05)

- Supabase project `pdbfmmtwgsdkattjraya`. The anon key is in `.env.local`
  (never committed). There is no service-role key or Supabase CLI login on this
  machine: schema changes go through the SQL editor in the dashboard.
- `shots` was created with `grind` / `dose` / `tamp` columns and never gained
  the camelCase ShotEntry columns the client writes. Every `upsertShot` and
  `bulkUpsertShots` since the ShotEntry reshape failed with PGRST204 before
  RLS was consulted, silently (supabase-js returns `{ error }`, it does not
  throw, and the old `.catch()` wrappers never saw it). Personal shot history
  lives only on the device until `supabase/2026-10-05_review_hardening.sql`
  is applied; the client now backfills once per account after that.
- `effective_tier` (the unused trial view) was readable by the anon key and
  listed every user's id, tier and trial dates. Same SQL file fixes it.
- `public_shots` accepts anonymous inserts by design (the community dataset
  behind `get_algo_params`). Until OTA 1.0.10 the client re-posted the newest
  shot on every launch and every delete: 393 rows held 123 distinct shots.
  Duplicates skew the algorithm parameters until the table is deduplicated.
- The 7-day trial exists only as SQL (`start_trial`, `effective_tier`).
  Nothing in the client calls it. Nobody has had a trial.
- Entitlement model: Premium is decided on the device by the store plugin
  (StoreKit 2 / Play Billing, no server-side receipt validation, no
  `store.validator`) and mirrored to `profiles.tier` BY THE CLIENT. Any
  signed-in user can set their own `tier` with their session token. Closing
  that needs either column-level revocation of `tier` (Restore Purchases then
  carries ownership between devices) or an Edge Function that validates
  receipts and writes `tier` with the service role. Owner decision, not made.
- `DevTierPill` / `useTier` honour a `brewmie_tier_override` when
  `brewmie_devtest=1` is in localStorage, in production too. Not reachable
  without devtools on native; still a backdoor the TODO said to remove.

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
