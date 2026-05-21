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

# 5. Clean + archive
rm -rf "$ARCHIVE" "$IPA_DIR"
mkdir -p "$BUILD_DIR"

info "Archiving (Release)..."
xcodebuild \
    -workspace "$IOS_DIR/App.xcworkspace" \
    -scheme "$SCHEME" \
    -configuration Release \
    -sdk iphoneos \
    -destination 'generic/platform=iOS' \
    -archivePath "$ARCHIVE" \
    -allowProvisioningUpdates \
    archive | xcbeautify --quiet 2>/dev/null || \
xcodebuild \
    -workspace "$IOS_DIR/App.xcworkspace" \
    -scheme "$SCHEME" \
    -configuration Release \
    -sdk iphoneos \
    -destination 'generic/platform=iOS' \
    -archivePath "$ARCHIVE" \
    -allowProvisioningUpdates \
    archive | tail -40

[ -d "$ARCHIVE" ] || die "Archive failed"
ok "Archived to $ARCHIVE"

# 6. Export ipa for App Store distribution
cat > "$EXPORT_OPTS" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key><string>app-store</string>
    <key>signingStyle</key><string>automatic</string>
    <key>uploadBitcode</key><false/>
    <key>uploadSymbols</key><true/>
    <key>destination</key><string>export</string>
</dict>
</plist>
PLIST

info "Exporting .ipa..."
xcodebuild \
    -exportArchive \
    -archivePath "$ARCHIVE" \
    -exportPath "$IPA_DIR" \
    -exportOptionsPlist "$EXPORT_OPTS" \
    -allowProvisioningUpdates | tail -20

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
