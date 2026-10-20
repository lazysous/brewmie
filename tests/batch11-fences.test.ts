// Source fences for the batch 11 fixes (audit brewmie-05, -30, -44): the behaviour lives in
// screen components that are expensive to render here, so these pin the shape of the fix.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const src = (p: string) => readFileSync(path.join(__dirname, '..', p), 'utf8')

describe('typed inputs are committed on blur, not clamped per keystroke', () => {
  it('BrewScreen keeps the typed text in editing state and commits on blur or Enter', () => {
    const s = src('src/screens/BrewScreen.tsx')
    expect(s).toContain('onBlur={commitEditing}')
    expect(s).toContain("if (e.key === 'Enter') (e.target as HTMLInputElement).blur()")
    expect(s).not.toContain('if (!isNaN(n)) setTargetValue(row.key, n)')
  })
  it('SetupScreen keeps the typed shot temperature as text and converts on blur', () => {
    const s = src('src/screens/SetupScreen.tsx')
    expect(s).toContain('onBlur={commitShotTemp}')
    expect(s).toContain('value={shotTempText ?? shotTempDisplay}')
    expect(s).not.toMatch(/setShotTempC\(fahrenheitToCelsius\(Number\(e\.target\.value\)\)\)/)
  })
})

describe('days are local days', () => {
  it('no screen slices an ISO string for a date any more', () => {
    for (const f of ['src/screens/SetupScreen.tsx', 'src/screens/InsightsScreen.tsx']) {
      const s = src(f)
      expect(s, f).not.toMatch(/toISOString\(\)\.slice\(0, ?10\)/)
      expect(s, f).not.toMatch(/timestamp\.slice\(0, ?10\)/)
      expect(s, f).toContain("from '../lib/dates'")
    }
  })
  it('reminders parse stored dates as local days', () => {
    const s = src('src/lib/notifications.ts')
    expect(s).toContain('return parseLocalDate(iso)')
  })
})
