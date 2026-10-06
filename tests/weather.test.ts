// The weather lookup must never send a precise location off the device.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { openMeteoUrl, roundCoord } from '../src/lib/weather'

describe('openMeteoUrl', () => {
  it('rounds both coordinates to one decimal place (about 11 km)', () => {
    const url = openMeteoUrl(-37.813629, 144.963058)
    expect(url).toContain('latitude=-37.8&')
    expect(url).toContain('longitude=145&')
    expect(url).not.toMatch(/latitude=-?\d+\.\d{2,}/)
    expect(url).not.toMatch(/longitude=-?\d+\.\d{2,}/)
  })

  it('asks only for current temperature and humidity', () => {
    expect(openMeteoUrl(51.5072, -0.1276)).toMatch(/&current=temperature_2m,relative_humidity_2m$/)
  })

  it('never emits -0', () => {
    expect(roundCoord(-0.04)).toBe(0)
    expect(openMeteoUrl(-0.04, -0.01)).toContain('latitude=0&longitude=0&')
  })
})

describe('fence', () => {
  it('App.tsx builds the weather URL only through openMeteoUrl', () => {
    const app = readFileSync('src/App.tsx', 'utf8')
    expect(app).toContain('openMeteoUrl(coords.latitude, coords.longitude)')
    expect(app).not.toContain('api.open-meteo.com')
  })
})
