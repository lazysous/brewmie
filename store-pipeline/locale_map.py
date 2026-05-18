"""Canonical mapping: language family -> iOS code + Play code.

Used to keep translations indexed by language and pushed to the right
store-specific locale codes.
"""

# (key, ios_code or None, play_code or None, language_label)
LOCALE_MAP = [
    # Tier 1, major markets
    ("ja",        "ja",       "ja-JP",   "Japanese"),
    ("de",        "de-DE",    "de-DE",   "German"),
    ("fr",        "fr-FR",    "fr-FR",   "French (France)"),
    ("fr-ca",     "fr-CA",    "fr-CA",   "French (Canada)"),
    ("es-es",     "es-ES",    "es-ES",   "Spanish (Spain)"),
    ("es-mx",     "es-MX",    "es-419",  "Spanish (Latin America)"),
    ("es-us",     None,       "es-US",   "Spanish (US)"),
    ("it",        "it",       "it-IT",   "Italian"),
    ("ko",        "ko",       "ko-KR",   "Korean"),
    ("zh-hans",   "zh-Hans",  "zh-CN",   "Chinese (Simplified)"),
    ("zh-hant",   "zh-Hant",  "zh-TW",   "Chinese (Traditional)"),
    ("zh-hk",     None,       "zh-HK",   "Chinese (Hong Kong)"),
    ("pt-br",     "pt-BR",    "pt-BR",   "Portuguese (Brazil)"),
    ("pt-pt",     "pt-PT",    "pt-PT",   "Portuguese (Portugal)"),
    ("hi",        "hi",       "hi-IN",   "Hindi"),
    ("ru",        "ru",       "ru-RU",   "Russian"),
    # Tier 2, Europe + Middle East
    ("ar",        "ar-SA",    "ar",      "Arabic"),
    ("nl",        "nl-NL",    "nl-NL",   "Dutch"),
    ("sv",        "sv",       "sv-SE",   "Swedish"),
    ("no",        "no",       "no-NO",   "Norwegian"),
    ("da",        "da",       "da-DK",   "Danish"),
    ("fi",        "fi",       "fi-FI",   "Finnish"),
    ("pl",        "pl",       "pl-PL",   "Polish"),
    ("tr",        "tr",       "tr-TR",   "Turkish"),
    ("uk",        "uk",       "uk",      "Ukrainian"),
    ("hu",        "hu",       "hu-HU",   "Hungarian"),
    ("cs",        "cs",       "cs-CZ",   "Czech"),
    ("ro",        "ro",       "ro",      "Romanian"),
    ("sk",        "sk",       "sk",      "Slovak"),
    ("hr",        "hr",       "hr",      "Croatian"),
    ("ca",        "ca",       "ca",      "Catalan"),
    ("el",        "el",       "el-GR",   "Greek"),
    ("he",        "he",       "iw-IL",   "Hebrew"),
    ("sl",        "sl-SI",    "sl",      "Slovenian"),
    # SE Asia
    ("vi",        "vi",       "vi",      "Vietnamese"),
    ("id",        "id",       "id",      "Indonesian"),
    ("th",        "th",       "th",      "Thai"),
    ("ms",        "ms",       "ms",      "Malay"),
    ("ms-my",     None,       "ms-MY",   "Malay (Malaysia)"),
    # Persian (Play only, not iOS)
    ("fa",        None,       "fa",      "Persian"),
    ("fa-ir",     None,       "fa-IR",   "Persian (Iran)"),
    ("fa-ae",     None,       "fa-AE",   "Persian (UAE)"),
    ("fa-af",     None,       "fa-AF",   "Persian (Afghanistan/Dari)"),
    # Indian languages (iOS supports these)
    ("bn",        "bn-BD",    "bn-BD",   "Bengali"),
    ("gu",        "gu-IN",    "gu",      "Gujarati"),
    ("kn",        "kn-IN",    "kn-IN",   "Kannada"),
    ("ml",        "ml-IN",    "ml-IN",   "Malayalam"),
    ("mr",        "mr-IN",    "mr-IN",   "Marathi"),
    ("or",        "or-IN",    None,      "Odia"),  # Play doesn't support
    ("pa",        "pa-IN",    "pa",      "Punjabi"),
    ("ta",        "ta-IN",    "ta-IN",   "Tamil"),
    ("te",        "te-IN",    "te-IN",   "Telugu"),
    ("ur",        "ur-PK",    "ur",      "Urdu"),
    # Play-only (iOS doesn't support these)
    ("af",        None,       "af",      "Afrikaans"),
    ("am",        None,       "am",      "Amharic"),
    ("az",        None,       "az-AZ",   "Azerbaijani"),
    ("be",        None,       "be",      "Belarusian"),
    ("bg",        None,       "bg",      "Bulgarian"),
    ("eu",        None,       "eu-ES",   "Basque"),
    ("fil",       None,       "fil",     "Filipino"),
    ("gl",        None,       "gl-ES",   "Galician"),
    ("hy",        None,       "hy-AM",   "Armenian"),
    ("is",        None,       "is-IS",   "Icelandic"),
    ("ka",        None,       "ka-GE",   "Georgian"),
    ("kk",        None,       "kk",      "Kazakh"),
    ("km",        None,       "km-KH",   "Khmer"),
    ("ky",        None,       "ky-KG",   "Kyrgyz"),
    ("lo",        None,       "lo-LA",   "Lao"),
    ("lt",        None,       "lt",      "Lithuanian"),
    ("lv",        None,       "lv",      "Latvian"),
    ("mk",        None,       "mk-MK",   "Macedonian"),
    ("mn",        None,       "mn-MN",   "Mongolian"),
    ("my",        None,       "my-MM",   "Burmese"),
    ("ne",        None,       "ne-NP",   "Nepali"),
    ("si",        None,       "si-LK",   "Sinhala"),
    ("sq",        None,       "sq",      "Albanian"),
    ("sr",        None,       "sr",      "Serbian"),
    ("sw",        None,       "sw",      "Swahili"),
    ("zu",        None,       "zu",      "Zulu"),
    ("et",        None,       "et",      "Estonian"),
    # Romansh, Play only, ultra-niche, English fallback
    ("rm",        None,       "rm",      "Romansh"),
    # English variants (Play only; iOS already has en-AU/GB/US, no en-CA/IN/SG/ZA)
    ("en-ca",     None,       "en-CA",   "English (Canada)"),
    ("en-in",     None,       "en-IN",   "English (India)"),
    ("en-sg",     None,       "en-SG",   "English (Singapore)"),
    ("en-za",     None,       "en-ZA",   "English (South Africa)"),
]

# Sanity: derive sets we'll use elsewhere
ALL_IOS = {ios for _, ios, _, _ in LOCALE_MAP if ios}
ALL_PLAY = {play for _, _, play, _ in LOCALE_MAP if play}
