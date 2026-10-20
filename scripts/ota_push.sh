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
# IPv6 is broken on the owner's Mac and Node's address autoselection times out before it
# falls back, so wrangler reports "fetch failed" while curl works (BUILD_AUTOMATION section 8).
export NODE_OPTIONS="--no-network-family-autoselection --dns-result-order=ipv4first ${NODE_OPTIONS:-}"

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

# 0) Release gate (audit 2026-10: brewmie-24, brewmie-38, brewmie-40, shared-04).
#    Clean, pushed tree so the bundle is reproducible; a version that is new and above the
#    live OTA; real Supabase credentials; and the test suite, unless SKIP_TESTS=1 shouts.
[ -z "$(git status --porcelain)" ] || { echo "FAIL working tree is not clean; commit first (the bundle must match a commit)" >&2; exit 2; }
git fetch -q origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || { echo "FAIL HEAD is not origin/main; push first" >&2; exit 2; }
[ ! -f "ota/builds/${VERSION}.zip" ] || { echo "FAIL ota/builds/${VERSION}.zip already exists; versions are never reused" >&2; exit 2; }
CURRENT_OTA=$(grep -m1 -oE "const LATEST_VERSION = '[^']+'" ota/worker.js | grep -oE "[0-9][^']*")
if [ "$VERSION" = "$CURRENT_OTA" ] || ver_lt "$VERSION" "$CURRENT_OTA"; then
    echo "FAIL $VERSION is not above the live OTA $CURRENT_OTA" >&2; exit 2
fi
[ -f .env.local ] || { echo "FAIL .env.local is missing: the build would bake placeholder Supabase credentials" >&2; exit 2; }
for k in VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY; do
    v=$(grep -E "^${k}=" .env.local | head -1 | cut -d= -f2- | tr -d "\"'")
    if [ -z "$v" ] || printf '%s' "$v" | grep -q -i placeholder; then
        echo "FAIL ${k} is missing or a placeholder in .env.local" >&2; exit 2
    fi
done
SUPABASE_URL_REAL=$(grep -E "^VITE_SUPABASE_URL=" .env.local | head -1 | cut -d= -f2- | tr -d "\"'")
ok "gate: clean tree at $(git rev-parse --short HEAD) == origin/main, $VERSION > $CURRENT_OTA, .env.local present"
if [ "${SKIP_TESTS:-0}" = "1" ]; then
    echo "!!! SKIP_TESTS=1: shipping WITHOUT vitest and tsc. The release tag will say so." >&2
else
    info "npm test + tsc"
    npm test > /tmp/brewmie-ota-tests.log 2>&1 || { echo "FAIL npm test, see /tmp/brewmie-ota-tests.log" >&2; tail -20 /tmp/brewmie-ota-tests.log; exit 1; }
    npx tsc --noEmit > /tmp/brewmie-ota-tsc.log 2>&1 || { echo "FAIL tsc, see /tmp/brewmie-ota-tsc.log" >&2; tail -20 /tmp/brewmie-ota-tsc.log; exit 1; }
    ok "tests and typecheck green"
fi

# 1) Build
info "npm run build"
npm run build > /tmp/brewmie-ota-build.log 2>&1 || {
    echo "FAIL build, see /tmp/brewmie-ota-build.log" >&2
    tail -20 /tmp/brewmie-ota-build.log
    exit 1
}
ok "dist/ rebuilt"
grep -rq -F "$SUPABASE_URL_REAL" dist/assets/ || {
    echo "FAIL dist/ does not contain the Supabase URL from .env.local; the build baked placeholders" >&2; exit 1
}
ok "dist/ carries the real Supabase URL"

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

# 3b) Keep the CURRENTLY advertised zip in the deploy. A Pages deploy replaces the whole
#     site, so without this the live zip vanishes while the worker still points at it
#     (brewmie-38). Prefer the local copy, else fetch the live one.
if [ -n "$CURRENT_OTA" ] && [ "$CURRENT_OTA" != "$VERSION" ]; then
    if [ -f "ota/builds/${CURRENT_OTA}.zip" ]; then
        cp "ota/builds/${CURRENT_OTA}.zip" "dist/ota/builds/${CURRENT_OTA}.zip"
    else
        curl -fsS -m 120 -o "dist/ota/builds/${CURRENT_OTA}.zip" "https://brewmie.app/ota/builds/${CURRENT_OTA}.zip" || {
            echo "FAIL could not keep the live zip ${CURRENT_OTA}.zip in the deploy (not local, not downloadable)" >&2; exit 1
        }
    fi
    ok "kept live ${CURRENT_OTA}.zip in dist/ota/builds"
fi
# Every zip still on disk rides along too, so a rollback to the previous version has a
# bundle to point at (brewmie-39: keep the last releases on Pages).
for z in ota/builds/*.zip; do [ -f "$z" ] && cp -n "$z" "dist/ota/builds/" 2>/dev/null || true; done

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
python3 - "$VERSION" "$NATIVE_VERSION" <<'PY'
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
src = re.sub(r"const REVERT_TO_BUILTIN = (?:true|false)", "const REVERT_TO_BUILTIN = false", src)
native = sys.argv[2]
src = re.sub(r"const NATIVE_VERSION = '[^']*'", f"const NATIVE_VERSION = '{native}'", src)
# The bundle was built against this native, so devices below it are not offered it (brewmie-23).
src = re.sub(r"const MIN_NATIVE_VERSION = '[^']*'", f"const MIN_NATIVE_VERSION = '{native}'", src)
p.write_text(src)
PY
ok "worker.js patched"

# 6) Deploy worker
info "wrangler deploy worker"
wrangler deploy -c ota/wrangler.toml > /tmp/brewmie-ota-worker.log 2>&1 || {
    echo "FAIL worker deploy, see /tmp/brewmie-ota-worker.log" >&2
    tail -10 /tmp/brewmie-ota-worker.log
    exit 1
}
ok "worker redeployed"

# 7) Smoke test
#
# Cloudflare can serve the previous worker version from an edge for a few
# seconds after `wrangler deploy` returns, so a single immediate probe can
# read the OLD LATEST_VERSION and fail a push that actually succeeded
# (happened on the 1.1.1 push, 2026-10-05). Retry for up to 30s and only
# fail if it never converges.
info "smoke testing worker"
WORKER_URL="https://brewmie-ota.richbwilliamson.workers.dev"
for attempt in $(seq 1 10); do
    DEVICE_OLD=$(curl -fs -X POST "$WORKER_URL" \
        -H "Content-Type: application/json" -d '{"version_name":"1.0"}' || true)
    DEVICE_NEW=$(curl -fs -X POST "$WORKER_URL" \
        -H "Content-Type: application/json" -d "{\"version_name\":\"${VERSION}\"}" || true)
    if echo "$DEVICE_OLD" | grep -q "$VERSION" && \
       echo "$DEVICE_NEW" | grep -q no_new_version_available; then
        break
    fi
    [ "$attempt" = "10" ] || { info "edge still on the old version, retrying ($attempt/10)"; sleep 3; }
done
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

# The bundle itself must be a real zip at the exact size we uploaded (a 200 text/html
# fallback would pass a status-only check and give every device a download error).
bash scripts/ota_smoke.sh "https://brewmie.app/${ZIP_REL}" "$(wc -c < "$ZIP_ABS" | tr -d ' ')" 20
ok "smoke test passed (worker + bundle verified)"

# 8) Record the release: the worker.js version change is committed and the commit tagged,
#    so every live bundle maps to a commit (brewmie-40).
NOTE=""; [ "${SKIP_TESTS:-0}" = "1" ] && NOTE=" (SKIP_TESTS=1: test suite NOT run)"
git add ota/worker.js
git commit -q -m "OTA ${VERSION}" || true
git tag -a "ota-v${VERSION}" -m "OTA ${VERSION}${NOTE}"
git push -q origin main "ota-v${VERSION}"
ok "committed worker.js and tagged ota-v${VERSION}"

echo
echo "DONE  OTA bundle ${VERSION} live. Android (autoUpdate=true) will pull on next launch."
