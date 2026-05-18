"""Fix-up pass over translations/ after a bulk translation run.

- Caps Play short_description to 80 chars.
- Strips em dashes from every field (Brewmie voice rule).
- Logs any field that violates store limits so a human can rewrite.

Run after translate.py and before 02/08 push scripts.
"""
import json, os
from pathlib import Path

DIR = Path(__file__).resolve().parent / "translations"

LIMITS = {
    "name": 30,
    "subtitle": 30,
    "short_description": 80,
    "promotional_text": 170,
    "keywords": 100,
    "description": 4000,
    "whats_new": 500,
}


def strip_em(s: str) -> str:
    if not isinstance(s, str):
        return s
    return s.replace(" — ", ". ").replace("—", ", ")


def main():
    files = sorted(p for p in DIR.glob("*.json") if not p.name.startswith("_"))
    flagged = []
    for path in files:
        d = json.loads(path.read_text())
        changed = False
        for k in LIMITS:
            if k in d and isinstance(d[k], str):
                cleaned = strip_em(d[k])
                if cleaned != d[k]:
                    d[k] = cleaned
                    changed = True
                if len(d[k]) > LIMITS[k]:
                    flagged.append((path.name, k, len(d[k]), LIMITS[k]))
        if changed:
            path.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n")

    print(f"Scanned {len(files)} translation files")
    if flagged:
        print(f"\n{len(flagged)} overlength fields need a human rewrite:")
        for fn, k, got, lim in flagged:
            print(f"  {fn:18} {k:18} {got} > {lim}")
    else:
        print("All fields within limits.")


if __name__ == "__main__":
    main()
