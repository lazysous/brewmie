#!/usr/bin/env python3
"""
Build a signed AAB and upload it to Google Play via the Publishing API.

Usage:
  scripts/publish_play.py                  # uploads to "internal" track (default)
  scripts/publish_play.py --track beta
  scripts/publish_play.py --track production
  scripts/publish_play.py --no-bump        # don't auto-bump versionCode
  scripts/publish_play.py --notes "Bug fixes"

One-time setup:
  pip3 install --user google-auth google-api-python-client
  Create a service account in Google Cloud, grant it "Service Account User"
  role, link it in Play Console -> Users and permissions with at least
  "Release manager" + "Editing store settings" permissions, download the JSON
  key to ~/.brewmie/play-publish.json (chmod 600).

See BUILD_AUTOMATION.md for the full walkthrough.
"""
from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ANDROID = REPO / "android"
BUILD_GRADLE = ANDROID / "app" / "build.gradle"
AAB_PATH = ANDROID / "app" / "build" / "outputs" / "bundle" / "release" / "app-release.aab"
PACKAGE_NAME = "app.brewmie.brewmie"
SA_KEY = Path.home() / ".brewmie" / "play-publish.json"

# Android Studio's bundled JBR, so gradle can run without a system Java
JBR = "/Applications/Android Studio.app/Contents/jbr/Contents/Home"

DEFAULT_NOTES = "First release. Pull a shot, dial it in, no subscription."


def die(msg: str, code: int = 1) -> None:
    print(f"FAIL {msg}", file=sys.stderr)
    sys.exit(code)


def info(msg: str) -> None:
    print(f"* {msg}")


def ok(msg: str) -> None:
    print(f"OK {msg}")


def read_versions() -> tuple[int, str]:
    text = BUILD_GRADLE.read_text()
    code = re.search(r"versionCode\s+(\d+)", text)
    name = re.search(r'versionName\s+"([^"]+)"', text)
    if not code or not name:
        die("Could not parse versionCode/versionName from build.gradle")
    return int(code.group(1)), name.group(1)


def bump_version_code() -> int:
    text = BUILD_GRADLE.read_text()
    current = int(re.search(r"versionCode\s+(\d+)", text).group(1))
    new = current + 1
    text = re.sub(r"versionCode\s+\d+", f"versionCode {new}", text, count=1)
    BUILD_GRADLE.write_text(text)
    ok(f"versionCode {current} -> {new}")
    return new


def run(cmd: list[str], cwd: Path | None = None, env: dict | None = None) -> None:
    info(" ".join(cmd))
    env_full = {**os.environ, **(env or {})}
    r = subprocess.run(cmd, cwd=str(cwd) if cwd else None, env=env_full)
    if r.returncode != 0:
        die(f"command failed (exit {r.returncode}): {' '.join(cmd)}")


def cap_sync() -> None:
    run(["npx", "cap", "sync", "android"], cwd=REPO)


def build_aab() -> None:
    if AAB_PATH.exists():
        AAB_PATH.unlink()
    run(["./gradlew", "bundleRelease"], cwd=ANDROID, env={"JAVA_HOME": JBR})
    if not AAB_PATH.exists():
        die(f"AAB not produced at {AAB_PATH}")
    ok(f"AAB built ({AAB_PATH.stat().st_size // 1024} KB)")


def get_publish_client():
    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build
    except ImportError:
        die("Missing deps. Run: pip3 install --user google-auth google-api-python-client")

    if not SA_KEY.exists():
        die(f"Service account key not found at {SA_KEY}. See BUILD_AUTOMATION.md.")
    if oct(SA_KEY.stat().st_mode)[-3:] not in ("600", "400"):
        info(f"warning: {SA_KEY} is world-readable; chmod 600 recommended")

    creds = service_account.Credentials.from_service_account_file(
        str(SA_KEY),
        scopes=["https://www.googleapis.com/auth/androidpublisher"],
    )
    return build("androidpublisher", "v3", credentials=creds, cache_discovery=False)


def upload_and_release(track: str, notes: str | None) -> None:
    from googleapiclient.http import MediaFileUpload

    client = get_publish_client()
    edits = client.edits()

    info("Creating edit transaction...")
    edit = edits.insert(packageName=PACKAGE_NAME, body={}).execute()
    edit_id = edit["id"]

    info("Uploading AAB...")
    media = MediaFileUpload(str(AAB_PATH), mimetype="application/octet-stream", resumable=True)
    bundle = edits.bundles().upload(
        packageName=PACKAGE_NAME, editId=edit_id, media_body=media
    ).execute()
    version_code = bundle["versionCode"]
    ok(f"Uploaded bundle versionCode={version_code}, sha1={bundle.get('sha1', '?')[:12]}...")

    release_body = {
        "name": f"v{version_code}",
        "versionCodes": [str(version_code)],
        "status": "completed",
    }
    if notes:
        release_body["releaseNotes"] = [{"language": "en-US", "text": notes[:500]}]

    info(f"Assigning to track '{track}'...")
    edits.tracks().update(
        packageName=PACKAGE_NAME,
        editId=edit_id,
        track=track,
        body={"track": track, "releases": [release_body]},
    ).execute()

    info("Committing edit...")
    edits.commit(packageName=PACKAGE_NAME, editId=edit_id).execute()
    ok(f"Published to track '{track}' as version {version_code}.")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--track", default="internal",
                    choices=["internal", "alpha", "beta", "production"])
    ap.add_argument("--no-bump", action="store_true", help="Skip versionCode bump")
    ap.add_argument("--notes", default=DEFAULT_NOTES, help="Release notes (max 500 chars)")
    ap.add_argument("--skip-build", action="store_true", help="Use existing AAB")
    args = ap.parse_args()

    if not shutil.which("npx"):
        die("npx not found, Node is required for cap:sync")

    code_before, name = read_versions()
    info(f"Current version: {name} (versionCode {code_before})")

    if not args.skip_build:
        if not args.no_bump:
            bump_version_code()
        cap_sync()
        build_aab()
    elif not AAB_PATH.exists():
        die(f"--skip-build set but no AAB at {AAB_PATH}")

    t0 = time.time()
    upload_and_release(args.track, args.notes)
    ok(f"Done in {int(time.time() - t0)}s.")


if __name__ == "__main__":
    main()
