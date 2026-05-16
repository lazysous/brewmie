// ─── Brewmie i18n engine ──────────────────────────────────────────────────────
// Mirrors the Lazy Sous approach in a React idiom. Loads English synchronously
// as the fallback, lazy-loads the target locale's JSON, and exposes a t(key)
// API with dot-path lookup plus {placeholder} param interpolation.

export const TIER_1_LOCALES = [
  'en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'zh', 'ko', 'hi', 'nl', 'sv', 'tr', 'pl',
] as const

export const TIER_2_LOCALES = [
  'af', 'am', 'ar', 'as', 'az', 'be', 'cs', 'cy', 'da', 'el', 'et', 'eu',
  'fa', 'fi', 'fil', 'ga', 'gl', 'gu', 'ha', 'he', 'hr', 'hu', 'hy', 'ka',
  'kk', 'km', 'kn', 'ml', 'mn', 'mr', 'ms', 'mt', 'my', 'ps', 'ro', 'rw',
  'sd', 'si', 'sk', 'sw', 'ta', 'te', 'th', 'uk', 'ur',
] as const

export const ALL_LOCALES = [...TIER_1_LOCALES, ...TIER_2_LOCALES] as const

export type Locale = typeof ALL_LOCALES[number]

const DEFAULT_LOCALE: Locale = 'en'
const STORAGE_KEY = 'brewmie_language'

export interface TranslationDict {
  [key: string]: string | TranslationDict
}

export type TParams = Record<string, string | number>

function isLocale(s: string): s is Locale {
  return (ALL_LOCALES as readonly string[]).includes(s)
}

// ─── Detect locale ────────────────────────────────────────────────────────────
export function detectLocale(): Locale {
  // 1. URL ?lang=xx override (also persist)
  try {
    const params = new URLSearchParams(window.location.search)
    const fromQuery = params.get('lang')
    if (fromQuery && isLocale(fromQuery)) {
      try { localStorage.setItem(STORAGE_KEY, fromQuery) } catch { /* ignore */ }
      return fromQuery
    }
  } catch { /* ignore */ }

  // 2. localStorage
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && isLocale(saved)) return saved
  } catch { /* ignore */ }

  // 3. navigator.language
  try {
    const nav = (navigator.language || (navigator as { userLanguage?: string }).userLanguage || 'en')
    const short = nav.split('-')[0].toLowerCase()
    if (isLocale(short)) return short
  } catch { /* ignore */ }

  return DEFAULT_LOCALE
}

// ─── Set locale ───────────────────────────────────────────────────────────────
// Persists to localStorage. Reloads the page so the React tree picks up new
// strings cleanly — matches the Lazy Sous behaviour and keeps things simple.
export function setLocale(code: string): void {
  if (!isLocale(code)) return
  try { localStorage.setItem(STORAGE_KEY, code) } catch { /* ignore */ }
  try { window.location.reload() } catch { /* ignore */ }
}

// ─── Load translations ────────────────────────────────────────────────────────
// Uses a base URL relative to the current document so the same build serves
// from lazysous.app/brewmie/ and from Capacitor's file:// scheme.
export async function loadTranslations(locale: string): Promise<TranslationDict | null> {
  try {
    // Resolve relative to the current page so subpath hosting + Capacitor both work.
    const url = new URL(`translations/${locale}.json`, document.baseURI).toString()
    const resp = await fetch(url)
    if (!resp.ok) return null
    return await resp.json() as TranslationDict
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.log('[i18n] Failed to load', locale, (e as Error).message)
    }
    return null
  }
}

// ─── Interpolation ────────────────────────────────────────────────────────────
export function interpolate(str: string, params?: TParams): string {
  if (!params) return str
  return str.replace(/\{(\w+)\}/g, (_, key: string) =>
    params[key] !== undefined ? String(params[key]) : `{${key}}`
  )
}

// ─── Dot-path resolve ─────────────────────────────────────────────────────────
export function resolveKey(key: string, dict: TranslationDict | null | undefined): string | null {
  if (!dict) return null
  const parts = key.split('.')
  let cur: string | TranslationDict | undefined = dict
  for (const p of parts) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return null
    cur = (cur as TranslationDict)[p]
  }
  return typeof cur === 'string' ? cur : null
}

// ─── Translate helper ─────────────────────────────────────────────────────────
export function translate(
  key: string,
  params: TParams | undefined,
  strings: TranslationDict | null,
  fallback: TranslationDict | null,
): string {
  const val = resolveKey(key, strings) ?? resolveKey(key, fallback) ?? key
  return interpolate(val, params)
}
