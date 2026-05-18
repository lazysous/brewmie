"""Push new English copy to Play en-AU. Read-back diff first, then commit."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _auth import play_service, PACKAGE
from english_copy import TITLE, PLAY_SHORT_DESC, DESCRIPTION


def main():
    svc = play_service()
    edit = svc.edits().insert(packageName=PACKAGE, body={}).execute()
    edit_id = edit["id"]
    try:
        # Read existing en-AU listing for diff
        try:
            existing = svc.edits().listings().get(
                packageName=PACKAGE, editId=edit_id, language="en-AU",
            ).execute()
        except Exception:
            existing = {}
        print("=== en-AU BEFORE ===")
        print(f"  title:     {existing.get('title')!r}")
        print(f"  short:     {existing.get('shortDescription')!r}")
        print(f"  full[0:120]: {existing.get('fullDescription', '')[:120]!r}")

        # Build new listing
        new_listing = {
            "language": "en-AU",
            "title": TITLE,
            "shortDescription": PLAY_SHORT_DESC,
            "fullDescription": DESCRIPTION,
            "video": existing.get("video", ""),
        }

        # Update
        result = svc.edits().listings().update(
            packageName=PACKAGE, editId=edit_id, language="en-AU",
            body=new_listing,
        ).execute()
        print("=== en-AU AFTER (staged in edit, not yet committed) ===")
        print(f"  title:     {result.get('title')!r}")
        print(f"  short:     {result.get('shortDescription')!r}")
        print(f"  full[0:120]: {result.get('fullDescription', '')[:120]!r}")

        # Validate before commit
        svc.edits().validate(packageName=PACKAGE, editId=edit_id).execute()
        print("Validation: OK")

        # Commit
        commit = svc.edits().commit(packageName=PACKAGE, editId=edit_id).execute()
        print(f"COMMITTED: id={commit['id']} expiry={commit.get('expiryTimeSeconds')}")
        return True
    except Exception:
        # Best-effort cleanup
        try:
            svc.edits().delete(packageName=PACKAGE, editId=edit_id).execute()
        except Exception:
            pass
        raise


if __name__ == "__main__":
    main()
