#!/usr/bin/env bash
# Roll back a bad Brewmie OTA (audit 2026-10, brewmie-39 / shared-03).
#   scripts/ota_rollback.sh <version>   republish an existing zip (must be live on brewmie.app)
#   scripts/ota_rollback.sh builtin     reset every device to the bundle shipped in the store binary
#   scripts/ota_rollback.sh off         stop serving updates; devices keep what they have
# Add --dry-run to see the worker constants it would deploy without deploying.
# Order on a bad bundle: run this FIRST (devices stop fetching the bad zip within the hour),
# then fix forward with scripts/ota_push.sh <higher version>.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"; cd "$REPO"
TARGET="${1:?usage: scripts/ota_rollback.sh <version>|builtin|off [--dry-run]}"
DRY=0; [ "${2:-}" = "--dry-run" ] && DRY=1
NATIVE_VERSION=$(grep -m1 -oE 'MARKETING_VERSION = [0-9.]+' ios/App/App.xcodeproj/project.pbxproj | grep -oE '[0-9.]+')
WORKER_URL="https://brewmie-ota.richbwilliamson.workers.dev"
case "$TARGET" in
    builtin) ENABLED=true; REVERT=true; VERSION=$(grep -m1 -oE "const LATEST_VERSION = '[^']+'" ota/worker.js | grep -oE "[0-9][^']*"); URL="" ;;
    off)     ENABLED=false; REVERT=false; VERSION=$(grep -m1 -oE "const LATEST_VERSION = '[^']+'" ota/worker.js | grep -oE "[0-9][^']*"); URL="" ;;
    *)
        [[ "$TARGET" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "FAIL '$TARGET' is not a version, builtin or off" >&2; exit 2; }
        ENABLED=true; REVERT=false; VERSION="$TARGET"; URL="https://brewmie.app/ota/builds/${TARGET}.zip"
        if [ -f "ota/builds/${TARGET}.zip" ]; then
            bash scripts/ota_smoke.sh "$URL" "$(wc -c < "ota/builds/${TARGET}.zip" | tr -d ' ')" 2
        else
            code=$(curl -s -o /dev/null -w '%{http_code} %{content_type}' --max-time 60 "$URL")
            printf '%s' "$code" | grep -q -E '^200 application/(zip|octet-stream)' || { echo "FAIL $URL is not a live zip ($code); republish it with ota_push.sh first" >&2; exit 2; }
        fi ;;
esac
python3 - "$ENABLED" "$VERSION" "$URL" "$REVERT" "$NATIVE_VERSION" <<'PY'
import re, sys
from pathlib import Path
enabled, ver, url, revert, native = sys.argv[1:6]
p = Path("ota/worker.js"); src = p.read_text()
src = re.sub(r"const OTA_ENABLED = (?:true|false)", f"const OTA_ENABLED = {enabled}", src)
src = re.sub(r"const LATEST_VERSION = '[^']+'", f"const LATEST_VERSION = '{ver}'", src)
if url:
    src = re.sub(r"const LATEST_URL = 'https://brewmie\.app/ota/builds/[^']+'", f"const LATEST_URL = '{url}'", src)
src = re.sub(r"const REVERT_TO_BUILTIN = (?:true|false)", f"const REVERT_TO_BUILTIN = {revert}", src)
src = re.sub(r"const NATIVE_VERSION = '[^']*'", f"const NATIVE_VERSION = '{native}'", src)
p.write_text(src)
PY
echo "worker constants now:"; grep -E "const (OTA_ENABLED|LATEST_VERSION|LATEST_URL|REVERT_TO_BUILTIN|NATIVE_VERSION) =" ota/worker.js | sed 's/^ *//'
if [ "$DRY" = "1" ]; then echo "DRY RUN: restoring ota/worker.js, nothing deployed"; git checkout -q -- ota/worker.js; exit 0; fi
wrangler deploy ota/worker.js --name brewmie-ota --compatibility-date "$(date -u -v-1d +%Y-%m-%d)" > /tmp/brewmie-ota-rollback.log 2>&1 || { echo "FAIL worker deploy, see /tmp/brewmie-ota-rollback.log" >&2; tail -10 /tmp/brewmie-ota-rollback.log; exit 1; }
for attempt in $(seq 1 10); do
    RESP=$(curl -fs -X POST "$WORKER_URL" -H "Content-Type: application/json" -d '{"version_name":"0.0.1"}' || true)
    case "$TARGET" in
        builtin) echo "$RESP" | grep -q '"builtin"' && break ;;
        off)     echo "$RESP" | grep -q no_new_version_available && break ;;
        *)       echo "$RESP" | grep -q "$VERSION" && break ;;
    esac
    [ "$attempt" = "10" ] || sleep 3
done
echo "  device 0.0.1 -> $RESP"
git add ota/worker.js && git commit -q -m "OTA rollback: ${TARGET}" && git tag -a "ota-rollback-$(date -u +%Y%m%dT%H%M%SZ)" -m "OTA rollback to ${TARGET}" && git push -q origin main --tags
echo "DONE rollback to ${TARGET} live; fix forward with scripts/ota_push.sh <higher version>"
