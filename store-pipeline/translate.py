"""Generate per-locale store-listing JSON files for Brewmie.

Reads english_copy.py + locale_map.py. For each language in LOCALE_MAP,
writes translations/<key>.json with these fields:

  {
    "language":         human label (e.g. "French (France)"),
    "ios_locale":       Apple code or null,
    "play_locale":      Play code or null,
    "name":             title, translated, <= 30 chars
    "subtitle":         iOS subtitle, translated, <= 30 chars
    "short_description":Play short, translated, <= 80 chars
    "promotional_text": iOS promo, translated, <= 170 chars
    "keywords":         iOS keywords, translated, <= 100 chars, comma-separated
    "description":      long body, translated, <= 4000 chars
    "whats_new":        release notes, translated, <= 500 chars
  }

Uses the Anthropic API with prompt caching so the english_copy + style
guide can be re-used cheaply across locales.

This script costs money to run. Do NOT invoke without explicit user
consent on a cost estimate. Expected cost (single full pass over the
LOCALE_MAP, Sonnet 4.7, with caching): ~$3 to $5.

Usage:
  ANTHROPIC_API_KEY=sk-ant-... python3 store-pipeline/translate.py
  python3 store-pipeline/translate.py --only ja de fr
  python3 store-pipeline/translate.py --dry-run

A locale is skipped if translations/<key>.json already exists, unless
--force is passed.
"""
from __future__ import annotations
import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from english_copy import (
    TITLE, IOS_SUBTITLE, PLAY_SHORT_DESC, IOS_PROMO_TEXT,
    IOS_KEYWORDS, DESCRIPTION, WHATS_NEW,
)
from locale_map import LOCALE_MAP

OUT_DIR = Path(__file__).resolve().parent / "translations"

STYLE_GUIDE = """You are translating App Store and Google Play copy for Brewmie, an
espresso-shot dial-in app for home baristas.

Voice rules:
- No em dashes. Use periods or commas instead.
- No marketing slop. Direct, plain language. The English source is the
  benchmark, do not get flowery in translation.
- Keep CAPS section headers (PULL, RATE, DIAL IN, COACH, GEAR, INSIGHTS,
  PRIVACY, NOW FOR EVERY HOME BARISTA, PRICING) translated but still in
  caps.
- "Brewmie" stays as Brewmie in every language. Do not transliterate.
- "Premium", "Free", percentage values, gram values, and brand model
  names (Gaggia Classic, Linea Mini) stay as English.
- Character limits are strict. Truncate or rephrase to fit:
    name: 30, subtitle: 30, short_description: 80, promotional_text: 170,
    keywords: 100 (comma-separated, no spaces), description: 4000,
    whats_new: 500.
- Keywords field: produce comma-separated single-word search terms in the
  target language, matching local barista vocabulary. No duplicates of
  the title/subtitle keywords.

Return ONLY a JSON object with the eight content fields. No prose."""


def build_prompt(language: str) -> str:
    return f"""Translate the following Brewmie store copy into {language}.

SOURCE:
title: {TITLE}
subtitle: {IOS_SUBTITLE}
short_description: {PLAY_SHORT_DESC}
promotional_text: {IOS_PROMO_TEXT}
keywords: {IOS_KEYWORDS}
whats_new: {WHATS_NEW}

description (long body):
---
{DESCRIPTION}
---

Return JSON with keys: name, subtitle, short_description,
promotional_text, keywords, description, whats_new."""


def translate_one(client, language: str) -> dict:
    resp = client.messages.create(
        model="claude-sonnet-4-7",
        max_tokens=4096,
        system=[
            {"type": "text", "text": STYLE_GUIDE,
             "cache_control": {"type": "ephemeral"}},
        ],
        messages=[{"role": "user", "content": build_prompt(language)}],
    )
    text = "".join(b.text for b in resp.content if hasattr(b, "text"))
    # Strip code fences if present
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1]
        if text.endswith("```"):
            text = text.rsplit("```", 1)[0]
    return json.loads(text)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="+", help="locale keys to update; default: all")
    ap.add_argument("--force", action="store_true", help="overwrite existing files")
    ap.add_argument("--dry-run", action="store_true", help="list what would run")
    args = ap.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    todo = []
    for key, ios, play, label in LOCALE_MAP:
        if args.only and key not in args.only:
            continue
        path = OUT_DIR / f"{key}.json"
        if path.exists() and not args.force:
            continue
        todo.append((key, ios, play, label, path))

    print(f"{len(todo)} locales to translate")
    if args.dry_run:
        for key, _, _, label, _ in todo:
            print(f"  {key:10} {label}")
        return 0

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("ANTHROPIC_API_KEY not set. Use --dry-run to preview.", file=sys.stderr)
        return 1
    try:
        import anthropic
    except ImportError:
        print("Run: pip3 install --user anthropic", file=sys.stderr)
        return 1
    client = anthropic.Anthropic(api_key=api_key)

    for key, ios, play, label, path in todo:
        print(f"  {key:10} {label} ... ", end="", flush=True)
        try:
            data = translate_one(client, label)
        except Exception as e:
            print(f"FAIL: {str(e)[:120]}")
            continue
        data["language"] = label
        data["ios_locale"] = ios
        data["play_locale"] = play
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
        print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
