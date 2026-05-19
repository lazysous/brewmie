"""Upload the IAP review screenshot to App Store Connect.

Apple's three-step flow:
  1. POST /v1/inAppPurchaseAppStoreReviewScreenshots — reserve a slot, get
     upload operations
  2. PUT the bytes to the operations' URL(s)
  3. PATCH the reservation as uploaded with the file's MD5 checksum

After a successful run, the IAP transitions out of MISSING_METADATA.
"""
import sys, os, hashlib, urllib.request, ssl
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _auth import asc_request

IAP_ID = "6770476770"
IMAGE = "/Users/williamson/brewmie/resources/iap-review-screenshot.png"

def main():
    size = os.path.getsize(IMAGE)
    with open(IMAGE, "rb") as f:
        blob = f.read()
    md5 = hashlib.md5(blob).hexdigest()
    print(f"file: {size} bytes, md5={md5}")

    print("[1/3] reserve")
    r1 = asc_request("POST", "/v1/inAppPurchaseAppStoreReviewScreenshots", {
        "data": {
            "type": "inAppPurchaseAppStoreReviewScreenshots",
            "attributes": {
                "fileName": os.path.basename(IMAGE),
                "fileSize": size,
            },
            "relationships": {
                "inAppPurchaseV2": {"data": {"type": "inAppPurchases", "id": IAP_ID}}
            }
        }
    })
    ss_id = r1["data"]["id"]
    ops = r1["data"]["attributes"]["uploadOperations"]
    print(f"  reserved id={ss_id}, {len(ops)} upload op(s)")

    try:
        import certifi
        ctx = ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        ctx = ssl.create_default_context()

    print("[2/3] upload bytes")
    for op in ops:
        headers = {h["name"]: h["value"] for h in op["requestHeaders"]}
        chunk = blob[op["offset"]:op["offset"] + op["length"]]
        req = urllib.request.Request(op["url"], data=chunk, method=op["method"], headers=headers)
        with urllib.request.urlopen(req, context=ctx) as resp:
            print(f"  PUT {op['offset']}-{op['offset']+op['length']} -> {resp.status}")

    print("[3/3] commit")
    r3 = asc_request("PATCH", f"/v1/inAppPurchaseAppStoreReviewScreenshots/{ss_id}", {
        "data": {
            "type": "inAppPurchaseAppStoreReviewScreenshots",
            "id": ss_id,
            "attributes": {"uploaded": True, "sourceFileChecksum": md5}
        }
    })
    state = r3["data"]["attributes"].get("assetDeliveryState", {}).get("state")
    print(f"  asset delivery state: {state}")
    print("Done.")


if __name__ == "__main__":
    main()
