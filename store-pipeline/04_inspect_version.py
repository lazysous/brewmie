"""Inspect localizations on an iOS App Store version and its AppInfo.

Usage:
  python3 store-pipeline/04_inspect_version.py <VERSION_ID> <APPINFO_ID>

Get the ids by running 03_create_ios_version.py first, or by listing
/v1/apps/<APP_ID>/appStoreVersions and /v1/apps/<APP_ID>/appInfos.
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _auth import asc_request


def show_appinfo(appinfo_id: str):
    print(f"=== AppInfoLocalizations on {appinfo_id} ===")
    locs = asc_request(
        "GET",
        f"/v1/appInfos/{appinfo_id}/appInfoLocalizations?limit=200"
        f"&fields[appInfoLocalizations]=locale,name,subtitle,privacyPolicyUrl",
    )
    for l in sorted(locs["data"], key=lambda x: x["attributes"]["locale"]):
        a = l["attributes"]
        print(f"  {a['locale']:8} id={l['id'][:8]}.. "
              f"name={a.get('name')!r:40} "
              f"subtitle={a.get('subtitle')!r}")


def show_version(version_id: str):
    print(f"\n=== AppStoreVersionLocalizations on {version_id} ===")
    locs = asc_request(
        "GET",
        f"/v1/appStoreVersions/{version_id}/appStoreVersionLocalizations?limit=200"
        f"&fields[appStoreVersionLocalizations]=locale,description,keywords,promotionalText,whatsNew",
    )
    for l in sorted(locs["data"], key=lambda x: x["attributes"]["locale"]):
        a = l["attributes"]
        desc = (a.get("description") or "")[:60]
        kw = a.get("keywords") or ""
        pt = a.get("promotionalText") or ""
        wn = a.get("whatsNew") or ""
        print(f"  {a['locale']:8} id={l['id'][:8]}.. "
              f"desc[0:60]={desc!r} "
              f"has_kw={bool(kw)} has_promo={bool(pt)} has_whatsNew={bool(wn)}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("Usage: 04_inspect_version.py <VERSION_ID> <APPINFO_ID>")
    show_appinfo(sys.argv[2])
    show_version(sys.argv[1])
