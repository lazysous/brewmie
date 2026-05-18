"""Push English iOS copy (en-AU master + en-GB, en-US fallbacks) to a version.

Usage:
  python3 store-pipeline/05_push_ios_english.py <VERSION_ID> <APPINFO_ID>
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _auth import asc_request
from english_copy import (
    TITLE, IOS_SUBTITLE, IOS_PROMO_TEXT, IOS_KEYWORDS,
    DESCRIPTION, WHATS_NEW,
)

NEW_LOCALES = ["en-GB", "en-US"]


def get_appinfo_loc(appinfo_id: str, locale: str):
    locs = asc_request("GET", f"/v1/appInfos/{appinfo_id}/appInfoLocalizations?limit=200")
    for l in locs["data"]:
        if l["attributes"]["locale"] == locale:
            return l
    return None


def get_version_loc(version_id: str, locale: str):
    locs = asc_request("GET", f"/v1/appStoreVersions/{version_id}/appStoreVersionLocalizations?limit=200")
    for l in locs["data"]:
        if l["attributes"]["locale"] == locale:
            return l
    return None


def patch_appinfo_loc(loc_id: str, name: str, subtitle: str):
    return asc_request("PATCH", f"/v1/appInfoLocalizations/{loc_id}", {
        "data": {"type": "appInfoLocalizations", "id": loc_id,
                 "attributes": {"name": name, "subtitle": subtitle}},
    })


def patch_version_loc(loc_id: str, description: str, keywords: str,
                      promotional_text: str, whats_new: str):
    return asc_request("PATCH", f"/v1/appStoreVersionLocalizations/{loc_id}", {
        "data": {"type": "appStoreVersionLocalizations", "id": loc_id,
                 "attributes": {"description": description, "keywords": keywords,
                                "promotionalText": promotional_text,
                                "whatsNew": whats_new}},
    })


def create_appinfo_loc(appinfo_id: str, locale: str, name: str, subtitle: str):
    return asc_request("POST", "/v1/appInfoLocalizations", {
        "data": {"type": "appInfoLocalizations",
                 "attributes": {"locale": locale, "name": name, "subtitle": subtitle},
                 "relationships": {
                     "appInfo": {"data": {"type": "appInfos", "id": appinfo_id}},
                 }},
    })


def create_version_loc(version_id: str, locale: str, description: str, keywords: str,
                       promotional_text: str, whats_new: str):
    return asc_request("POST", "/v1/appStoreVersionLocalizations", {
        "data": {"type": "appStoreVersionLocalizations",
                 "attributes": {"locale": locale, "description": description,
                                "keywords": keywords, "promotionalText": promotional_text,
                                "whatsNew": whats_new},
                 "relationships": {
                     "appStoreVersion": {"data": {"type": "appStoreVersions", "id": version_id}},
                 }},
    })


def main(version_id: str, appinfo_id: str):
    # 1. Update en-AU AppInfoLocalization (subtitle change)
    print("Updating en-AU AppInfoLocalization...")
    info = get_appinfo_loc(appinfo_id, "en-AU")
    if info:
        print(f"  before: subtitle={info['attributes']['subtitle']!r}")
        patch_appinfo_loc(info["id"], TITLE, IOS_SUBTITLE)
    else:
        create_appinfo_loc(appinfo_id, "en-AU", TITLE, IOS_SUBTITLE)
    print(f"  after:  subtitle={IOS_SUBTITLE!r}")

    # 2. Update en-AU AppStoreVersionLocalization
    print("\nUpdating en-AU AppStoreVersionLocalization...")
    ver = get_version_loc(version_id, "en-AU")
    if ver:
        print(f"  before: description[0:80]={ver['attributes'].get('description','')[:80]!r}")
        patch_version_loc(ver["id"], DESCRIPTION, IOS_KEYWORDS, IOS_PROMO_TEXT, WHATS_NEW)
    else:
        create_version_loc(version_id, "en-AU", DESCRIPTION, IOS_KEYWORDS, IOS_PROMO_TEXT, WHATS_NEW)
    print(f"  after:  description set ({len(DESCRIPTION)} chars), "
          f"keywords set ({len(IOS_KEYWORDS)} chars), "
          f"promo set ({len(IOS_PROMO_TEXT)} chars), whatsNew set")

    # 3. Add fallback locales with English content
    for locale in NEW_LOCALES:
        print(f"\nAdding {locale}...")
        existing_info = get_appinfo_loc(appinfo_id, locale)
        if existing_info:
            print(f"  AppInfoLocalization already exists; patching")
            patch_appinfo_loc(existing_info["id"], TITLE, IOS_SUBTITLE)
        else:
            create_appinfo_loc(appinfo_id, locale, TITLE, IOS_SUBTITLE)
            print(f"  AppInfoLocalization created (name + subtitle)")

        existing_ver = get_version_loc(version_id, locale)
        if existing_ver:
            print(f"  AppStoreVersionLocalization already exists; patching")
            patch_version_loc(existing_ver["id"], DESCRIPTION, IOS_KEYWORDS, IOS_PROMO_TEXT, WHATS_NEW)
        else:
            create_version_loc(version_id, locale, DESCRIPTION, IOS_KEYWORDS, IOS_PROMO_TEXT, WHATS_NEW)
            print(f"  AppStoreVersionLocalization created (desc + kw + promo + whatsNew)")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("Usage: 05_push_ios_english.py <VERSION_ID> <APPINFO_ID>")
    main(sys.argv[1], sys.argv[2])
