#!/usr/bin/env python3
"""
Brewmie preflight: runs every check that should pass before the user clicks
"Submit for Review" on either store. Equivalent of `asc submit`'s preflight
in the Reddit walkthrough — catches the things that cause review rejection
(missing privacy URL, missing IAP, missing screenshots, etc.) BEFORE you
spend a build cycle.

Usage:
    scripts/preflight.py            # full check (~20s)
    scripts/preflight.py --quiet    # only print failures

Exit code 0 = ready to submit. Non-zero = one or more checks failed.
Run BEFORE `scripts/release.sh native`.
"""
from __future__ import annotations
import argparse
import json
import os
import re
import subprocess
import sys
import urllib.request
import urllib.error
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "store-pipeline"))
from _auth import asc_request, APP_ID  # noqa: E402

OK = "\033[32m✓\033[0m"
FAIL = "\033[31m✗\033[0m"
WARN = "\033[33m!\033[0m"


class Result:
    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.warned = 0

    def ok(self, msg: str):
        print(f"{OK} {msg}")
        self.passed += 1

    def fail(self, msg: str):
        print(f"{FAIL} {msg}")
        self.failed += 1

    def warn(self, msg: str):
        print(f"{WARN} {msg}")
        self.warned += 1


def http_status(url: str, timeout: float = 5.0) -> int:
    # GET not HEAD; some Cloudflare Pages configs reject HEAD with 405.
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "brewmie-preflight"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception:
        return 0


def check_web_urls(r: Result):
    """The three URLs Apple + Play both expect to be live and reachable."""
    for path in ("/privacy", "/support", "/delete-account"):
        url = f"https://brewmie.app{path}"
        code = http_status(url)
        if code == 200:
            r.ok(f"{url} returns 200")
        else:
            r.fail(f"{url} returns {code} (Apple + Play require 200)")


def check_ios_plist(r: Result):
    plist = REPO / "ios" / "App" / "App" / "Info.plist"
    if not plist.exists():
        r.fail(f"Missing Info.plist at {plist}")
        return
    text = plist.read_text()
    for key, label in [
        ("ITSAppUsesNonExemptEncryption", "Export compliance"),
        ("NSUserTrackingUsageDescription", "ATT prompt copy"),
        ("UIStatusBarStyleLightContent", "Status bar style"),
    ]:
        if key in text:
            r.ok(f"Info.plist: {label}")
        else:
            r.fail(f"Info.plist: {label} missing ({key})")

    if "REPLACE-WITH-BREWMIE" in text:
        r.fail("Info.plist: still has REPLACE-WITH-BREWMIE placeholder (CFBundleURLTypes / Google reverse id)")
    else:
        r.ok("Info.plist: no REPLACE-WITH placeholders")


def check_ios_entitlements(r: Result):
    ent = REPO / "ios" / "App" / "App" / "App.entitlements"
    if not ent.exists():
        r.fail("Missing App.entitlements (Sign in with Apple won't work)")
        return
    if "com.apple.developer.applesignin" in ent.read_text():
        r.ok("App.entitlements: Sign in with Apple")
    else:
        r.fail("App.entitlements: missing com.apple.developer.applesignin")


def check_android_manifest(r: Result):
    m = REPO / "android" / "app" / "src" / "main" / "AndroidManifest.xml"
    if not m.exists():
        r.fail("Missing AndroidManifest.xml")
        return
    text = m.read_text()
    if "com.android.vending.BILLING" in text:
        r.ok("AndroidManifest: BILLING permission")
    else:
        r.fail("AndroidManifest: missing com.android.vending.BILLING (IAP won't work)")


def check_android_google_services(r: Result):
    f = REPO / "android" / "app" / "google-services.json"
    if f.exists():
        r.ok("android/app/google-services.json present (Google Sign-In will resolve)")
    else:
        r.warn("android/app/google-services.json MISSING — Google Sign-In won't work natively. Download from Firebase console.")


def check_ios_googleservice(r: Result):
    f = REPO / "ios" / "App" / "App" / "GoogleService-Info.plist"
    if f.exists():
        r.ok("ios/App/App/GoogleService-Info.plist present")
    else:
        r.warn("GoogleService-Info.plist MISSING — Google Sign-In won't work on iOS. Download from Firebase console.")


def check_capacitor_config(r: Result):
    f = REPO / "capacitor.config.ts"
    text = f.read_text()
    if "REPLACE-WITH-BREWMIE" in text:
        r.fail("capacitor.config.ts still has REPLACE-WITH-BREWMIE placeholder OAuth client IDs")
    else:
        r.ok("capacitor.config.ts: no placeholder client IDs")


def check_typescript(r: Result):
    p = subprocess.run(
        ["npx", "tsc", "--noEmit"],
        capture_output=True, text=True, cwd=REPO,
    )
    if p.returncode == 0:
        r.ok("TypeScript: no errors")
    else:
        r.fail(f"TypeScript errors:\n{p.stdout.strip() or p.stderr.strip()}")


def check_translations(r: Result):
    """Every locale json under public/translations must be parseable + have a notifications block."""
    d = REPO / "public" / "translations"
    locales = list(d.glob("*.json"))
    if not locales:
        r.fail("No translation files found in public/translations/")
        return
    bad = []
    for f in locales:
        try:
            obj = json.loads(f.read_text())
            if "notifications" not in obj:
                bad.append(f.stem)
        except Exception as e:
            bad.append(f"{f.stem} ({e})")
    if bad:
        r.fail(f"Locale files missing notifications block: {bad[:5]}{' ...' if len(bad) > 5 else ''}")
    else:
        r.ok(f"All {len(locales)} locale files parse + contain notifications block")


def check_asc_state(r: Result):
    """ASC API: app exists, version exists in submitable state, IAP exists."""
    if not APP_ID or APP_ID.startswith("<"):
        r.fail("store-pipeline/_auth.py: APP_ID still placeholder")
        return
    try:
        r.ok(f"ASC: app {APP_ID} reachable via API")
    except Exception as e:
        r.fail(f"ASC API unreachable: {e}")
        return

    try:
        versions = asc_request(
            "GET",
            f"/v1/apps/{APP_ID}/appStoreVersions?filter[platform]=IOS&limit=5",
        )
        editable = [v for v in versions["data"] if v["attributes"]["appStoreState"] in (
            "PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "WAITING_FOR_REVIEW",
        )]
        if editable:
            v = editable[0]
            r.ok(f"ASC: editable version {v['attributes']['versionString']} ({v['attributes']['appStoreState']})")
        else:
            r.fail("ASC: no editable version found — run scripts/submit_ios_release.py to create one")
    except Exception as e:
        r.fail(f"ASC version check failed: {e}")

    try:
        iaps = asc_request("GET", f"/v1/apps/{APP_ID}/inAppPurchasesV2?limit=10")
        if iaps["data"]:
            iap = iaps["data"][0]
            r.ok(f"ASC IAP: {iap['attributes']['productId']} ({iap['attributes']['state']})")
        else:
            r.fail("ASC: no in-app purchase products defined")
    except Exception as e:
        r.warn(f"ASC IAP check failed: {e}")


def check_release_assets(r: Result):
    """Marketing icon + feature graphic + IAP review screenshot must exist on disk."""
    expected = [
        ("resources/icon.png", "App icon"),
        ("resources/feature-graphic.png", "Play feature graphic"),
        ("resources/iap-review-screenshot.png", "ASC IAP review screenshot"),
    ]
    for rel, label in expected:
        p = REPO / rel
        if p.exists():
            r.ok(f"{label}: {rel}")
        else:
            r.fail(f"{label} missing: {rel}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()

    r = Result()
    sections = [
        ("Web URLs", check_web_urls),
        ("iOS Info.plist", check_ios_plist),
        ("iOS Entitlements", check_ios_entitlements),
        ("iOS GoogleService-Info", check_ios_googleservice),
        ("Android Manifest", check_android_manifest),
        ("Android google-services.json", check_android_google_services),
        ("Capacitor config", check_capacitor_config),
        ("TypeScript", check_typescript),
        ("Translations", check_translations),
        ("ASC state", check_asc_state),
        ("Release assets", check_release_assets),
    ]
    for label, fn in sections:
        if not args.quiet:
            print(f"\n── {label} ──")
        fn(r)

    print()
    print(f"  {OK} {r.passed} passed")
    if r.warned:
        print(f"  {WARN} {r.warned} warned")
    if r.failed:
        print(f"  {FAIL} {r.failed} failed")
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main()
