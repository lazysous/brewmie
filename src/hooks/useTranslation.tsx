import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react'
import {
  detectLocale,
  loadTranslations,
  setLocale as persistLocale,
  translate,
  type Locale,
  type TParams,
  type TranslationDict,
} from '../lib/i18n'

interface I18nContextValue {
  t: (key: string, params?: TParams) => string
  locale: Locale
  setLocale: (code: string) => void
  isReady: boolean
}

const I18nContext = createContext<I18nContextValue | null>(null)

interface I18nProviderProps {
  children: React.ReactNode
}

export function I18nProvider({ children }: I18nProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(() => detectLocale())
  const [strings, setStrings] = useState<TranslationDict | null>(null)
  const [fallback, setFallback] = useState<TranslationDict | null>(null)
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function init() {
      // Always load English as fallback
      const en = await loadTranslations('en')
      if (cancelled) return
      setFallback(en)

      if (locale === 'en') {
        setStrings(en)
      } else {
        const data = await loadTranslations(locale)
        if (cancelled) return
        if (data) {
          setStrings(data)
        } else {
          setStrings(en)
          setLocaleState('en')
        }
      }
      setIsReady(true)
    }
    init()
    return () => { cancelled = true }
  }, [locale])

  const t = useCallback(
    (key: string, params?: TParams) => translate(key, params, strings, fallback),
    [strings, fallback]
  )

  const setLocale = useCallback((code: string) => {
    persistLocale(code)
  }, [])

  const value = useMemo<I18nContextValue>(
    () => ({ t, locale, setLocale, isReady }),
    [t, locale, setLocale, isReady]
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useTranslation(): I18nContextValue {
  const ctx = useContext(I18nContext)
  if (!ctx) {
    // Fallback: identity translator. Lets components render before provider mounts
    // and prevents crashes if used outside a provider (e.g. in tests).
    return {
      t: (key: string, params?: TParams) => {
        if (!params) return key
        return key
      },
      locale: 'en',
      setLocale: () => {},
      isReady: false,
    }
  }
  return ctx
}
