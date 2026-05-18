"""Push all iOS translations from translations/*.json to a version.

Updates AppInfoLocalization (name, subtitle) and AppStoreVersionLocalization
(description, keywords, promotionalText, whatsNew) for each locale.

Usage:
  python3 store-pipeline/07_push_ios_translations.py <VERSION_ID> <APPINFO_ID>
"""
import sys, json, os
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _auth import asc_request

DIR = str(Path(__file__).resolve().parent / "translations")


def load_translations():
    files = sorted(f for f in os.listdir(DIR) if f.endswith(".json") and not f.startswith("_"))
    out = []
    for fn in files:
        with open(os.path.join(DIR, fn)) as f:
            d = json.load(f)
        if d.get("ios_locale"):
            out.append(d)
    return out


def index_existing(version_id: str, appinfo_id: str):
    info = asc_request("GET", f"/v1/appInfos/{appinfo_id}/appInfoLocalizations?limit=200")
    ver = asc_request("GET", f"/v1/appStoreVersions/{version_id}/appStoreVersionLocalizations?limit=200")
    info_by_locale = {l["attributes"]["locale"]: l["id"] for l in info["data"]}
    ver_by_locale = {l["attributes"]["locale"]: l["id"] for l in ver["data"]}
    return info_by_locale, ver_by_locale


def push_one(t, info_by_locale, ver_by_locale):
    locale = t["ios_locale"]
    info_id = info_by_locale.get(locale)
    ver_id = ver_by_locale.get(locale)
    if not info_id or not ver_id:
        return f"SKIP {locale}: locale not deployed (info={bool(info_id)}, ver={bool(ver_id)})"

    if t.get("name") and t.get("subtitle"):
        asc_request("PATCH", f"/v1/appInfoLocalizations/{info_id}", {
            "data": {"type": "appInfoLocalizations", "id": info_id,
                     "attributes": {"name": t["name"], "subtitle": t["subtitle"]}},
        })

    attrs = {"description": t["description"]}
    if t.get("keywords"): attrs["keywords"] = t["keywords"]
    if t.get("promotional_text"): attrs["promotionalText"] = t["promotional_text"]
    if t.get("whats_new"): attrs["whatsNew"] = t["whats_new"]

    asc_request("PATCH", f"/v1/appStoreVersionLocalizations/{ver_id}", {
        "data": {"type": "appStoreVersionLocalizations", "id": ver_id, "attributes": attrs},
    })
    return f"OK   {locale}: pushed"


def main(version_id: str, appinfo_id: str):
    translations = load_translations()
    print(f"Loaded {len(translations)} iOS translations")
    info_map, ver_map = index_existing(version_id, appinfo_id)
    print(f"Existing: {len(info_map)} appInfo, {len(ver_map)} version locs")
    succ = 0
    for t in translations:
        try:
            result = push_one(t, info_map, ver_map)
            print(f"  {result}")
            if result.startswith("OK"):
                succ += 1
        except Exception as e:
            print(f"  ERR  {t['ios_locale']}: {str(e)[:200]}")
    print(f"\nDone: {succ}/{len(translations)} pushed")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("Usage: 07_push_ios_translations.py <VERSION_ID> <APPINFO_ID>")
    main(sys.argv[1], sys.argv[2])
