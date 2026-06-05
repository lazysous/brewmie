# Build automation, one-time setup

Last verified: 2026-06-05

Once the credentials below exist, every future Brewmie release is one command.

```bash
scripts/release.sh ota 1.0.4           # JS bundle via our own OTA (Cloudflare Pages + Worker)
scripts/release.sh native              # iOS .ipa + Android .aab uploads
scripts/release.sh all 1.0.4           # All three
```

Brewmie shares an Apple Developer team with Lazy Sous, so the App Store
Connect API key is reused. Play uses a separate service account so the
Brewmie console has its own permissions surface.

---

## 0. Prerequisite, the app records must exist

Both stores need an app record before any of these scripts work.

- **App Store Connect**: create the app at https://appstoreconnect.apple.com,
  bundle id `app.brewmie.brewmie`, primary language English (Australia),
  category Food & Drink.
- **Play Console**: create the app at https://play.google.com/console,
  package name `app.brewmie.brewmie`, default language English (Australia),
  category Food & Drink.

Once the App Store Connect record is created, copy the numeric app id from
the URL (e.g. `https://appstoreconnect.apple.com/apps/6760213445/...`)
into the `APP_ID` placeholder in `store-pipeline/_auth.py`.

If you are running the Chrome megaprompt that automates these store
records, run it first. The scripts below will fail loudly until both
records exist.

---

## 1. App Store Connect API key (iOS)

The key already exists from Lazy Sous. The same `.p8` file works for
every app under the same Apple Developer team, so no new key is needed.

Confirm the key is in place:

```bash
ls -la ~/.appstoreconnect/private_keys/AuthKey_QFM9X8VAL4.p8
```

Then create the Brewmie env file:

```bash
mkdir -p ~/.brewmie
cat > ~/.brewmie/asc-api.env <<EOF
ASC_KEY_ID=QFM9X8VAL4
ASC_ISSUER_ID=65fe67a4-6e1b-4762-9fd8-996d00a62b89
EOF
chmod 600 ~/.brewmie/asc-api.env
```

No `sudo xcode-select` needed; `publish_ios.sh` sets `DEVELOPER_DIR`
per-process so it doesn't touch the system-wide developer tool path.

Sanity check:

```bash
xcrun altool --list-providers --apiKey QFM9X8VAL4 \
    --apiIssuer 65fe67a4-6e1b-4762-9fd8-996d00a62b89
```
Should list "Richard Williamson" or the team name.

---

## 2. Google Play Publishing API (Android), new service account

Brewmie gets its own Play service account so its console permissions
don't bleed into Lazy Sous.

1. Open https://console.cloud.google.com, create or pick a project
   (suggested: `brewmie-publish`).
2. **APIs & Services**, **Library**, enable **Google Play Android Developer API**.
3. **IAM & Admin**, **Service Accounts**, **Create Service Account**:
   - Name: `brewmie-play-publish`
   - Skip optional steps; click **Done**.
4. On the new service account, **Keys** tab, **Add Key**, **Create new key**,
   **JSON**. Downloads `brewmie-play-publish-*.json`.

Link it to Play Console:

5. Open https://play.google.com/console, **Setup**, **API access**.
6. Find the service account in the list (you may need to click
   **Manage Play Console permissions** next to it).
7. Grant the following permissions for the Brewmie app:
   - **Release**, Release apps to production, beta, alpha
   - **Release**, Release apps to internal testing
   - **Release**, Manage testing tracks and edit tester lists
   - **Store presence**, Edit store listing, pricing and distribution

Place the file + install deps:

```bash
mkdir -p ~/.brewmie
mv ~/Downloads/brewmie-play-publish-*.json ~/.brewmie/play-publish.json
chmod 600 ~/.brewmie/play-publish.json
pip3 install --user google-auth google-api-python-client
```

Sanity check:

```bash
scripts/publish_play.py --track internal --skip-build
```
Will fail (no AAB yet) but you should see "Creating edit transaction..."
which means the API auth works.

---

## 3. Xcode + signing

Brewmie uses Capacitor automatic signing through `-allowProvisioningUpdates`.
First-time setup:

- Open `ios/App/App.xcworkspace` in Xcode.
- Sign in to your Apple ID under **Settings**, **Accounts**.
- On the **App** target, **Signing & Capabilities**, tick **Automatically
  manage signing**, pick the team.
- Xcode will fetch the Distribution certificate on first archive. After
  that, `publish_ios.sh` runs unattended.

---

## 4. OTA (Cloudflare Worker + Pages)

Brewmie ships its own OTA pipeline — no Capgo account. `@capgo/capacitor-updater`
is the plugin, but it talks to our own Worker, not Capgo's SaaS.

Two moving pieces:

- **`ota/worker.js`** — Cloudflare Worker at
  `https://brewmie-ota.richbwilliamson.workers.dev`. Devices POST their
  version; the worker either returns `no_new_version_available` or a URL
  to a new bundle. Three constants control behaviour:
  `OTA_ENABLED` (kill switch), `LATEST_VERSION`, `LATEST_URL`.
- **`brewmie.app/ota/builds/<version>.zip`** — the actual bundle, served
  from the Cloudflare Pages project `brewmie`.

The bundled `autoUpdate` flag in `capacitor.config.ts` is what causes the
plugin to poll. iOS v1.0 (build 5 and earlier) ships with `autoUpdate=false`
and ignores the worker entirely; from v1.0.1 onward it's `true`. Android
v1.0 (versionCode 3) is built with `autoUpdate=true`.

Day-to-day push:

```bash
scripts/ota_push.sh 1.0.2     # builds, zips, deploys Pages + Worker, smoke tests
```

That script is the source of truth. Steps inside it:
1. `npm run build`
2. zip `dist/` -> `ota/builds/<v>.zip` (excludes nested `ota/`)
3. copy zip to `dist/ota/builds/<v>.zip` so Pages serves it
4. `wrangler pages deploy dist --project-name brewmie --branch main`
5. rewrite `OTA_ENABLED=true`, `LATEST_VERSION`, `LATEST_URL` in `ota/worker.js`
6. `wrangler deploy ota/worker.js --name brewmie-ota`
7. POST both `1.0` and `<v>` to the worker to verify behaviour

Worker dark mode: set `OTA_ENABLED=false` in `ota/worker.js` + redeploy if
you need to immediately kill all OTA distribution (e.g. a bad bundle slipped
through). All devices then get `no_new_version_available` regardless of
their reported version.

---

## 5. Day-to-day commands

| Command | What it does |
|---|---|
| `scripts/release.sh ota 1.0.4` | Runs `ota_push.sh`: build the web bundle, deploy to Cloudflare Pages + Worker (our own OTA, not Capgo). ~30s. |
| `scripts/publish_ios.sh` | Bump build number, cap:sync, archive, export `.ipa`, upload to App Store Connect. ~5 min. |
| `scripts/submit_ios_release.py --wait --submit` | Create the App Store version, set localized "What's New" copy from `store-pipeline/translations/*.json`, attach the uploaded build, submit for Apple review. `--wait` polls until processing finishes. |
| `scripts/publish_ios.sh --no-bump` | Same archive, current build number (retry after upload failure). |
| `scripts/publish_ios.sh --skip-upload` | Archive + export only, leaves `.ipa` under `build/ios/ipa/`. |
| `scripts/publish_play.py --track internal` | Bump versionCode, cap:sync, bundleRelease, upload AAB to Internal Testing. ~2 min. |
| `scripts/publish_play.py --track production --notes "..."` | Same, ships to Production with release notes. |
| `scripts/publish_play.py --no-bump --skip-build` | Re-upload existing AAB after a failed network upload. |
| `scripts/release.sh native` | iOS + Play in parallel. iOS foreground (Xcode signing), Play background to `/tmp/brewmie-play.log`. |
| `scripts/release.sh all 1.0.4` | OTA push, then native. |

After upload:
- iOS: appears in App Store Connect, TestFlight in ~10 min (Apple processing).
- Play: appears immediately in the chosen track. For Production, live within minutes (no review queue for updates unless permissions or target SDK change).

---

## 6. Store-pipeline (metadata + translations)

`store-pipeline/` is the metadata side of the release. Independent of
the binary upload above.

```bash
# 1. Generate per-locale JSONs (costs Anthropic API budget, do NOT run
#    without explicit consent on a cost estimate).
ANTHROPIC_API_KEY=sk-ant-... python3 store-pipeline/translate.py

# 2. Clean up auto-translated edge cases (em dashes, overlength fields).
python3 store-pipeline/fix_short_desc.py

# 3. Push English en-AU to Play, then push every Play translation.
python3 store-pipeline/02_push_play_english.py
python3 store-pipeline/08_push_play_translations.py

# 4. iOS metadata. Needs a version + appinfo id; get them by listing
#    /v1/apps/<APP_ID>/appStoreVersions and /v1/apps/<APP_ID>/appInfos
#    after running 03_create_ios_version.py.
python3 store-pipeline/03_create_ios_version.py --version 1.0.0
python3 store-pipeline/05_push_ios_english.py <VERSION_ID> <APPINFO_ID>
python3 store-pipeline/07_push_ios_translations.py <VERSION_ID> <APPINFO_ID>

# 5. Store assets (icons, feature graphics, IAP promo). Fill the
#    IMAGE_PATH constants at the top of each file first.
python3 store-pipeline/10_push_play_feature_graphic.py
python3 store-pipeline/11_push_play_icon.py
python3 store-pipeline/09_push_iap_image.py
```

`translate.py` is the only step that spends API budget. The push scripts
are free (Google + Apple admin APIs).

---

## 7. Files / secrets layout

```
~/.brewmie/
+- play-publish.json        # Google service account key (chmod 600)
+- asc-api.env              # ASC_KEY_ID + ASC_ISSUER_ID (chmod 600)

~/.appstoreconnect/
+- private_keys/
   +- AuthKey_QFM9X8VAL4.p8 # Apple API key (chmod 600), shared with Lazy Sous
```

None of these are in the repo. The scripts fail loudly with the missing-
file path if any are absent.

---

## 8. Troubleshooting

- **iOS "no signing certificate"**: Xcode, Settings, Accounts, sign in,
  Manage Certificates, ensure an Apple Distribution cert exists.
  Capacitor uses automatic signing so a one-time login fixes it.
- **Play "Version code XX has already been used"**: `--no-bump` was
  passed but the previous versionCode is already on Play. Drop
  `--no-bump`.
- **Play "different certificate than previous uploads"**: signing key
  mismatch. Verify `android/keystore.properties` points at the right
  upload keystore.
- **`xcrun altool` "Unable to find utility altool"**: `xcode-select -p`
  shows CommandLineTools instead of the full Xcode. Run
  `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer` once.
- **`submit_ios_release.py` fails with "APP_ID not set"**: edit
  `store-pipeline/_auth.py` and replace the `<FILL_AFTER_ASC_APP_CREATED>`
  placeholder with the numeric app id from App Store Connect.

---

## Native sign-in (Apple + Google) — external setup checklist

The Brewmie codebase has the native plumbing for "Sign in with Apple" (iOS)
and "Sign in with Google" (Android + iOS) wired but the provider configs
must be created externally before the buttons can complete a round-trip.

If the native plugin call fails for any reason (capability missing, plugin
not configured, user cancels), `handleSignInClick` falls back to opening
the AuthModal which then attempts Supabase's hosted OAuth web flow. That
fallback also needs the providers configured in the Supabase dashboard.

### 1. Apple — Sign in with Apple (iOS only; Apple policy 4.8 requires it)

1. Apple Developer Portal → Identifiers → Brewmie's bundle ID
   `app.brewmie.brewmie`. Enable the **Sign in with Apple** capability.
2. Identifiers → Services IDs → `+` → register a Services ID, e.g.
   `app.brewmie.brewmie.web`. Configure: enable Sign in with Apple, add
   `https://pdbfmmtwgsdkattjraya.supabase.co/auth/v1/callback` as the
   Return URL. Note the Services ID — Supabase calls it `client_id`.
3. Keys → `+` → create a key with Sign in with Apple enabled. Download the
   `.p8` file (one-time). Note the Key ID + your Team ID.
4. Supabase dashboard → Authentication → Providers → Apple. Toggle on.
   Fill: Services ID, Team ID, Key ID, paste the `.p8` contents.

The iOS app already has `App.entitlements` with `com.apple.developer.applesignin`
and pbxproj wired to `CODE_SIGN_ENTITLEMENTS = App/App.entitlements`. The
native plugin call will return an identity token; Supabase verifies it
against the Service ID config.

### 2. Google — Google Sign-In (Android + iOS)

1. Firebase console → Create project "brewmie" (or use existing). Add an
   Android app with package `app.brewmie.brewmie` and an iOS app with
   bundle ID `app.brewmie.brewmie`. Download:
   - **google-services.json** → place at `android/app/google-services.json`
   - **GoogleService-Info.plist** → place at `ios/App/App/GoogleService-Info.plist`
2. Firebase console → Project Settings → Your apps → note the three
   OAuth client IDs (Web, Android, iOS). The Web Client ID is the
   `serverClientId` used by Supabase to verify Google tokens.
3. Edit `capacitor.config.ts` — replace the three `REPLACE-WITH-BREWMIE-...`
   placeholders in the `GoogleAuth` plugin block.
4. Edit `ios/App/App/Info.plist` — replace the
   `com.googleusercontent.apps.REPLACE-WITH-BREWMIE-IOS-CLIENT-ID`
   placeholder with the iOS reversed-client-id from Firebase.
5. Supabase dashboard → Authentication → Providers → Google. Toggle on.
   Fill the Web Client ID + Client Secret (from Google Cloud Console →
   APIs & Services → Credentials).

### 3. Verifying

After the above is in place:

```bash
# Rebuild + reinstall the app
cd ~/brewmie && npm run build
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer npx cap sync
# iOS
scripts/publish_ios.sh --skip-upload
# Android
cd android && ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Then tap the profile icon top-right of the Hero header. The AuthModal
slides up. Tap "Continue with Apple" on iOS or "Continue with Google" on
Android. The native sheet should appear, authenticate, and return to the
app with a live Supabase session.

### Until all of this is done

The buttons still appear (HIG-compliant styling) and tapping them opens
the in-app browser to Supabase's OAuth page. The flow then bounces through
Apple/Google and ends at Supabase's callback URL — but without the
provider config in Supabase, the callback returns an "OAuth provider not
configured" error. The user sees that error in the modal, not a silent
no-op.
