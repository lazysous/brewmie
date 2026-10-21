#!/usr/bin/env bash
# One-command release for Brewmie.
#
# Usage:
#   scripts/release.sh ota <ver>            # OTA via our own worker (JS bundle only)
#   scripts/release.sh native               # gate, iOS submit, then Play at 20% (no OTA bump)
#   scripts/release.sh all <ota_version>    # OTA push + iOS + Play
#
# PLAY_NOTES="..." sets the Play release note for `native` / `all`.
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
        # Order matters (audit brewmie-26): gate, then iOS built, uploaded, validated and submitted,
        # and only then Google Play, as a STAGED rollout (20 percent). Widen it later with
        # scripts/publish_play.py --complete-rollout.
        notes="${PLAY_NOTES:-Bug fixes and improvements.}"
        "$REPO/scripts/release_preflight.sh"
        echo "-> Starting iOS upload (foreground, needs Xcode)..."
        "$REPO/scripts/publish_ios.sh"
        echo "-> Creating App Store version, localizing release notes, attaching build, submitting for review..."
        "$REPO/scripts/submit_ios_release.py" --wait --submit
        echo "-> iOS validated and submitted. Uploading to Google Play as a 20% staged production rollout..."
        "$REPO/scripts/publish_play.py" --track production --rollout-fraction 0.2 --notes "$notes" \
            || { echo "FAIL Play (iOS is already submitted)"; exit 1; }
        echo "OK Play done at 20%. When it looks healthy: scripts/publish_play.py --complete-rollout"
        ios_ver=$(grep -m1 -oE 'MARKETING_VERSION = [0-9.]+' "$REPO/ios/App/App.xcodeproj/project.pbxproj" | grep -oE '[0-9.]+')
        git -C "$REPO" tag "native-v$ios_ver" && echo "OK tagged native-v$ios_ver (push the tag yourself)"
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
