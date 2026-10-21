// Ambient weather for a shot, from MET Norway Locationforecast 2.0 (free,
// keyless, commercial use allowed with attribution).
//
// The coordinates are rounded to one decimal place, about 11 km, BEFORE they
// leave the device. Weather does not need more precision than that, it is what
// the iOS permission string promises ("Brewmie uses your rough location"), and
// it is inside MET's limit of four decimals. Brewmie never stores or forwards
// the coordinates; only the temperature and humidity that come back are kept
// with the shot.
//
// MET asks for an identifying User-Agent. WebViews and browsers silently drop a
// scripted User-Agent, so the header below is best effort; the app is still
// identifiable by its Origin. Request volume is unchanged: one lookup per app
// launch, far inside MET's limits.

const COORD_DECIMALS = 1

export const WEATHER_ATTRIBUTION = 'MET Norway'
export const WEATHER_USER_AGENT = 'Brewmie/1.1 (https://brewmie.app; chef@lazysous.app)'

export function roundCoord(value: number): number {
  const f = 10 ** COORD_DECIMALS
  // Normalise -0 to 0 so the URL never carries "-0".
  return Math.round(value * f) / f || 0
}

export function weatherUrl(latitude: number, longitude: number): string {
  const lat = roundCoord(latitude)
  const lon = roundCoord(longitude)
  return `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat}&lon=${lon}`
}

// MET compact JSON: first timeseries entry, instant details. Temperature is
// already Celsius. Returns null unless both numbers are present.
export function parseWeather(data: unknown): { temp: number; humidity: number } | null {
  const d = (data as { properties?: { timeseries?: Array<{ data?: { instant?: { details?: Record<string, unknown> } } }> } } | null)
    ?.properties?.timeseries?.[0]?.data?.instant?.details
  const temp = d?.air_temperature
  const humidity = d?.relative_humidity
  if (typeof temp !== 'number' || typeof humidity !== 'number') return null
  return { temp: Math.round(temp), humidity: Math.round(humidity) }
}
