#!/usr/bin/env bash
# One-command release for Brewmie.
#
# Usage:
#   scripts/release.sh ota <ver>            # OTA via Capgo (JS bundle only)
#   scripts/release.sh native               # native iOS + Play (no OTA bump)
#   scripts/release.sh all <ota_version>    # OTA push + iOS + Play
#
# Examples:
#   scripts/release.sh ota 1.0.4
#   scripts/release.sh native
#   scripts/release.sh all 1.0.4

set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"

cmd="${1:-}"

case "$cmd" in
    ota)
        ver="${2:?Usage: release.sh ota <version>}"
        exec "$REPO/scripts/ota_push.sh" "$ver"
        ;;
    native)
        echo "-> Starting Play upload in background..."
        "$REPO/scripts/publish_play.py" --track production \
            --notes "First release. Pull a shot, dial it in, no subscription." \
            > /tmp/brewmie-play.log 2>&1 &
        play_pid=$!
        echo "-> Starting iOS upload (foreground, needs Xcode)..."
        "$REPO/scripts/publish_ios.sh"
        echo "-> Creating App Store version, localizing release notes, attaching build, submitting for review..."
        "$REPO/scripts/submit_ios_release.py" --wait --submit
        echo "-> Waiting for Play upload..."
        wait "$play_pid" && echo "OK Play done." || { echo "FAIL Play, see /tmp/brewmie-play.log"; tail -30 /tmp/brewmie-play.log; exit 1; }
        ;;
    all)
        ver="${2:?Usage: release.sh all <ota_version>}"
        "$REPO/scripts/ota_push.sh" "$ver"
        "$0" native
        ;;
    *)
        echo "Usage: $0 {ota <ver> | native | all <ver>}" >&2
        exit 2
        ;;
esac
