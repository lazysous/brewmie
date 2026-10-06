#!/usr/bin/env bash
# Archive Brewmie iOS app and upload to App Store Connect via API.
#
# Usage:
#   scripts/publish_ios.sh                   # bumps build number, archives, uploads
#   scripts/publish_ios.sh --no-bump         # uses current build number
#   scripts/publish_ios.sh --skip-upload     # archive + export only, no upload
#
# One-time setup (see BUILD_AUTOMATION.md):
#   ASC API key at ~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8 (chmod 600)
#   ~/.brewmie/asc-api.env with:
#     ASC_KEY_ID=QFM9X8VAL4
#     ASC_ISSUER_ID=65fe67a4-6e1b-4762-9fd8-996d00a62b89

set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
IOS_DIR="$REPO/ios/App"
PROJECT="$IOS_DIR/App.xcodeproj"
SCHEME="App"
BUILD_DIR="$REPO/build/ios"
ARCHIVE="$BUILD_DIR/App.xcarchive"
IPA_DIR="$BUILD_DIR/ipa"
EXPORT_OPTS="$BUILD_DIR/exportOptions.plist"
ENV_FILE="$HOME/.brewmie/asc-api.env"

BUMP=1
SKIP_UPLOAD=0
for arg in "$@"; do
    case "$arg" in
        --no-bump) BUMP=0 ;;
        --skip-upload) SKIP_UPLOAD=1 ;;
        *) echo "unknown arg: $arg" >&2; exit 2 ;;
    esac
done

die() { echo "FAIL $*" >&2; exit 1; }
info() { echo "* $*"; }
ok() { echo "OK $*"; }

# 1. Point at Xcode for this process only (avoids needing sudo xcode-select).
export DEVELOPER_DIR="/Applications/Xcode.app/Contents/Developer"
[ -x "$DEVELOPER_DIR/usr/bin/xcodebuild" ] || \
    die "Xcode not found at $DEVELOPER_DIR, install Xcode.app from the App Store"

# 2. Load ASC API credentials
[ -f "$ENV_FILE" ] || die "Missing $ENV_FILE, see BUILD_AUTOMATION.md"
# shellcheck disable=SC1090
source "$ENV_FILE"
[ -n "${ASC_KEY_ID:-}" ] || die "ASC_KEY_ID not set in $ENV_FILE"
[ -n "${ASC_ISSUER_ID:-}" ] || die "ASC_ISSUER_ID not set in $ENV_FILE"
P8="$HOME/.appstoreconnect/private_keys/AuthKey_${ASC_KEY_ID}.p8"
[ -f "$P8" ] || die "Missing API key at $P8"

# 3. Optionally bump CURRENT_PROJECT_VERSION (build number) in pbxproj
PBXPROJ="$PROJECT/project.pbxproj"
CUR_BUILD=$(grep -m1 -oE 'CURRENT_PROJECT_VERSION = [0-9]+' "$PBXPROJ" | grep -oE '[0-9]+')
CUR_VERSION=$(grep -m1 -oE 'MARKETING_VERSION = [0-9.]+' "$PBXPROJ" | grep -oE '[0-9.]+')
info "Current MARKETING_VERSION=$CUR_VERSION, build=$CUR_BUILD"
if [ "$BUMP" = "1" ]; then
    NEW_BUILD=$((CUR_BUILD + 1))
    sed -i '' "s/CURRENT_PROJECT_VERSION = $CUR_BUILD;/CURRENT_PROJECT_VERSION = $NEW_BUILD;/g" "$PBXPROJ"
    ok "build $CUR_BUILD -> $NEW_BUILD"
    CUR_BUILD=$NEW_BUILD
fi

# 4. Capacitor sync (run from repo root, no mobile/ subdir)
info "cap:sync ios"
( cd "$REPO" && npx cap sync ios )

# 4b. Signing keychain. The private key lives in a dedicated keychain whose
# partition list pre-approves codesign; without it codesign raises a GUI
# prompt and the archive hangs with no output.
KEYCHAIN="$HOME/Library/Keychains/lazysous-signing.keychain-db"
KEYCHAIN_ENV="$HOME/.lazysous/signing-keychain.env"
if [ -f "$KEYCHAIN" ] && [ -f "$KEYCHAIN_ENV" ]; then
    # shellcheck disable=SC1090
    source "$KEYCHAIN_ENV"
    security unlock-keychain -p "$SIGNING_KEYCHAIN_PASSWORD" "$KEYCHAIN" \
        && info "unlocked signing keychain"
    if ! security list-keychains -d user | grep -q "lazysous-signing"; then
        # shellcheck disable=SC2046
        security list-keychains -d user -s "$KEYCHAIN" \
            $(security list-keychains -d user | tr -d '"' | sed 's/^ *//')
        info "added signing keychain to the search list"
    fi
else
    info "warning: no dedicated signing keychain; codesign may raise a GUI prompt"
fi
security find-identity -v -p codesigning | grep -q "Apple Distribution" || \
    die "No 'Apple Distribution' identity in the keychain. See BUILD_AUTOMATION.md section 3."
ls "$HOME/Library/MobileDevice/Provisioning Profiles/93PGBWRFQ5.mobileprovision" >/dev/null 2>&1 || \
    die "Brewmie AppStore 2026 profile not installed. See BUILD_AUTOMATION.md section 3."

# 5. Clean + archive
rm -rf "$ARCHIVE" "$IPA_DIR"
mkdir -p "$BUILD_DIR"

# Archive with AUTOMATIC signing, export manually (section 6).
#
# The manual settings must NOT go on the xcodebuild command line: build
# settings passed that way apply to every target in the workspace, including
# the ~15 Pods static libraries, which fail with "<Pod> does not support
# provisioning profiles ... but provisioning profile Brewmie AppStore 2026
# has been manually specified". The App target's pbxproj already carries
# CODE_SIGN_STYLE = Automatic + DEVELOPMENT_TEAM, and the ASC API key lets
# -allowProvisioningUpdates resolve a development-style identity for the
# archive. Distribution signing happens at export, where the plist names the
# profile for the app bundle id alone. This is the same split Lazy Sous uses.
info "Archiving (Release)..."
ARCHIVE_LOG="$BUILD_DIR/archive.log"
ARCHIVE_ARGS=(
    -workspace "$IOS_DIR/App.xcworkspace"
    -scheme "$SCHEME"
    -configuration Release
    -sdk iphoneos
    -destination 'generic/platform=iOS'
    -archivePath "$ARCHIVE"
    -allowProvisioningUpdates
    -authenticationKeyPath "$P8"
    -authenticationKeyID "$ASC_KEY_ID"
    -authenticationKeyIssuerID "$ASC_ISSUER_ID"
    archive
)
if command -v xcbeautify >/dev/null 2>&1; then
    xcodebuild "${ARCHIVE_ARGS[@]}" 2>&1 | tee "$ARCHIVE_LOG" | xcbeautify --quiet
else
    # Full log to a file. xcodebuild prints thousands of lines and the
    # failure, when there is one, is in the last fifty.
    xcodebuild "${ARCHIVE_ARGS[@]}" > "$ARCHIVE_LOG" 2>&1 || {
        tail -60 "$ARCHIVE_LOG"
        die "Archive failed, full log at $ARCHIVE_LOG"
    }
    grep -E "ARCHIVE SUCCEEDED|warning: .*(sign|provision)" "$ARCHIVE_LOG" | tail -5 || true
fi

[ -d "$ARCHIVE" ] || die "Archive failed, see $ARCHIVE_LOG"
ok "Archived to $ARCHIVE"

# 6. Export ipa for App Store distribution.
#
# Manual signing. The App Store Connect key has the App Manager role, which
# cannot use Apple's cloud-managed distribution certificates, so automatic
# export fails with "You haven't been given access to cloud-managed
# distribution certificates". The team's Apple Distribution certificate and
# its private key live in the dedicated keychain Lazy Sous set up
# (~/Library/Keychains/lazysous-signing.keychain-db, partition list
# pre-approved for codesign); the Brewmie App Store profile (ASC id
# 93PGBWRFQ5) was created through the ASC API against that certificate.
# See BUILD_AUTOMATION.md section 3.
PROFILE_APP="Brewmie AppStore 2026"
SIGN_ID="Apple Distribution"
TEAM_ID="L36L3B3J32"
cat > "$EXPORT_OPTS" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key><string>app-store-connect</string>
    <key>signingStyle</key><string>manual</string>
    <key>teamID</key><string>$TEAM_ID</string>
    <key>signingCertificate</key><string>$SIGN_ID</string>
    <key>provisioningProfiles</key>
    <dict>
        <key>app.brewmie.brewmie</key><string>$PROFILE_APP</string>
    </dict>
    <key>uploadBitcode</key><false/>
    <key>uploadSymbols</key><true/>
    <key>destination</key><string>export</string>
</dict>
</plist>
PLIST
info "Exporting .ipa (manual signing)..."
EXPORT_LOG="$BUILD_DIR/export.log"
xcodebuild \
    -exportArchive \
    -archivePath "$ARCHIVE" \
    -exportPath "$IPA_DIR" \
    -exportOptionsPlist "$EXPORT_OPTS" > "$EXPORT_LOG" 2>&1 || {
    tail -40 "$EXPORT_LOG"
    die "Export failed, full log at $EXPORT_LOG"
}
IPA=$(find "$IPA_DIR" -name "*.ipa" -type f | head -1)
[ -f "$IPA" ] || die "Export failed, no .ipa produced"
ok "Exported $IPA"

if [ "$SKIP_UPLOAD" = "1" ]; then
    ok "Skipping upload (--skip-upload). IPA ready at: $IPA"
    exit 0
fi

# 7. Upload via App Store Connect API
info "Uploading to App Store Connect..."
xcrun altool --upload-app \
    --type ios \
    --file "$IPA" \
    --apiKey "$ASC_KEY_ID" \
    --apiIssuer "$ASC_ISSUER_ID"

ok "Uploaded build $CUR_BUILD (v$CUR_VERSION). Visit App Store Connect, TestFlight to verify."
