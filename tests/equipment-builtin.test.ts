// Built-in grinder profile (audit brewmie-47): recognised on re-entry, never flattened to a flat-burr record.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { isBuiltInGrinder, buildGrinderConfig, BUILT_IN_GRINDER_BRAND, GRINDER_MODELS } from '../src/data/equipment'

describe('isBuiltInGrinder', () => {
  it('recognises what a built-in save stores (blade + brand)', () => {
    expect(isBuiltInGrinder({ type: 'blade', brand: BUILT_IN_GRINDER_BRAND })).toBe(true)
  })
  it('recognises an older save whose type was flattened to flat-burr but kept the brand', () => {
    expect(isBuiltInGrinder({ type: 'flat-burr', brand: '(Built-in)' })).toBe(true)
  })
  it('recognises the oldest save, a blade with no brand', () => {
    expect(isBuiltInGrinder({ type: 'blade', brand: '' })).toBe(true)
  })
  it('does not treat a standalone grinder or nothing as built-in', () => {
    expect(isBuiltInGrinder({ type: 'flat-burr', brand: '1Zpresso' })).toBe(false)
    expect(isBuiltInGrinder({ type: 'conical-burr', brand: '' })).toBe(false)
    expect(isBuiltInGrinder(null)).toBe(false)
  })
})

describe('buildGrinderConfig', () => {
  it('keeps the built-in type and brand and lets min and max through', () => {
    const c = buildGrinderConfig({ builtIn: true, brand: 'Ignored', model: 'Ignored', min: 2, max: 30 })
    expect(c).toEqual({ type: 'blade', brand: '(Built-in)', model: '', minSetting: 2, maxSetting: 30 })
  })
  it('round trip: a saved built-in is restored as built-in and saved again unchanged', () => {
    const saved = buildGrinderConfig({ builtIn: true, brand: '', model: '', min: 1, max: 15 })
    const again = buildGrinderConfig({ builtIn: isBuiltInGrinder(saved), brand: saved.brand, model: saved.model, min: saved.minSetting, max: saved.maxSetting, existingType: saved.type })
    expect(again).toEqual(saved)
  })
  it('standalone is flat-burr unless it was conical', () => {
    expect(buildGrinderConfig({ builtIn: false, brand: 'X', model: 'Y', min: 0, max: 10 }).type).toBe('flat-burr')
    expect(buildGrinderConfig({ builtIn: false, brand: 'X', model: 'Y', min: 0, max: 10, existingType: 'conical-burr' }).type).toBe('conical-burr')
  })
  it('always keeps a real range', () => {
    expect(buildGrinderConfig({ builtIn: true, brand: '', model: '', min: 5, max: 5 }).maxSetting).toBe(6)
  })
  it('leaves the catalogue ranges alone', () => {
    expect(Object.keys(GRINDER_MODELS).length).toBeGreaterThan(5)
  })
})

describe('SetupScreen wiring', () => {
  const src = readFileSync('src/screens/SetupScreen.tsx', 'utf8')
  it('restores through isBuiltInGrinder and builds through buildGrinderConfig', () => {
    expect(src).toContain('isBuiltInGrinder(state.grinder)')
    expect(src).toContain('buildGrinderConfig(')
  })
  it('min and max inputs are not inside the standalone-only block', () => {
    const rows = src.split("className=\"sc-row\"").length - 1
    expect(rows).toBeGreaterThanOrEqual(2)
    for (const chunk of src.split('{!grinderBuiltIn && (').slice(1)) {
      const block = chunk.slice(0, chunk.indexOf('</>\n'))
      expect(block).not.toContain("setup.minSetting")
    }
  })
})
