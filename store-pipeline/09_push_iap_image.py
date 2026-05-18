"""Upload an IAP promotional image to App Store Connect.

Three-step Apple flow: create PromotedPurchase -> reserve image -> upload
bytes -> mark uploaded. Fill IAP_ID and IMAGE_PATH at the top of the file
before running.
"""
import sys, os, hashlib, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _auth import asc_request, APP_ID

IAP_ID = "<FILL_AFTER_IAP_CREATED>"
IMAGE_PATH = "/Users/williamson/Desktop/brewmie-iap-promo.png"


def md5_hex(path):
    with open(path, "rb") as f:
        return hashlib.md5(f.read()).hexdigest()


def upload_bytes(url: str, method: str, headers: list, file_path: str, offset: int, length: int):
    """Execute an Apple multipart-style upload operation: PUT the bytes for this offset/length."""
    import urllib.request, ssl
    try:
        import certifi
        ctx = ssl.create_default_context()
        ctx.load_verify_locations(certifi.where())
    except ImportError:
        ctx = ssl.create_default_context()
    with open(file_path, "rb") as f:
        f.seek(offset)
        data = f.read(length)
    req_headers = {h["name"]: h["value"] for h in headers}
    req = urllib.request.Request(url, data=data, method=method, headers=req_headers)
    with urllib.request.urlopen(req, context=ctx) as resp:
        return resp.status


def main():
    if APP_ID.startswith("<") or IAP_ID.startswith("<"):
        sys.exit("APP_ID or IAP_ID not set. Fill them in before running.")
    file_size = os.path.getsize(IMAGE_PATH)
    file_name = "brewmie-iap-promo.png"
    file_md5 = md5_hex(IMAGE_PATH)
    print(f"File: {IMAGE_PATH}")
    print(f"  size={file_size} bytes, md5={file_md5}")

    print("\n[1/4] Creating PromotedPurchase...")
    pp_body = {
        "data": {
            "type": "promotedPurchases",
            "attributes": {"visibleForAllUsers": True, "enabled": True},
            "relationships": {
                "inAppPurchaseV2": {"data": {"type": "inAppPurchases", "id": IAP_ID}},
                "app": {"data": {"type": "apps", "id": APP_ID}},
            },
        }
    }
    try:
        pp = asc_request("POST", "/v1/promotedPurchases", pp_body)
        pp_id = pp["data"]["id"]
        print(f"  Created promotedPurchase id={pp_id}")
    except RuntimeError as e:
        if "ENTITY_ERROR.RELATIONSHIP.INVALID" in str(e) or "already" in str(e).lower():
            existing = asc_request("GET", f"/v2/inAppPurchases/{IAP_ID}/promotedPurchase")
            pp_id = existing["data"]["id"]
            print(f"  Already exists; reusing id={pp_id}")
        else:
            print(f"  ERROR: {str(e)[:400]}")
            raise

    print("\n[2/4] Reserving promotedPurchaseImage...")
    img_body = {
        "data": {
            "type": "inAppPurchaseImages",
            "attributes": {"fileSize": file_size, "fileName": file_name},
            "relationships": {
                "inAppPurchase": {"data": {"type": "inAppPurchases", "id": IAP_ID}},
            },
        }
    }
    img = asc_request("POST", "/v1/inAppPurchaseImages", img_body)
    img_id = img["data"]["id"]
    upload_ops = img["data"]["attributes"]["uploadOperations"]
    print(f"  Reserved image id={img_id}, {len(upload_ops)} upload operation(s)")

    print("\n[3/4] Uploading bytes...")
    for i, op in enumerate(upload_ops, 1):
        status = upload_bytes(op["url"], op["method"], op["requestHeaders"], IMAGE_PATH, op["offset"], op["length"])
        print(f"  Operation {i}/{len(upload_ops)}: HTTP {status}")

    print("\n[4/4] Marking uploaded with sourceFileChecksum...")
    patch_body = {
        "data": {
            "type": "inAppPurchaseImages",
            "id": img_id,
            "attributes": {"uploaded": True, "sourceFileChecksum": file_md5},
        }
    }
    result = asc_request("PATCH", f"/v1/inAppPurchaseImages/{img_id}", patch_body)
    state = result["data"]["attributes"].get("assetDeliveryState") or result["data"]["attributes"].get("state")
    print(f"  Done. state={state}")
    print(f"  Full attributes: {json.dumps(result['data']['attributes'], indent=2)[:600]}")

    print("\n=== Verification ===")
    verify = asc_request("GET", f"/v2/inAppPurchases/{IAP_ID}/promotedPurchase")
    print(f"PromotedPurchase: {json.dumps(verify, indent=2)[:600]}")
    images = asc_request("GET", f"/v2/inAppPurchases/{IAP_ID}/images")
    print(f"\nImages on IAP: {len(images['data'])} image(s)")
    for img in images["data"]:
        print(f"  {img['id']}: state={img['attributes'].get('assetDeliveryState')}")


if __name__ == "__main__":
    main()
