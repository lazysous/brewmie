"""Shared auth + constants for store API pipeline.

Brewmie uses the same Apple Developer team and ASC API key as Lazy Sous
(one team, one key, two apps). Play uses a separate service account so
the Brewmie Play console can be granted independent permissions.

APP_ID is unknown until the user creates the Brewmie record in App Store
Connect. Once created, copy the numeric id from the URL
  https://appstoreconnect.apple.com/apps/<APP_ID>/distribution/...
into the placeholder below.
"""
import json, time, jwt
from pathlib import Path
from google.oauth2 import service_account
from googleapiclient.discovery import build

ASC_KEY_ID = "QFM9X8VAL4"
ASC_ISSUER_ID = "65fe67a4-6e1b-4762-9fd8-996d00a62b89"
ASC_KEY_PATH = Path.home() / ".appstoreconnect" / "private_keys" / "AuthKey_QFM9X8VAL4.p8"
PLAY_KEY_PATH = Path.home() / ".brewmie" / "play-publish.json"

APP_ID = "6770472698"
IAP_PRODUCT_INTERNAL_ID = "6770476770"  # brewmie_premium_lifetime, non-consumable, AUD 6.99

BUNDLE_ID = "app.brewmie.brewmie"
PACKAGE = "app.brewmie.brewmie"

ASC_BASE = "https://api.appstoreconnect.apple.com"


def asc_token() -> str:
    with open(ASC_KEY_PATH) as f:
        key = f.read()
    return jwt.encode(
        {"iss": ASC_ISSUER_ID, "exp": int(time.time()) + 1200, "aud": "appstoreconnect-v1"},
        key, algorithm="ES256",
        headers={"kid": ASC_KEY_ID, "typ": "JWT"},
    )


def asc_request(method: str, path: str, body: dict = None) -> dict:
    """Make an ASC API request. path is relative to ASC_BASE."""
    import urllib.request, urllib.error, ssl
    ctx = ssl.create_default_context()
    try:
        import certifi
        ctx.load_verify_locations(certifi.where())
    except ImportError:
        pass
    url = ASC_BASE + path if path.startswith("/") else path
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Bearer {asc_token()}",
        "Content-Type": "application/json",
    })
    try:
        with urllib.request.urlopen(req, context=ctx) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        raise RuntimeError(f"ASC {method} {path} -> HTTP {e.code}: {body[:500]}") from e


def play_service():
    creds = service_account.Credentials.from_service_account_file(
        str(PLAY_KEY_PATH),
        scopes=["https://www.googleapis.com/auth/androidpublisher"],
    )
    return build("androidpublisher", "v3", credentials=creds, cache_discovery=False)


# Apple-supported App Store metadata localization codes (as of 2026).
# Source: App Store Connect Help - Manage app information.
ASC_SUPPORTED_LOCALES = {
    "ar-SA", "ca", "hr", "cs", "da", "nl-NL",
    "en-AU", "en-CA", "en-GB", "en-US",
    "fi", "fr-FR", "fr-CA", "de-DE", "el", "he", "hi", "hu", "id", "it", "ja", "ko",
    "ms", "no", "pl", "pt-BR", "pt-PT", "ro", "ru", "sk",
    "es-MX", "es-ES", "sv", "th", "tr", "uk", "vi",
    "zh-Hans", "zh-Hant",
    "bn-BD", "gu-IN", "kn-IN", "ml-IN", "mr-IN", "or-IN", "pa-IN",
    "sl-SI", "ta-IN", "te-IN", "ur-PK",
    # Sinhala intentionally excluded: Apple does not accept si, si-LK, sin, or si-Sinh.
}

# Google Play-supported listing locale codes (as of 2026).
# Source: Play Console - supported languages and translations table.
PLAY_SUPPORTED_LOCALES = {
    "af", "am", "ar", "az-AZ", "be", "bg", "bn-BD", "ca", "cs-CZ", "da-DK",
    "de-DE", "el-GR", "en-AU", "en-CA", "en-GB", "en-IN", "en-SG", "en-US", "en-ZA",
    "es-419", "es-ES", "es-US", "et", "eu-ES", "fa", "fa-AE", "fa-AF", "fa-IR",
    "fi-FI", "fil", "fr-CA", "fr-FR", "gl-ES", "gu", "hi-IN", "hr", "hu-HU",
    "hy-AM", "id", "is-IS", "it-IT", "iw-IL", "ja-JP", "ka-GE", "kk", "km-KH",
    "kn-IN", "ko-KR", "ky-KG", "lo-LA", "lt", "lv", "mk-MK", "ml-IN", "mn-MN",
    "mr-IN", "ms", "ms-MY", "my-MM", "ne-NP", "nl-NL", "no-NO", "pa", "pl-PL",
    "pt-BR", "pt-PT", "rm", "ro", "ru-RU", "si-LK", "sk", "sl", "sq", "sr",
    "sv-SE", "sw", "ta-IN", "te-IN", "th", "tr-TR", "uk", "ur", "vi",
    "zh-CN", "zh-HK", "zh-TW", "zu",
}
