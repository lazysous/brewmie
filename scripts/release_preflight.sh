#!/usr/bin/env bash
# Native release gate (audit 2026-10, brewmie-26; mirrors Lazy Sous lazysous-64). Called first by
# scripts/release.sh native, before any build or upload. Refuses when:
#   - the working tree is dirty, or HEAD is not origin/main (the binary must match a pushed commit)
#   - `npm run build`, `npx vitest run` or `npx tsc --noEmit` fails
#   - the iOS MARKETING_VERSION equals the live App Store version recorded in CHANGELOG.md
#   - a native-v<MARKETING_VERSION> git tag already exists (that version was already released)
# Version source: ios/App/App.xcodeproj/project.pbxproj when present (ios/ is gitignored and lives
# only on this Mac), otherwise package.json "version".
# RELEASE_ROOT overrides the repo root and RELEASE_CHECK_CMD replaces the three code checks
# (the tests use a throwaway repo and a stub).
set -euo pipefail
ROOT="${RELEASE_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"; cd "$ROOT"
fail() { echo "FAIL $*" >&2; exit 2; }

PBX="ios/App/App.xcodeproj/project.pbxproj"
if [ -f "$PBX" ]; then
    IOS=$(grep -m1 -oE 'MARKETING_VERSION = [0-9.]+' "$PBX" | grep -oE '[0-9.]+' || true)
    SRC="$PBX"
else
    IOS=$(grep -m1 -oE '"version": *"[0-9.]+"' package.json 2>/dev/null | grep -oE '[0-9][0-9.]*' || true)
    SRC="package.json (no local $PBX)"
fi
[ -n "$IOS" ] || fail "cannot read the iOS version from $SRC"

[ -z "$(git status --porcelain)" ] || fail "working tree is not clean; commit first (the binary must match a commit)"
git fetch -q origin main || fail "cannot fetch origin/main"
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || fail "HEAD is not origin/main; push first"

# Every line mentioning the marker is searched (the CHANGELOG's own explanation also names it); the first
# 'iOS x.y[.z]' on those lines is the live version.
LIVE_IOS=$(grep -E 'Current shipped versions' CHANGELOG.md 2>/dev/null | grep -oE 'iOS [0-9]+\.[0-9]+(\.[0-9]+)?' | head -1 | grep -oE '[0-9.]+$' || true)
[ -n "$LIVE_IOS" ] || fail "cannot read the live iOS version from the 'Current shipped versions' line of CHANGELOG.md"
[ "$IOS" != "$LIVE_IOS" ] || fail "iOS version $IOS equals the live App Store version in CHANGELOG.md; bump it first"
[ -z "$(git tag --list "native-v$IOS")" ] || fail "tag native-v$IOS already exists; that native version was already released"

if [ -n "${RELEASE_CHECK_CMD:-}" ]; then
    bash -c "$RELEASE_CHECK_CMD" || fail "code checks failed (RELEASE_CHECK_CMD); fix before a native release"
else
    npm run build || fail "npm run build failed"
    npx vitest run || fail "npx vitest run failed"
    npx tsc --noEmit || fail "npx tsc --noEmit failed"
fi

echo "OK native gate: clean tree at $(git rev-parse --short HEAD) == origin/main, build + tests + tsc green, iOS $IOS from $SRC (live $LIVE_IOS)"
