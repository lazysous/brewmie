#!/usr/bin/env python3
"""
Brewmie translation backfill.

Reads public/translations/en.json (the source of truth) and, for every other
locale file in the same directory, fills in any missing keys by machine-
translating from English.

Use sparingly — editorial copy doesn't survive auto-translation cleanly.
This is a stopgap for layout integrity, not a final localisation pass.

Usage:
  GOOGLE_TRANSLATE_API_KEY=xxx python3 scripts/translate.py
  GOOGLE_TRANSLATE_API_KEY=xxx python3 scripts/translate.py --only fr es

Requires:
  pip install google-cloud-translate
or pass --dry-run to see what would change without hitting the API.
"""
from __future__ import annotations
import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
TRANSLATIONS = ROOT / 'public' / 'translations'
EN_FILE = TRANSLATIONS / 'en.json'

# Keys that should NEVER be auto-translated — editorial voice that needs
# human or carefully prompted ML translation.
PROTECTED_KEYS = {
    'hero.brewFirst',
    'hero.statusNailed',
    'hero.statusClose',
    'hero.statusOneTweak',
    'hero.statusKeepGoing',
    'hero.statusReady',
    'hero.statusKeepPulling',
    'brew.brewButton',
    'brew.stop',
    'brew.saveShot',
    'premium.title',
    'footer.poweredBy',
    'footer.shotsGlobally',
}


def flatten(obj: Any, prefix: str = '') -> dict[str, str]:
    """Walk a nested dict, yielding dotted keys → leaf string values."""
    out: dict[str, str] = {}
    if isinstance(obj, dict):
        for k, v in obj.items():
            full = f'{prefix}.{k}' if prefix else k
            out.update(flatten(v, full))
    elif isinstance(obj, str):
        out[prefix] = obj
    return out


def set_nested(d: dict[str, Any], key: str, value: str) -> None:
    parts = key.split('.')
    cur = d
    for p in parts[:-1]:
        if p not in cur or not isinstance(cur[p], dict):
            cur[p] = {}
        cur = cur[p]
    cur[parts[-1]] = value


def translate_batch(texts: list[str], target: str, api_key: str) -> list[str]:
    """One batched call to Google Translate v2 REST."""
    import urllib.request
    import urllib.parse
    url = f'https://translation.googleapis.com/language/translate/v2?key={api_key}'
    payload = {
        'q': texts,
        'source': 'en',
        'target': target,
        'format': 'text',
    }
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(
        url, data=data,
        headers={'Content-Type': 'application/json'},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        resp = json.load(r)
    return [item['translatedText'] for item in resp['data']['translations']]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', nargs='+', help='locale codes to update; default: all')
    ap.add_argument('--dry-run', action='store_true', help='report missing keys; do not write')
    args = ap.parse_args()

    en = json.loads(EN_FILE.read_text())
    en_flat = flatten(en)

    api_key = os.environ.get('GOOGLE_TRANSLATE_API_KEY', '')
    if not args.dry_run and not api_key:
        print('GOOGLE_TRANSLATE_API_KEY not set. Use --dry-run to preview.', file=sys.stderr)
        return 1

    targets: list[Path] = []
    if args.only:
        for code in args.only:
            p = TRANSLATIONS / f'{code}.json'
            if p.exists():
                targets.append(p)
    else:
        targets = sorted(p for p in TRANSLATIONS.glob('*.json') if p.name != 'en.json')

    total_added = 0
    for path in targets:
        locale = path.stem
        existing = json.loads(path.read_text())
        ex_flat = flatten(existing)
        missing = [k for k in en_flat if k not in ex_flat and k not in PROTECTED_KEYS]
        if not missing:
            print(f'{locale:8} up to date')
            continue
        print(f'{locale:8} missing {len(missing):3d} keys', end='')
        if args.dry_run:
            print(' (dry-run)')
            continue
        # Batch in groups of 100 to stay under URL limits.
        batch_size = 100
        for i in range(0, len(missing), batch_size):
            chunk = missing[i:i + batch_size]
            source_texts = [en_flat[k] for k in chunk]
            translated = translate_batch(source_texts, locale, api_key)
            for k, v in zip(chunk, translated):
                set_nested(existing, k, v)
        path.write_text(json.dumps(existing, ensure_ascii=False, indent=2) + '\n')
        total_added += len(missing)
        print(f' — filled')

    print(f'\nDone. {total_added} keys added.' if not args.dry_run else '\nDry run complete.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
