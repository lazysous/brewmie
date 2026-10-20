#!/usr/bin/env bash
# Characterisation test for scripts/ota_smoke.sh: serves a zip and an HTML page from a
# throwaway local server and proves the check passes only for the zip at its true size.
set -u
cd "$(dirname "$0")/.."
TMP=$(mktemp -d); trap 'rm -rf "$TMP"; [ -n "${PID:-}" ] && kill "$PID" 2>/dev/null' EXIT
printf 'hello' > "$TMP/a.txt"; (cd "$TMP" && zip -q bundle.zip a.txt); printf '<!doctype html><title>fallback</title>' > "$TMP/index.html"
PORT=$((20000 + RANDOM % 20000))
(cd "$TMP" && python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1) & PID=$!
for _ in $(seq 1 30); do curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break; sleep 0.2; done
ZIP_BYTES=$(wc -c < "$TMP/bundle.zip" | tr -d ' '); HTML_BYTES=$(wc -c < "$TMP/index.html" | tr -d ' ')
fail=0
check() { if [ "$2" = "$3" ]; then echo "  ok   $1"; else echo "  FAIL $1 (expected exit $2, got $3)"; fail=1; fi; }
bash scripts/ota_smoke.sh "http://127.0.0.1:$PORT/bundle.zip" "$ZIP_BYTES" 1 >/dev/null 2>&1; check "real zip at its true size passes" 0 $?
bash scripts/ota_smoke.sh "http://127.0.0.1:$PORT/bundle.zip" $((ZIP_BYTES + 1)) 1 >/dev/null 2>&1; check "zip with the wrong size fails" 1 $?
bash scripts/ota_smoke.sh "http://127.0.0.1:$PORT/index.html" "$HTML_BYTES" 1 >/dev/null 2>&1; check "200 text/html (SPA fallback) fails even at matching size" 1 $?
bash scripts/ota_smoke.sh "http://127.0.0.1:$PORT/missing.zip" 10 1 >/dev/null 2>&1; check "404 fails" 1 $?
[ $fail -eq 0 ] && echo "ota smoke: ALL GREEN" || echo "ota smoke: FAILURES ABOVE"; exit $fail
