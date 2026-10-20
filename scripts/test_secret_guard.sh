#!/usr/bin/env bash
# Characterisation test for scripts/git-hooks/pre-commit: builds a throwaway repo,
# installs the hook and proves it exits 0 on a clean commit and non-zero on a staged
# secret-shaped literal, a blocked filename, and that an allowlisted public literal
# passes. No network. Run: bash scripts/test_secret_guard.sh
set -u
cd "$(dirname "$0")/.."
HOOKS="$(pwd)/scripts/git-hooks"
TMP="$(mktemp -d)"
HOOKCOPY="$(mktemp -d)"
trap 'rm -rf "$TMP" "$HOOKCOPY"' EXIT
fail=0
out=""
check() { # name expected_exit actual_exit [expected text in hook output]
    if [ "$2" = "$3" ] && { [ -z "${4:-}" ] || printf '%s' "$out" | grep -q -F -- "$4"; }; then echo "  ok   $1"
    else echo "  FAIL $1 (expected exit $2, got $3; output: $(printf '%s' "$out" | head -3 | tr '\n' ' '))"; fail=1; fi
}
# Commits what is staged; on refusal, unstages everything so one case never leaks
# into the next.
commit() { out=$(git -C "$TMP" commit -q -m "$1" 2>&1); rc=$?; [ $rc -ne 0 ] && git -C "$TMP" reset -q; return $rc; }
git -C "$TMP" init -q
git -C "$TMP" config user.email test@example.invalid
git -C "$TMP" config user.name "secret guard test"
git -C "$TMP" config commit.gpgsign false
cp "$HOOKS/pre-commit" "$HOOKCOPY/pre-commit"
printf 'AIzaPUBLICKEYFORTHETESTONLY0000000000000\n' > "$HOOKCOPY/secret-allowlist"
git -C "$TMP" config core.hooksPath "$HOOKCOPY"

echo "clean" > "$TMP/readme.txt"
git -C "$TMP" add -A && commit clean; check "clean tree commits" 0 $?

printf 'const key = "gsk_%s";\n' "abcdefghijklmnopqrstuvwxyz0123456789ABCD" > "$TMP/leak.js"
git -C "$TMP" add leak.js && commit leak; check "Groq-shaped literal is refused" 1 $? "secret-shaped literal starting 'gsk_abcd'"
git -C "$TMP" reset -q leak.js; rm -f "$TMP/leak.js"

printf -- '-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----\n' > "$TMP/notes.txt"
git -C "$TMP" add notes.txt && commit pem; check "private key block is refused" 1 $? "secret-shaped literal starting '-----BEG'"
git -C "$TMP" reset -q notes.txt; rm -f "$TMP/notes.txt"

echo "TOKEN=x" > "$TMP/.env"
git -C "$TMP" add -f .env && commit env; check ".env filename is refused" 1 $? "'.env' looks like a secret"
git -C "$TMP" reset -q .env; rm -f "$TMP/.env"

mkdir -p "$TMP/mobile/android"; head -c 64 /dev/zero > "$TMP/mobile/android/release.keystore"
git -C "$TMP" add -f mobile && commit ks; check "keystore filename is refused" 1 $? "release.keystore' looks like a secret"
git -C "$TMP" reset -q mobile; rm -rf "$TMP/mobile"

echo "TOKEN=" > "$TMP/.env.example"
git -C "$TMP" add .env.example && commit example; check ".env.example is allowed" 0 $?

printf 'apiKey: "AIzaPUBLICKEYFORTHETESTONLY0000000000000"\n' > "$TMP/config.js"
git -C "$TMP" add config.js && commit cfg; check "allowlisted public literal is allowed" 0 $?

printf 'apiKey: "AIzaNOTALLOWLISTED00000000000000000000000"\n' > "$TMP/config2.js"
git -C "$TMP" add config2.js && commit cfg2; check "non-allowlisted Google key is refused" 1 $? "secret-shaped literal starting 'AIzaNOTA'"
git -C "$TMP" reset -q config2.js; rm -f "$TMP/config2.js"

printf '{"sessionid": "abc"}\n' > "$TMP/scripts_session.json"
git -C "$TMP" add scripts_session.json && commit sess; check "Instagram session dump content is refused" 1 $? "secret-shaped literal starting '\"session'"
git -C "$TMP" reset -q scripts_session.json; rm -f "$TMP/scripts_session.json"

echo "fine" > "$TMP/after.txt"
git -C "$TMP" add after.txt && commit after; check "a later clean commit still passes" 0 $?

if [ "$fail" -eq 0 ]; then echo "secret guard: ALL GREEN"; else echo "secret guard: FAILURES ABOVE"; fi
exit "$fail"
