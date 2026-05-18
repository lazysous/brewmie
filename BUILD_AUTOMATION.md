# Build automation, one-time setup

Once the credentials below exist, every future Brewmie release is one command.

```bash
scripts/release.sh ota 1.0.4           # JS bundle via Capgo
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

## 4. Capgo (OTA)

Brewmie pushes JS-only updates through Capgo, not the Lazy-Sous-style
Cloudflare Pages zip pipeline. The endpoint is configured in
`capacitor.config.ts` to point at the Brewmie Worker.

Setup is intentionally light:

1. Sign in at https://capgo.app with the same GitHub account.
2. Create an app with bundle id `app.brewmie.brewmie`.
3. Generate an API key and save it locally:

```bash
mkdir -p ~/.brewmie
cat > ~/.brewmie/capgo.env <<EOF
CAPGO_API_KEY=...
EOF
chmod 600 ~/.brewmie/capgo.env
```

4. Wire up `scripts/ota_push.sh` once the Capgo CLI is installed:

```bash
npm install --save-dev @capgo/cli
```

Day-to-day push (interim, until `ota_push.sh` is filled in):

```bash
npm run build
npx @capgo/cli bundle upload --channel production
```

Capgo delivers to clients in ~60s.

---

## 5. Day-to-day commands

| Command | What it does |
|---|---|
| `scripts/release.sh ota 1.0.4` | Build the web bundle, upload to Capgo, channel `production`. ~30s. (Stub today; finish wiring before first OTA.) |
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
+- capgo.env                # CAPGO_API_KEY (chmod 600)

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
