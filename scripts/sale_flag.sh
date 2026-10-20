#!/usr/bin/env bash
# Switch the gold "Sale price" badge on the Premium sheet on or off (temporary sale, 2026-10).
#   scripts/sale_flag.sh on <until>   e.g. scripts/sale_flag.sh on 2026-11-10T13:00:00Z (UTC, ISO 8601)
#   scripts/sale_flag.sh off
# Add --dry-run to see the worker constants it would deploy without deploying.
#
# The badge is read by the app from the OTA worker (GET /sale), so this rewrites the two
# SALE_* constants in ota/worker.js, redeploys the worker (seconds, no bundle version), proves
# the answer, and commits + pushes so the next ota_push.sh carries the same constants. The
# price itself always comes from the store: lower the store prices BEFORE switching this on,
# and switch it off BEFORE they go back up. A sale with no valid end time never shows.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"; cd "$REPO"
MODE="${1:?usage: scripts/sale_flag.sh on <until-utc-iso>|off [--dry-run]}"
WORKER_URL="https://brewmie-ota.richbwilliamson.workers.dev"
DRY=0
case "$MODE" in
    on)
        UNTIL="${2:?usage: scripts/sale_flag.sh on <until-utc-iso> [--dry-run]}"
        [ "${3:-}" = "--dry-run" ] && DRY=1
        [[ "$UNTIL" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] || { echo "FAIL until must look like 2026-11-10T13:00:00Z (UTC)" >&2; exit 2; }
        NOW_EPOCH=$(date -u +%s); UNTIL_EPOCH=$(date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$UNTIL" +%s 2>/dev/null || date -u -d "$UNTIL" +%s)
        [ "$UNTIL_EPOCH" -gt "$NOW_EPOCH" ] || { echo "FAIL until is in the past" >&2; exit 2; }
        ACTIVE=true ;;
    off)
        [ "${2:-}" = "--dry-run" ] && DRY=1
        ACTIVE=false; UNTIL="" ;;
    *) echo "FAIL '$MODE' is not on or off" >&2; exit 2 ;;
esac
[ "$DRY" = "1" ] || { [ -z "$(git status --porcelain)" ] || { echo "FAIL working tree is not clean; commit or set aside first" >&2; exit 2; }; }
# A dry run prints what it would write and never touches the file (a checkout-based
# restore would also discard any uncommitted edits to the worker).
python3 - "$ACTIVE" "$UNTIL" "$DRY" <<'PY'
import re, sys
from pathlib import Path
active, until, dry = sys.argv[1:4]
p = Path("ota/worker.js"); src = p.read_text()
src, n1 = re.subn(r"const SALE_ACTIVE = (?:true|false)", f"const SALE_ACTIVE = {active}", src)
src, n2 = re.subn(r"const SALE_UNTIL = '[^']*'", f"const SALE_UNTIL = '{until}'", src)
assert n1 == 1 and n2 == 1, "SALE_* constants not found exactly once in ota/worker.js"
print("worker constants " + ("would be:" if dry == "1" else "now:"))
for line in src.splitlines():
    if re.search(r"const (SALE_ACTIVE|SALE_UNTIL) =", line): print(line.strip())
if dry != "1": p.write_text(src)
PY
if [ "$DRY" = "1" ]; then echo "DRY RUN: nothing written, nothing deployed"; exit 0; fi
# IPv6 is broken on the owner's Mac and Node's address autoselection times out before it
# falls back, so wrangler reports "fetch failed" while curl works (BUILD_AUTOMATION section 8).
export NODE_OPTIONS="--no-network-family-autoselection --dns-result-order=ipv4first ${NODE_OPTIONS:-}"
wrangler deploy -c ota/wrangler.toml > /tmp/brewmie-sale-flag.log 2>&1 || { echo "FAIL worker deploy, see /tmp/brewmie-sale-flag.log" >&2; tail -10 /tmp/brewmie-sale-flag.log; git checkout -q -- ota/worker.js; echo "ota/worker.js restored; nothing changed" >&2; exit 1; }
for attempt in $(seq 1 10); do
    RESP=$(curl -fs "$WORKER_URL/sale" || true)
    echo "$RESP" | grep -q "\"active\":$ACTIVE" && break
    [ "$attempt" = "10" ] || sleep 3
done
echo "  GET /sale -> $RESP"
echo "$RESP" | grep -q "\"active\":$ACTIVE" || { echo "FAIL the worker does not answer active=$ACTIVE" >&2; exit 1; }
git add ota/worker.js && git commit -q -m "Sale flag: ${MODE}${UNTIL:+ until $UNTIL}" && git push -q origin main
echo "DONE sale ${MODE}${UNTIL:+ until $UNTIL}; devices see it on the next Premium sheet open (within five minutes of a running session)"
