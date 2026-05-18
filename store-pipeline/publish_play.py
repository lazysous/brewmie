"""Convenience wrapper: bake the Brewmie store-pipeline metadata into an
edit transaction the same way the day-to-day uploader does.

For the actual binary upload, see scripts/publish_play.py at the repo
root (that's the one release.sh calls). This file exists so the
store-pipeline can be exercised end-to-end without an AAB.
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))

import importlib

if __name__ == "__main__":
    print("Running store-pipeline Play metadata push (English first, then translations).")
    importlib.import_module("02_push_play_english").main()
    importlib.import_module("08_push_play_translations").main()
