#!/usr/bin/env bash
# Proves a published OTA bundle is really there (audit 2026-10, brewmie-38 / lazysous-60).
# The URL must answer 200 with a zip Content-Type and exactly the expected byte size.
# The failure this exists to catch is a 200 text/html: the site's SPA fallback standing
# in for a zip that a plain deploy dropped while the manifest still advertised it.
#
# Usage: scripts/ota_smoke.sh <url> <expected_bytes> [attempts=20]   (6 s between attempts)
# Proven by scripts/test_ota_smoke.sh.
set -u
URL=${1:?usage: ota_smoke.sh <url> <expected_bytes> [attempts]}
EXPECT=${2:?usage: ota_smoke.sh <url> <expected_bytes> [attempts]}
ATTEMPTS=${3:-20}
code=000; ctype=none; size=0
for i in $(seq 1 "$ATTEMPTS"); do
    out=$(curl -s -o /dev/null -w '%{http_code} %{content_type} %{size_download}' --max-time 60 "$URL" 2>/dev/null || echo "000 none 0")
    code=${out%% *}; rest=${out#* }; ctype=${rest%% *}; size=${rest##* }
    if [ "$code" = "200" ] && printf '%s' "$ctype" | grep -q -i -E '^application/(zip|octet-stream|x-zip-compressed)' && [ "$size" = "$EXPECT" ]; then
        echo "OK $URL is a ${size}-byte zip"; exit 0
    fi
    [ "$i" -lt "$ATTEMPTS" ] && sleep 6
done
echo "FAIL $URL -> HTTP $code, $ctype, $size bytes (expected a ${EXPECT}-byte application/zip)" >&2
exit 1
