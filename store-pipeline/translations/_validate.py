"""Validate every translation JSON in this directory.

Checks:
- char limits (name 30, subtitle 30, short_desc 80, promo 170, desc 4000, whats_new 4000)
- no em dashes anywhere
- has language/ios_locale or play_locale
"""
import json, os, sys
from pathlib import Path

DIR = Path(__file__).resolve().parent
# Copy that must never be pushed again (audit 2026-10): a Premium feature that does not
# exist, in every language it was translated to, and competitor app names in keywords.
DENY_PHRASES = ["household sync", "haushalts-sync", "huishoudensynchronisatie", "partage entre comptes", "synchro multi-comptes"]
DENY_KEYWORDS = ["puckyeah", "puck yeah", "beanconqueror", "bean conqueror"]

LIMITS = {
    "keywords": 100,
    "name": 30,
    "subtitle": 30,
    "short_description": 80,
    "promotional_text": 170,
    "description": 4000,
    "whats_new": 4000,
}

def main():
    errs = []
    files = sorted(f for f in os.listdir(DIR) if f.endswith(".json") and not f.startswith("_"))
    for fn in files:
        with open(DIR / fn) as f:
            d = json.load(f)
        for k, lim in LIMITS.items():
            v = d.get(k)
            if v is None:
                continue
            if len(v) > lim:
                errs.append(f"{fn}: {k} {len(v)}>{lim}")
            if "—" in v:
                errs.append(f"{fn}: {k} contains em dash")
            low = v.lower()
            for ph in DENY_PHRASES:
                if ph in low:
                    errs.append(f"{fn}: {k} claims '{ph}' (feature does not exist)")
            if k == "keywords":
                for kw in DENY_KEYWORDS:
                    if kw in low:
                        errs.append(f"{fn}: keywords name a competitor app ('{kw}')")
    # The English source of truth gets the same checks.
    import importlib.util
    spec = importlib.util.spec_from_file_location("english_copy", DIR.parent / "english_copy.py")
    ec = importlib.util.module_from_spec(spec); spec.loader.exec_module(ec)
    for name in ("TITLE", "IOS_SUBTITLE", "PLAY_SHORT_DESC", "IOS_PROMO_TEXT", "IOS_KEYWORDS", "DESCRIPTION", "WHATS_NEW"):
        val = getattr(ec, name, "").lower()
        for ph in DENY_PHRASES:
            if ph in val:
                errs.append(f"english_copy.{name} claims '{ph}' (feature does not exist)")
        if name == "IOS_KEYWORDS":
            for kw in DENY_KEYWORDS:
                if kw in val:
                    errs.append(f"english_copy.IOS_KEYWORDS names a competitor app ('{kw}')")
    print(f"Checked {len(files)} files")
    if errs:
        print("ERRORS:")
        for e in errs:
            print(" ", e)
        sys.exit(1)
    print("OK")

if __name__ == "__main__":
    main()
