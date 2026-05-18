"""Read all existing localized metadata from both stores. Save as voice reference.

Usage:
  python3 store-pipeline/06_read_voice_reference.py <VERSION_ID> <APPINFO_ID>
"""
import sys, json, os
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _auth import asc_request, play_service, PACKAGE

OUT = Path(__file__).resolve().parent / "translations"


def read_ios(version_id: str, appinfo_id: str):
    info = asc_request("GET", f"/v1/appInfos/{appinfo_id}/appInfoLocalizations?limit=200")
    ver = asc_request("GET", f"/v1/appStoreVersions/{version_id}/appStoreVersionLocalizations?limit=200")
    info_by_locale = {l["attributes"]["locale"]: l for l in info["data"]}
    ver_by_locale = {l["attributes"]["locale"]: l for l in ver["data"]}
    out = {}
    for locale in info_by_locale:
        a = info_by_locale[locale]["attributes"]
        b = ver_by_locale.get(locale, {}).get("attributes", {}) or {}
        out[locale] = {
            "info_id": info_by_locale[locale]["id"],
            "version_id": ver_by_locale[locale]["id"] if locale in ver_by_locale else None,
            "name": a.get("name"),
            "subtitle": a.get("subtitle"),
            "privacyPolicyUrl": a.get("privacyPolicyUrl"),
            "description": b.get("description"),
            "keywords": b.get("keywords"),
            "promotionalText": b.get("promotionalText"),
            "whatsNew": b.get("whatsNew"),
            "supportUrl": b.get("supportUrl"),
            "marketingUrl": b.get("marketingUrl"),
        }
    return out


def read_play():
    svc = play_service()
    edit = svc.edits().insert(packageName=PACKAGE, body={}).execute()
    try:
        listings = svc.edits().listings().list(
            packageName=PACKAGE, editId=edit["id"]
        ).execute().get("listings", [])
        out = {}
        for l in listings:
            out[l["language"]] = {
                "title": l.get("title"),
                "shortDescription": l.get("shortDescription"),
                "fullDescription": l.get("fullDescription"),
                "video": l.get("video"),
            }
        return out
    finally:
        svc.edits().delete(packageName=PACKAGE, editId=edit["id"]).execute()


def main(version_id: str, appinfo_id: str):
    OUT.mkdir(exist_ok=True)
    ios = read_ios(version_id, appinfo_id)
    play = read_play()
    out_path = OUT / "_voice_reference.json"
    out_path.write_text(json.dumps({"ios": ios, "play": play}, ensure_ascii=False, indent=2))
    print(f"iOS locales: {len(ios)}")
    print(f"Play locales: {len(play)}")
    print(f"Saved to {out_path}")
    print(f"Total chars in file: {os.path.getsize(out_path):,}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("Usage: 06_read_voice_reference.py <VERSION_ID> <APPINFO_ID>")
    main(sys.argv[1], sys.argv[2])
