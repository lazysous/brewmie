#!/usr/bin/env bash
# Brewmie OTA push — one-command pipeline.
#
# Usage:
#   scripts/ota_push.sh <version>
#
# Example:
#   scripts/ota_push.sh 1.0.2
#
# What it does:
#   1. npm run build (fresh dist/)
#   2. Zips dist/ into ota/builds/<version>.zip (excludes ota/ to avoid recursion)
#   3. Copies the zip into dist/ota/builds/<version>.zip so Cloudflare Pages
#      serves it at https://brewmie.app/ota/builds/<version>.zip
#   4. wrangler pages deploy dist (publishes the site + the new zip)
#   5. Rewrites LATEST_VERSION + LATEST_URL + OTA_ENABLED in ota/worker.js
#   6. wrangler deploy ota/worker.js
#   7. Smoke tests the worker
#
# Devices on @capgo/capacitor-updater with autoUpdate=true will pull the new
# bundle on next launch (~1h poll). iOS apps shipped with autoUpdate=false
# (any build before v1.0.1) will skip the polling and stay on the bundled
# version regardless.

set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

VERSION="${1:?Usage: scripts/ota_push.sh <version>}"

# Sanity check the version looks like semver
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || {
    echo "FAIL invalid version: $VERSION  (expected e.g. 1.0.2)" >&2
    exit 2
}

# Refuse to push a bundle older than the shipping native binary. The bug
# fixed on 2026-05-23: pushing OTA <native> means fresh installs (which
# report the native marketing version on first poll) get told to "upgrade"
# to an older bundle and end up running stale code. This guard is the
# single most important rule: OTA bundles can only go FORWARD.
NATIVE_VERSION=$(grep -m1 -oE 'MARKETING_VERSION = [0-9.]+' ios/App/App.xcodeproj/project.pbxproj | grep -oE '[0-9.]+')
[ -n "$NATIVE_VERSION" ] || { echo "FAIL could not read MARKETING_VERSION from pbxproj" >&2; exit 2; }
ver_lt() {  # ver_lt A B  -> true if A < B (semver-ish)
    [ "$1" = "$2" ] && return 1
    [ "$(printf '%s\n%s' "$1" "$2" | sort -V | head -1)" = "$1" ]
}
if ver_lt "$VERSION" "$NATIVE_VERSION"; then
    echo "FAIL refusing to push OTA $VERSION while shipping native is $NATIVE_VERSION." >&2
    echo "     OTA bundles can only go forward. Bump the version arg to >= $NATIVE_VERSION." >&2
    exit 2
fi

ZIP_REL="ota/builds/${VERSION}.zip"
ZIP_ABS="${REPO}/${ZIP_REL}"
DIST_ZIP_REL="dist/ota/builds/${VERSION}.zip"

info() { echo "* $*"; }
ok() { echo "OK $*"; }

# 1) Build
info "npm run build"
npm run build > /tmp/brewmie-ota-build.log 2>&1 || {
    echo "FAIL build, see /tmp/brewmie-ota-build.log" >&2
    tail -20 /tmp/brewmie-ota-build.log
    exit 1
}
ok "dist/ rebuilt"

# 2) Zip dist (excluding any ota/ subdir left over from a previous run)
info "zipping dist -> $ZIP_REL"
mkdir -p ota/builds
rm -f "$ZIP_ABS"
(cd dist && zip -rq "$ZIP_ABS" . -x "ota/*")
SIZE=$(du -h "$ZIP_ABS" | awk '{print $1}')
ok "wrote $ZIP_REL ($SIZE)"

# 3) Make zip reachable via Pages
mkdir -p dist/ota/builds
cp "$ZIP_ABS" "$DIST_ZIP_REL"
ok "copied to $DIST_ZIP_REL"

# 4) Deploy Pages
info "wrangler pages deploy"
wrangler pages deploy dist --project-name brewmie --branch main --commit-dirty=true > /tmp/brewmie-ota-pages.log 2>&1 || {
    echo "FAIL pages deploy, see /tmp/brewmie-ota-pages.log" >&2
    tail -10 /tmp/brewmie-ota-pages.log
    exit 1
}
ok "Pages deployed; zip live at https://brewmie.app/${ZIP_REL}"

# 5) Rewrite worker constants
info "updating ota/worker.js (OTA_ENABLED=true, LATEST_VERSION=${VERSION})"
python3 - "$VERSION" <<'PY'
import re, sys
from pathlib import Path
ver = sys.argv[1]
p = Path("ota/worker.js")
src = p.read_text()
src = re.sub(r"const OTA_ENABLED = (?:true|false)", "const OTA_ENABLED = true", src)
src = re.sub(r"const LATEST_VERSION = '[^']+'", f"const LATEST_VERSION = '{ver}'", src)
src = re.sub(
    r"const LATEST_URL = 'https://brewmie\.app/ota/builds/[^']+'",
    f"const LATEST_URL = 'https://brewmie.app/ota/builds/{ver}.zip'",
    src,
)
p.write_text(src)
PY
ok "worker.js patched"

# 6) Deploy worker
info "wrangler deploy worker"
wrangler deploy ota/worker.js --name brewmie-ota --compatibility-date "$(date -u -v-1d +%Y-%m-%d)" > /tmp/brewmie-ota-worker.log 2>&1 || {
    echo "FAIL worker deploy, see /tmp/brewmie-ota-worker.log" >&2
    tail -10 /tmp/brewmie-ota-worker.log
    exit 1
}
ok "worker redeployed"

# 7) Smoke test
info "smoke testing worker"
DEVICE_OLD=$(curl -fs -X POST https://brewmie-ota.richbwilliamson.workers.dev \
    -H "Content-Type: application/json" -d '{"version_name":"1.0"}')
DEVICE_NEW=$(curl -fs -X POST https://brewmie-ota.richbwilliamson.workers.dev \
    -H "Content-Type: application/json" -d "{\"version_name\":\"${VERSION}\"}")
echo "  device 1.0 -> $DEVICE_OLD"
echo "  device $VERSION -> $DEVICE_NEW"
if ! echo "$DEVICE_NEW" | grep -q no_new_version_available; then
    echo "FAIL worker did not return no_new_version for device on $VERSION" >&2
    exit 1
fi
if ! echo "$DEVICE_OLD" | grep -q "$VERSION"; then
    echo "FAIL worker did not offer $VERSION to device on 1.0" >&2
    exit 1
fi
ok "smoke test passed"

echo
echo "DONE  OTA bundle ${VERSION} live. Android (autoUpdate=true) will pull on next launch."
