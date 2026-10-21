#!/usr/bin/env bash
# Characterisation test for scripts/release_preflight.sh (audit brewmie-26): builds a throwaway
# repo with a bare origin and proves the native gate passes a good release and refuses
# version-equal-to-live, an already-tagged version, a dirty tree, an unpushed HEAD and failing
# code checks. No network. Run: bash scripts/test_release_preflight.sh (npm run test:release-preflight)
set -u
cd "$(dirname "$0")/.."
GATE="$(pwd)/scripts/release_preflight.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
W="$TMP/work"; fail=0; out=""; CHECK=true
git init -q --bare "$TMP/origin.git"
git init -q -b main "$W"
git -C "$W" remote add origin "$TMP/origin.git"
git -C "$W" config user.email t@example.invalid; git -C "$W" config user.name t; git -C "$W" config commit.gpgsign false
mkdir -p "$W/ios/App/App.xcodeproj"
setv() { printf 'MARKETING_VERSION = %s;\n' "$1" > "$W/ios/App/App.xcodeproj/project.pbxproj"; }
setv 1.1
printf '# Changelog\n\n> Current shipped versions (verify): Android 1.1 is live. iOS 1.1 (build 12) is submitted.\n' > "$W/CHANGELOG.md"
printf '{ "name": "x", "version": "0.1.0" }\n' > "$W/package.json"
git -C "$W" add -A -f && git -C "$W" commit -q -m init && git -C "$W" push -q origin main
run() { out=$(RELEASE_ROOT="$W" RELEASE_CHECK_CMD="$CHECK" bash "$GATE" 2>&1); return $?; }
check() { if [ "$2" = "$3" ] && { [ -z "${4:-}" ] || printf '%s' "$out" | grep -q -F -- "$4"; }; then echo "  ok   $1"
          else echo "  FAIL $1 (expected exit $2, got $3; output: $(printf '%s' "$out" | head -2 | tr '\n' ' '))"; fail=1; fi; }
commit_push() { git -C "$W" add -A -f && git -C "$W" commit -q -m "$1" && git -C "$W" push -q origin main; }

run; check "iOS version equal to the live App Store version is refused" 2 $? "equals the live App Store version"

setv 1.2; commit_push bump
run; check "a bumped, pushed, clean tree passes" 0 $? "OK native gate"

CHECK=false; run; check "failing build/test/tsc checks are refused" 2 $? "code checks failed"; CHECK=true

git -C "$W" tag native-v1.2
run; check "an already-tagged native version is refused" 2 $? "native-v1.2 already exists"
git -C "$W" tag -d native-v1.2 >/dev/null

echo "dirty" > "$W/stray.txt"
run; check "a dirty tree is refused" 2 $? "working tree is not clean"
rm -f "$W/stray.txt"

echo "x" > "$W/more.txt"; git -C "$W" add -A && git -C "$W" commit -q -m local
run; check "an unpushed HEAD is refused" 2 $? "HEAD is not origin/main"

# Without a local pbxproj the gate falls back to package.json and says so.
git -C "$W" reset -q --hard origin/main; rm -rf "$W/ios"
git -C "$W" rm -rq --cached ios 2>/dev/null; git -C "$W" commit -q -m noios 2>/dev/null; git -C "$W" push -q origin main
run; check "no pbxproj falls back to package.json" 0 $? "from package.json"

[ $fail -eq 0 ] && echo "release preflight: all ok" || echo "release preflight: FAILURES"
exit $fail
