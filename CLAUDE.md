# Brewmie

Last verified: 2026-06-05

Brewmie (brewmie.app) is an espresso shot dial-in coach for home baristas. The
codebase is a Vite + React + TypeScript web app wrapped in Capacitor for native
iOS and Android. Supabase is the backend (auth, data, 7-day Premium trial).
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
