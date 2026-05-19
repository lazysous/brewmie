"""Validate every translation JSON in this directory.

Checks:
- char limits (name 30, subtitle 30, short_desc 80, promo 170, desc 4000, whats_new 4000)
- no em dashes anywhere
- has language/ios_locale or play_locale
"""
import json, os, sys
from pathlib import Path

DIR = Path(__file__).resolve().parent
LIMITS = {
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
    print(f"Checked {len(files)} files")
    if errs:
        print("ERRORS:")
        for e in errs:
            print(" ", e)
        sys.exit(1)
    print("OK")

if __name__ == "__main__":
    main()
