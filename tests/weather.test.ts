// The weather lookup must never send a precise location off the device.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { weatherUrl, parseWeather, roundCoord, WEATHER_ATTRIBUTION } from '../src/lib/weather'

describe('weatherUrl', () => {
  it('rounds both coordinates to one decimal place (about 11 km)', () => {
    const url = weatherUrl(-37.813629, 144.963058)
    expect(url).toContain('lat=-37.8&')
    expect(url).toContain('lon=145')
    expect(url).not.toMatch(/lat=-?\d+\.\d{2,}/)
    expect(url).not.toMatch(/lon=-?\d+\.\d{2,}/)
  })

  it('targets MET Norway Locationforecast compact', () => {
    expect(weatherUrl(51.5072, -0.1276)).toBe(
      'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=51.5&lon=-0.1',
    )
  })

  it('never emits -0', () => {
    expect(roundCoord(-0.04)).toBe(0)
    expect(weatherUrl(-0.04, -0.01)).toContain('lat=0&lon=0')
  })
})

describe('parseWeather', () => {
  const sample = {
    properties: { timeseries: [
      { data: { instant: { details: { air_temperature: 18.1, relative_humidity: 80.7 } } } },
      { data: { instant: { details: { air_temperature: 1, relative_humidity: 1 } } } },
    ] },
  }
  it('reads the first timeseries entry, rounded', () => {
    expect(parseWeather(sample)).toEqual({ temp: 18, humidity: 81 })
  })
  it('returns null on anything malformed', () => {
    expect(parseWeather(null)).toBeNull()
    expect(parseWeather({})).toBeNull()
    expect(parseWeather({ properties: { timeseries: [] } })).toBeNull()
    expect(parseWeather({ properties: { timeseries: [{ data: { instant: { details: { air_temperature: '18' } } } }] } })).toBeNull()
  })
})

describe('fence', () => {
  it('App.tsx builds the weather URL only through weatherUrl', () => {
    const app = readFileSync(path.join(__dirname, '../src/App.tsx'), 'utf8')
    expect(app).toContain('weatherUrl(coords.latitude, coords.longitude)')
    expect(app).not.toContain('api.met.no')
    expect(app).not.toContain('open-meteo')
  })
  it('credits MET Norway in the UI and the privacy policy', () => {
    const hero = readFileSync(path.join(__dirname, '../src/components/Hero.tsx'), 'utf8')
    const privacy = readFileSync(path.join(__dirname, '../public/privacy.html'), 'utf8')
    expect(hero).toContain('WEATHER_ATTRIBUTION')
    expect(WEATHER_ATTRIBUTION).toBe('MET Norway')
    expect(privacy).toContain('MET Norway')
    expect(privacy).not.toContain('Open-Meteo')
  })
})
