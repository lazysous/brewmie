"""Upload Brewmie iOS App Store screenshots to ASC.

Apple's flow per screenshot:
  1. POST /v1/appScreenshotSets (once per displayType per locale) — reserves
     a "set" container.
  2. For each image:
     a. POST /v1/appScreenshots — reserves a slot, returns upload operations.
     b. PUT bytes to each operation URL.
     c. PATCH /v1/appScreenshots/<id> with uploaded=True + checksum to commit.
  3. PATCH /v1/appScreenshotSets/<id>/relationships/appScreenshots to set
     display order.

Brewmie's primary locale is en-AU. Apple inherits screenshots to other
locales when those locales have no own screenshot set, so we only push
to en-AU.
"""
import os, sys, hashlib, urllib.request, ssl
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _auth import asc_request, APP_ID

PRIMARY_LOCALE = "en-AU"
DISPLAY_TYPE = "APP_IPHONE_65"  # 1290x2796 or 1284x2778
SCREENSHOT_DIR = Path("/Users/williamson/Desktop/BREWMIE IOS SCREENSHOTS")
ORDERED_FILES = [SCREENSHOT_DIR / f"{i}.png" for i in (1, 2, 3, 4, 5)]


def get_primary_version_localization_id() -> str:
    versions = asc_request("GET", f"/v1/apps/{APP_ID}/appStoreVersions?limit=10&filter[appStoreState]=PREPARE_FOR_SUBMISSION")
    version_id = versions["data"][0]["id"]
    locs = asc_request("GET", f"/v1/appStoreVersions/{version_id}/appStoreVersionLocalizations?limit=200&fields[appStoreVersionLocalizations]=locale")
    for l in locs["data"]:
        if l["attributes"]["locale"] == PRIMARY_LOCALE:
            return l["id"]
    raise RuntimeError(f"No {PRIMARY_LOCALE} localization found on version {version_id}")


def get_or_create_screenshot_set(loc_id: str) -> str:
    sets = asc_request("GET", f"/v1/appStoreVersionLocalizations/{loc_id}/appScreenshotSets?limit=50")
    for s in sets.get("data", []):
        if s["attributes"]["screenshotDisplayType"] == DISPLAY_TYPE:
            # Wipe any existing screenshots in this set so we have a clean slate.
            existing = asc_request("GET", f"/v1/appScreenshotSets/{s['id']}/appScreenshots?limit=20")
            for shot in existing.get("data", []):
                asc_request("DELETE", f"/v1/appScreenshots/{shot['id']}")
                print(f"  deleted existing screenshot {shot['id']}")
            return s["id"]
    r = asc_request("POST", "/v1/appScreenshotSets", {
        "data": {
            "type": "appScreenshotSets",
            "attributes": {"screenshotDisplayType": DISPLAY_TYPE},
            "relationships": {
                "appStoreVersionLocalization": {
                    "data": {"type": "appStoreVersionLocalizations", "id": loc_id}
                }
            }
        }
    })
    return r["data"]["id"]


def upload_screenshot(set_id: str, path: Path) -> str:
    size = path.stat().st_size
    with open(path, "rb") as f:
        blob = f.read()
    md5 = hashlib.md5(blob).hexdigest()

    r1 = asc_request("POST", "/v1/appScreenshots", {
        "data": {
            "type": "appScreenshots",
            "attributes": {"fileName": path.name, "fileSize": size},
            "relationships": {
                "appScreenshotSet": {"data": {"type": "appScreenshotSets", "id": set_id}}
            }
        }
    })
    ss_id = r1["data"]["id"]
    ops = r1["data"]["attributes"]["uploadOperations"]

    try:
        import certifi
        ctx = ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        ctx = ssl.create_default_context()

    for op in ops:
        headers = {h["name"]: h["value"] for h in op["requestHeaders"]}
        chunk = blob[op["offset"]:op["offset"] + op["length"]]
        req = urllib.request.Request(op["url"], data=chunk, method=op["method"], headers=headers)
        with urllib.request.urlopen(req, context=ctx) as resp:
            if resp.status not in (200, 201, 204):
                raise RuntimeError(f"upload PUT failed {resp.status}")

    asc_request("PATCH", f"/v1/appScreenshots/{ss_id}", {
        "data": {
            "type": "appScreenshots",
            "id": ss_id,
            "attributes": {"uploaded": True, "sourceFileChecksum": md5}
        }
    })
    return ss_id


def set_order(set_id: str, ordered_ids: list[str]):
    asc_request("PATCH", f"/v1/appScreenshotSets/{set_id}/relationships/appScreenshots", {
        "data": [{"type": "appScreenshots", "id": sid} for sid in ordered_ids]
    })


def main():
    for p in ORDERED_FILES:
        if not p.exists():
            sys.exit(f"Missing: {p}")
    loc_id = get_primary_version_localization_id()
    print(f"AppStoreVersionLocalization ({PRIMARY_LOCALE}) id={loc_id}")
    set_id = get_or_create_screenshot_set(loc_id)
    print(f"AppScreenshotSet ({DISPLAY_TYPE}) id={set_id}")

    ids = []
    for i, path in enumerate(ORDERED_FILES, 1):
        print(f"[{i}/{len(ORDERED_FILES)}] uploading {path.name} ({path.stat().st_size} bytes)")
        sid = upload_screenshot(set_id, path)
        ids.append(sid)
        print(f"  -> {sid}")

    print("Reordering set...")
    set_order(set_id, ids)
    print("Done. Apple may take a minute to process before screenshots appear in the UI.")


if __name__ == "__main__":
    main()
