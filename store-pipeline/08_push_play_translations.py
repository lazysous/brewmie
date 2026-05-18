"""Push all Play translations from translations/*.json across every Play locale
the translations cover.

Uses fa.json content for fa-IR, fa-AE, fa-AF (regional Persian variants).
"""
import sys, json, os
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _auth import play_service, PACKAGE
from googleapiclient.errors import HttpError

DIR = str(Path(__file__).resolve().parent / "translations")

EXTRA_DEPLOYS = {
    "fa.json": ["fa-IR", "fa-AE", "fa-AF"],   # mirror fa to regional Persian variants
}


def load_translations():
    files = sorted(f for f in os.listdir(DIR) if f.endswith(".json") and not f.startswith("_"))
    out = []
    for fn in files:
        with open(os.path.join(DIR, fn)) as f:
            d = json.load(f)
        if d.get("play_locale"):
            out.append((fn, d, d["play_locale"]))
        for extra in EXTRA_DEPLOYS.get(fn, []):
            out.append((fn, d, extra))
    return out


def main():
    translations = load_translations()
    print(f"Will push {len(translations)} Play locale records")
    svc = play_service()
    edit = svc.edits().insert(packageName=PACKAGE, body={}).execute()
    edit_id = edit["id"]
    print(f"Edit id: {edit_id}")
    succ = 0
    failed = []
    try:
        for fn, t, locale in translations:
            body = {
                "language": locale,
                "title": t["name"],
                "shortDescription": t["short_description"],
                "fullDescription": t["description"],
                "video": "",
            }
            try:
                svc.edits().listings().update(
                    packageName=PACKAGE, editId=edit_id, language=locale, body=body
                ).execute()
                succ += 1
                if succ % 10 == 0:
                    print(f"  ... {succ} pushed")
            except HttpError as e:
                msg = e.content.decode()[:200] if hasattr(e, "content") else str(e)[:200]
                failed.append((locale, fn, msg))
                print(f"  FAIL {locale} ({fn}): {msg}")

        print(f"\nStaged {succ}/{len(translations)}")
        if failed:
            print(f"Failures: {len(failed)}")

        try:
            svc.edits().validate(packageName=PACKAGE, editId=edit_id).execute()
            print("Validation: OK")
        except HttpError as e:
            print(f"Validation FAILED: {e.content.decode()[:400]}")
            return

        commit = svc.edits().commit(packageName=PACKAGE, editId=edit_id).execute()
        print(f"COMMITTED: id={commit['id']}")
    except Exception:
        try:
            svc.edits().delete(packageName=PACKAGE, editId=edit_id).execute()
            print("Edit rolled back")
        except Exception:
            pass
        raise


if __name__ == "__main__":
    main()
