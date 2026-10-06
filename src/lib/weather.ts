// Ambient weather for a shot, from Open-Meteo (keyless public API).
//
// The coordinates are rounded to one decimal place, about 11 km, BEFORE they
// leave the device. Weather does not need more precision than that (the
// forecast models run on grids of roughly that size), and it is what the iOS
// permission string promises: "Brewmie uses your rough location". Brewmie
// never stores or forwards the coordinates; only the temperature and humidity
// that come back are kept with the shot.

const COORD_DECIMALS = 1

export function roundCoord(value: number): number {
  const f = 10 ** COORD_DECIMALS
  // Normalise -0 to 0 so the URL never carries "-0".
  return Math.round(value * f) / f || 0
}

export function openMeteoUrl(latitude: number, longitude: number): string {
  const lat = roundCoord(latitude)
  const lon = roundCoord(longitude)
  return `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m`
}
