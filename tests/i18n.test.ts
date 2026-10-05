// Characterisation suite for src/lib/i18n.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resolveKey, translate, interpolate, detectLocale, setLocale } from '../src/lib/i18n'

const LANG_KEY = 'brewmie_language'

beforeEach(() => {
  localStorage.clear()
  window.history.pushState({}, '', '/')
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('resolveKey', () => {
  const dict = { a: { b: { c: 'hello' }, d: 'top' } }

  it('resolves a dot path to a string leaf', () => {
    expect(resolveKey('a.b.c', dict)).toBe('hello')
    expect(resolveKey('a.d', dict)).toBe('top')
  })

  it('returns null for a missing path', () => {
    expect(resolveKey('a.b.missing', dict)).toBeNull()
    expect(resolveKey('x.y.z', dict)).toBeNull()
  })

  it('returns null for a non-string leaf', () => {
    expect(resolveKey('a.b', dict)).toBeNull() // 'a.b' is an object, not a string
  })

  it('returns null for a null/undefined dict', () => {
    expect(resolveKey('a.b.c', null)).toBeNull()
    expect(resolveKey('a.b.c', undefined)).toBeNull()
  })
})

describe('translate', () => {
  const strings = { greet: 'Hi {name}' }
  const fallback = { greet: 'Hello {name}', onlyFallback: 'fallback value' }

  it('prefers strings over fallback when both have the key', () => {
    expect(translate('greet', { name: 'Bob' }, strings, fallback)).toBe('Hi Bob')
  })

  it('falls back to the fallback dict when missing from strings', () => {
    expect(translate('onlyFallback', undefined, strings, fallback)).toBe('fallback value')
  })

  it('falls back to the raw key when missing from both strings and fallback', () => {
    expect(translate('nowhere.at.all', undefined, strings, fallback)).toBe('nowhere.at.all')
  })
})

describe('interpolate', () => {
  it('substitutes {placeholder} params, stringifying numbers', () => {
    expect(interpolate('{n} shots today', { n: 5 })).toBe('5 shots today')
  })

  it('leaves an unmatched placeholder literally in place', () => {
    expect(interpolate('Hello {name}, you have {count} shots', { name: 'Rich' })).toBe(
      'Hello Rich, you have {count} shots'
    )
  })

  it('returns the string unchanged when no params object is given', () => {
    expect(interpolate('plain string')).toBe('plain string')
  })
})

describe('detectLocale', () => {
  it('?lang= wins over localStorage, and persists the choice', () => {
    localStorage.setItem(LANG_KEY, 'es')
    window.history.pushState({}, '', '/?lang=fr')
    expect(detectLocale()).toBe('fr')
    expect(localStorage.getItem(LANG_KEY)).toBe('fr')
  })

  it('an unsupported ?lang= value is ignored, falling through to localStorage', () => {
    localStorage.setItem(LANG_KEY, 'es')
    window.history.pushState({}, '', '/?lang=zz')
    expect(detectLocale()).toBe('es')
  })

  it('falls back to localStorage when there is no ?lang=', () => {
    localStorage.setItem(LANG_KEY, 'de')
    expect(detectLocale()).toBe('de')
  })

  it('falls back to navigator.language, trimmed to the short code (pt-BR -> pt)', () => {
    vi.spyOn(window.navigator, 'language', 'get').mockReturnValue('pt-BR')
    expect(detectLocale()).toBe('pt')
  })

  it('falls back to "en" when navigator.language is unsupported', () => {
    vi.spyOn(window.navigator, 'language', 'get').mockReturnValue('xx-XX')
    expect(detectLocale()).toBe('en')
  })
})

describe('setLocale', () => {
  it('persists a known locale code', () => {
    setLocale('fr')
    expect(localStorage.getItem(LANG_KEY)).toBe('fr')
  })

  it('ignores an unknown locale code', () => {
    setLocale('zz')
    expect(localStorage.getItem(LANG_KEY)).toBeNull()
  })
})
