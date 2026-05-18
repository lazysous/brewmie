"""Create the initial iOS App Store version (PREPARE_FOR_SUBMISSION, no build).
Idempotent: returns the existing version if one is already editable.

Pass --version to override the default 1.0.0.
"""
import sys, argparse
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _auth import asc_request, APP_ID

EDITABLE_STATES = (
    "PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED",
    "METADATA_REJECTED", "WAITING_FOR_REVIEW", "INVALID_BINARY",
)


def find_existing_editable(target_version: str):
    versions = asc_request(
        "GET",
        f"/v1/apps/{APP_ID}/appStoreVersions"
        f"?fields[appStoreVersions]=versionString,appStoreState&limit=10",
    )
    for v in versions["data"]:
        if v["attributes"]["versionString"] == target_version:
            return v
        if v["attributes"]["appStoreState"] in EDITABLE_STATES:
            print(f"  Found editable version {v['attributes']['versionString']} "
                  f"state={v['attributes']['appStoreState']}")
    return None


def create_version(target_version: str):
    body = {
        "data": {
            "type": "appStoreVersions",
            "attributes": {
                "platform": "IOS",
                "versionString": target_version,
            },
            "relationships": {
                "app": {"data": {"type": "apps", "id": APP_ID}},
            },
        }
    }
    return asc_request("POST", "/v1/appStoreVersions", body)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", default="1.0.0")
    args = ap.parse_args()

    if APP_ID.startswith("<"):
        sys.exit("APP_ID not set in _auth.py. Fill it in once the ASC app record exists.")

    existing = find_existing_editable(args.version)
    if existing:
        print(f"v{existing['attributes']['versionString']} already exists "
              f"(id={existing['id']}, state={existing['attributes']['appStoreState']}). "
              f"Reusing.")
        v = existing
    else:
        print(f"Creating v{args.version}...")
        result = create_version(args.version)
        v = result["data"]
        print(f"Created: id={v['id']} state={v['attributes']['appStoreState']}")

    # Also report the AppInfo associated with the editable record
    app_infos = asc_request("GET", f"/v1/apps/{APP_ID}/appInfos")
    for ai in app_infos["data"]:
        print(f"AppInfo {ai['id']} state={ai['attributes']['appStoreState']}")
    return v


if __name__ == "__main__":
    main()
