#!/usr/bin/env python3
"""
Create an App Store version, set localized "What's New" copy, attach the
just-uploaded build, and (optionally) submit for review.

Reads MARKETING_VERSION + CURRENT_PROJECT_VERSION from pbxproj. Pulls
per-locale `whats_new` strings from store-pipeline/translations/*.json.

Usage:
  scripts/submit_ios_release.py                      # create + localize + attach
  scripts/submit_ios_release.py --submit             # also submit for review
  scripts/submit_ios_release.py --wait               # poll until build is processed
  scripts/submit_ios_release.py --version 1.0.0      # override marketing version
  scripts/submit_ios_release.py --build 17           # override build number

Requires pyjwt + cryptography (`pip3 install --user pyjwt cryptography`).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "store-pipeline"))
from _auth import asc_request, APP_ID  # noqa: E402

REPO = Path(__file__).resolve().parent.parent
PBXPROJ = REPO / "ios" / "App" / "App.xcodeproj" / "project.pbxproj"
TRANSLATIONS = REPO / "store-pipeline" / "translations"
ENGLISH_COPY = (
    "First release. Pull a shot, log the time and yield, rate the taste. "
    "Brewmie tells you exactly what to change next, in your grinder's units. "
    "Built by baristas. No subscription."
)

EDITABLE_STATES = (
    "PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED",
    "WAITING_FOR_REVIEW", "METADATA_REJECTED", "INVALID_BINARY",
)


def info(msg: str): print(f"* {msg}")
def ok(msg: str): print(f"OK {msg}")
def warn(msg: str): print(f"! {msg}")
def die(msg: str, code: int = 1):
    print(f"FAIL {msg}", file=sys.stderr)
    sys.exit(code)


def read_pbxproj_versions() -> tuple[str, str]:
    text = PBXPROJ.read_text()
    mv = re.search(r"MARKETING_VERSION = ([\d.]+);", text)
    cv = re.search(r"CURRENT_PROJECT_VERSION = (\d+);", text)
    if not mv or not cv:
        die("Could not parse MARKETING_VERSION / CURRENT_PROJECT_VERSION from pbxproj")
    return mv.group(1), cv.group(1)


def find_or_create_version(version_str: str) -> str:
    resp = asc_request(
        "GET",
        f"/v1/apps/{APP_ID}/appStoreVersions"
        f"?fields[appStoreVersions]=versionString,appStoreState&limit=20",
    )
    for v in resp["data"]:
        if v["attributes"]["versionString"] == version_str:
            state = v["attributes"]["appStoreState"]
            if state in EDITABLE_STATES:
                ok(f"Reusing existing editable v{version_str} (state={state}, id={v['id']})")
                return v["id"]
            die(f"v{version_str} already exists in non-editable state: {state}")

    info(f"Creating new App Store version v{version_str}...")
    body = {
        "data": {
            "type": "appStoreVersions",
            "attributes": {"platform": "IOS", "versionString": version_str},
            "relationships": {"app": {"data": {"type": "apps", "id": APP_ID}}},
        }
    }
    created = asc_request("POST", "/v1/appStoreVersions", body)
    vid = created["data"]["id"]
    ok(f"Created v{version_str} (id={vid})")
    return vid


def find_build(version_str: str, build_str: str, wait: bool) -> str | None:
    interval = 30
    elapsed = 0
    max_wait = 1200  # 20 min
    while True:
        resp = asc_request(
            "GET",
            f"/v1/builds?filter[app]={APP_ID}"
            f"&filter[preReleaseVersion.version]={version_str}"
            f"&filter[version]={build_str}"
            f"&fields[builds]=version,processingState&limit=5",
        )
        for b in resp.get("data", []):
            state = b["attributes"]["processingState"]
            ver = b["attributes"]["version"]
            if ver != build_str:
                continue
            if state == "VALID":
                ok(f"Build {build_str} ready (id={b['id']})")
                return b["id"]
            if not wait:
                warn(f"Build {build_str} found but state={state}. Pass --wait to poll.")
                return None
            info(f"Build {build_str} state={state}, waiting {interval}s...")
            break
        else:
            if not wait:
                warn(f"Build {build_str} not yet visible to ASC API.")
                return None
            info(f"Build {build_str} not yet visible, waiting {interval}s...")

        time.sleep(interval)
        elapsed += interval
        if elapsed >= max_wait:
            die(f"Gave up waiting for build {build_str} after {max_wait}s")


def push_whats_new(version_id: str) -> None:
    locs_resp = asc_request(
        "GET",
        f"/v1/appStoreVersions/{version_id}/appStoreVersionLocalizations?limit=200",
    )
    by_locale = {l["attributes"]["locale"]: l["id"] for l in locs_resp["data"]}
    info(f"App Store version has {len(by_locale)} localizations attached")

    pushed = skipped = 0
    if TRANSLATIONS.exists():
        files = sorted(f for f in os.listdir(TRANSLATIONS)
                       if f.endswith(".json") and not f.startswith("_"))
    else:
        files = []
    for fn in files:
        try:
            data = json.loads((TRANSLATIONS / fn).read_text())
        except Exception as e:
            warn(f"{fn}: parse failed: {e}")
            continue
        locale = data.get("ios_locale")
        whats_new = data.get("whats_new")
        if not locale or not whats_new:
            skipped += 1
            continue
        loc_id = by_locale.get(locale)
        if not loc_id:
            skipped += 1
            continue
        try:
            asc_request("PATCH", f"/v1/appStoreVersionLocalizations/{loc_id}", {
                "data": {
                    "type": "appStoreVersionLocalizations",
                    "id": loc_id,
                    "attributes": {"whatsNew": whats_new},
                }
            })
            pushed += 1
        except Exception as e:
            warn(f"{locale}: {e}")
            skipped += 1

    # Backfill ANY locale without whatsNew with the English copy. Apple
    # refuses submission unless every attached localization has whatsNew.
    backfilled = 0
    for locale, loc_id in by_locale.items():
        cur = asc_request("GET", f"/v1/appStoreVersionLocalizations/{loc_id}")
        if not cur["data"]["attributes"].get("whatsNew"):
            try:
                asc_request("PATCH", f"/v1/appStoreVersionLocalizations/{loc_id}", {
                    "data": {
                        "type": "appStoreVersionLocalizations",
                        "id": loc_id,
                        "attributes": {"whatsNew": ENGLISH_COPY},
                    }
                })
                backfilled += 1
            except Exception as e:
                warn(f"{locale} backfill: {e}")

    ok(f"Pushed whatsNew to {pushed} locales (skipped: {skipped}, backfilled: {backfilled})")


def attach_build(version_id: str, build_id: str) -> None:
    info(f"Attaching build {build_id} to version {version_id}...")
    asc_request("PATCH", f"/v1/appStoreVersions/{version_id}/relationships/build", {
        "data": {"type": "builds", "id": build_id}
    })
    ok("Build attached")


def _ensure_encryption_flag(build_id: str) -> None:
    """Apple blocks submission unless usesNonExemptEncryption is explicitly
    set. HTTPS-only apps qualify for the standard encryption exemption."""
    cur = asc_request("GET", f"/v1/builds/{build_id}")
    if cur["data"]["attributes"].get("usesNonExemptEncryption") is None:
        asc_request("PATCH", f"/v1/builds/{build_id}", {
            "data": {"type": "builds", "id": build_id,
                     "attributes": {"usesNonExemptEncryption": False}}
        })
        ok("Set usesNonExemptEncryption=false on build")


def _find_or_create_review_submission() -> str:
    subs = asc_request(
        "GET",
        f"/v1/apps/{APP_ID}/reviewSubmissions"
        f"?filter[platform]=IOS&include=items&limit=10",
    )
    for s in subs.get("data", []):
        if s["attributes"].get("submittedDate"):
            continue
        if s["attributes"].get("state") in ("READY_FOR_REVIEW", "WAITING_FOR_REVIEW"):
            ok(f"Reusing existing in-flight reviewSubmission {s['id']}")
            return s["id"]
    info("Creating new reviewSubmission...")
    resp = asc_request("POST", "/v1/reviewSubmissions", {
        "data": {
            "type": "reviewSubmissions",
            "attributes": {"platform": "IOS"},
            "relationships": {"app": {"data": {"type": "apps", "id": APP_ID}}},
        }
    })
    return resp["data"]["id"]


def submit_for_review(version_id: str, build_id: str | None = None) -> None:
    info("Submitting for App Store review...")
    if build_id:
        _ensure_encryption_flag(build_id)

    sub_id = _find_or_create_review_submission()
    try:
        asc_request("POST", "/v1/reviewSubmissionItems", {
            "data": {
                "type": "reviewSubmissionItems",
                "relationships": {
                    "reviewSubmission": {"data": {"type": "reviewSubmissions", "id": sub_id}},
                    "appStoreVersion": {"data": {"type": "appStoreVersions", "id": version_id}},
                },
            }
        })
    except RuntimeError as e:
        if "409" not in str(e):
            raise
        info("Version already on submission; continuing.")

    asc_request("PATCH", f"/v1/reviewSubmissions/{sub_id}", {
        "data": {"type": "reviewSubmissions", "id": sub_id,
                 "attributes": {"submitted": True}}
    })
    ok(f"Submitted (reviewSubmission id={sub_id}). Apple review typically clears in 24h.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", help="MARKETING_VERSION override (e.g. 1.0.0)")
    ap.add_argument("--build", help="CURRENT_PROJECT_VERSION override (e.g. 17)")
    ap.add_argument("--submit", action="store_true", help="Also submit for App Store review")
    ap.add_argument("--wait", action="store_true",
                    help="Poll until build is VALID (up to 20 min)")
    ap.add_argument("--skip-build-attach", action="store_true",
                    help="Skip the build-attach step")
    args = ap.parse_args()

    if isinstance(APP_ID, str) and APP_ID.startswith("<"):
        die("APP_ID not set in store-pipeline/_auth.py. Fill it in once the ASC app record exists.")

    version, build = read_pbxproj_versions()
    if args.version: version = args.version
    if args.build: build = args.build
    info(f"Target: v{version} build {build}")

    version_id = find_or_create_version(version)

    build_id = None
    if not args.skip_build_attach:
        build_id = find_build(version, build, wait=args.wait)
        if build_id:
            attach_build(version_id, build_id)
        else:
            warn("Build not attached. Re-run with --wait once processing completes.")

    push_whats_new(version_id)

    if args.submit:
        submit_for_review(version_id, build_id=build_id)
    else:
        info("Skipping submission. Re-run with --submit when ready.")

    ok("Done.")


if __name__ == "__main__":
    main()
