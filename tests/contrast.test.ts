// brewmie-49: the sage green token and the white-on-colour pills must reach WCAG AA (4.5:1 for text).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
function ratio(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}
// Blend an rgba colour over an opaque background.
function over(hex: string, alpha: number, bg: string): string {
  const mix = [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * alpha + parseInt(bg.slice(i, i + 2), 16) * (1 - alpha)))
  return '#' + mix.map((v) => v.toString(16).padStart(2, '0')).join('')
}

const css = readFileSync('src/app.css', 'utf8')
const green = /--accent-green:\s*(#[0-9A-Fa-f]{6})/.exec(css)![1]

describe('green token contrast', () => {
  it('is the AA-safe sage', () => { expect(green.toUpperCase()).toBe('#567A48') })
  it('white text on green passes AA', () => { expect(ratio('#FFFFFF', green)).toBeGreaterThanOrEqual(4.5) })
  it.each(['#FFFFFF', '#FAF7F2'])('green text on %s passes AA', (bg) => {
    expect(ratio(green, bg)).toBeGreaterThanOrEqual(4.5)
  })
  it('chip text token on the green tint and on off-white passes AA', () => {
    const text = /--accent-green-text:\s*(#[0-9A-Fa-f]{6})/.exec(css)![1]
    expect(css).toMatch(/\.pill-badge--green \{[^}]*color: var\(--accent-green-text\)/)
    for (const bg of ['#FFFFFF', '#FAF7F2', '#F5F2EE', over(green, 0.1, '#FAF7F2'), over(green, 0.1, '#F5F2EE')]) {
      expect(ratio(text, bg), bg).toBeGreaterThanOrEqual(4.5)
    }
  })
  it('button gradient stops under white text pass AA', () => {
    for (const stop of ['#567A48', '#46683A']) expect(ratio('#FFFFFF', stop)).toBeGreaterThanOrEqual(4.5)
  })
  it('score pills with white text pass AA', () => {
    const src = readFileSync('src/screens/InsightsScreen.tsx', 'utf8')
    const fn = src.slice(src.indexOf('function scorePillStyle'), src.indexOf('function formatDate'))
    const pairs = [...fn.matchAll(/background: '(#[0-9A-Fa-f]{6})', color: '(#[0-9A-Fa-f]{6})'/g)]
    expect(pairs.length).toBeGreaterThanOrEqual(5)
    for (const [, bg, fg] of pairs) expect(ratio(bg, fg), `${bg} on ${fg}`).toBeGreaterThanOrEqual(4.5)
  })
})
