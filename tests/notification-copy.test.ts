// Every notification the app schedules must go through notifications.ts so
// it is translated (59 locales) and carries a stable id. BrewScreen used to
// schedule hard-coded English under its own id for the rate-later reminder.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const srcDir = path.resolve(__dirname, '../src')
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)])
}

describe('notification copy', () => {
  it('only notifications.ts calls scheduleLocalNotification', () => {
    const offenders = walk(srcDir)
      .filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith('lib/native.ts') && !f.endsWith('lib/notifications.ts'))
      .filter((f) => /scheduleLocalNotification\(/.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(srcDir, f))
    expect(offenders).toEqual([])
  })
  it('no screen carries hard-coded English notification text', () => {
    const brew = readFileSync(path.join(srcDir, 'screens/BrewScreen.tsx'), 'utf8')
    expect(brew).not.toMatch(/How did that shot taste/)
    expect(brew).toMatch(/scheduleRateReminder\(t\)/)
    expect(brew).toMatch(/cancelRateReminder\(\)/)
  })
})
