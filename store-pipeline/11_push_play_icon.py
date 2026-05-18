"""Upload Play high-res app icon (512x512) via Play Developer API."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _auth import play_service, PACKAGE
from googleapiclient.http import MediaFileUpload

ICON_PATH = "/Users/williamson/Desktop/brewmie-icon512.png"
LANGUAGE = "en-AU"
IMAGE_TYPE = "icon"


def main():
    svc = play_service()
    edit = svc.edits().insert(packageName=PACKAGE, body={}).execute()
    edit_id = edit["id"]
    print(f"Edit id: {edit_id}")

    try:
        try:
            svc.edits().images().deleteall(
                packageName=PACKAGE, editId=edit_id,
                language=LANGUAGE, imageType=IMAGE_TYPE,
            ).execute()
            print(f"Cleared existing {IMAGE_TYPE}")
        except Exception as e:
            print(f"  (no existing image: {str(e)[:80]})")

        media = MediaFileUpload(ICON_PATH, mimetype="image/png", resumable=False)
        result = svc.edits().images().upload(
            packageName=PACKAGE, editId=edit_id,
            language=LANGUAGE, imageType=IMAGE_TYPE,
            media_body=media,
        ).execute()
        print(f"Uploaded: id={result['image']['id']}")
        print(f"  url={result['image']['url']}")

        svc.edits().validate(packageName=PACKAGE, editId=edit_id).execute()
        print("Validation: OK")
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
