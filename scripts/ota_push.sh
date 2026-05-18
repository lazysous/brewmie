#!/usr/bin/env bash
# Brewmie OTA push, stub.
#
# Brewmie uses Capgo for OTA, not a Cloudflare Pages zip+manifest like
# Lazy Sous. The Capgo endpoint is wired into capacitor.config.ts at:
#   https://brewmie-ota.richbwilliamson.workers.dev
#
# The real push is a one-liner:
#
#   npm run build && npx @capgo/cli bundle upload --channel production
#
# This script exists so release.sh has a uniform interface. Drop in the
# real Capgo invocation once the Capgo account is provisioned and the
# API key lives in ~/.brewmie/capgo.env.
#
# See BUILD_AUTOMATION.md for the Capgo provisioning steps.

set -euo pipefail
VERSION="${1:?Usage: ./scripts/ota_push.sh <version>}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== Brewmie OTA push v${VERSION} ==="
echo
echo "Step 1: build the web bundle"
echo "  cd $REPO && npm run build"
echo
echo "Step 2: upload to Capgo"
echo "  npx @capgo/cli bundle upload --channel production"
echo
echo "Brewmie OTA is not yet wired into this script. Run the two commands"
echo "above manually for now, or edit ota_push.sh once Capgo is set up."
exit 1
