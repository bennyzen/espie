// Weather utility — geocodes location names and fetches weather from Open-Meteo.
// No API key required. Caches geocoding results for the process lifetime.

import { loadConfig } from './config'

interface GeoResult {
  latitude: number
  longitude: number
  name: string
  country: string
  timezone: string
}

interface CurrentWeather {
  temperature: number
  unit: string
  feels_like: number
  humidity: number
  wind_speed: number
  description: string
  code: number
}

interface DailyForecast {
  date: string
  high: number
  low: number
  description: string
  code: number
}

export interface WeatherData {
  location: string
  current: CurrentWeather
  forecast: DailyForecast[]
}

// WMO weather codes → human description
const WMO_CODES: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Foggy',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Moderate drizzle',
  55: 'Dense drizzle',
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  71: 'Slight snow',
  73: 'Moderate snow',
  75: 'Heavy snow',
  80: 'Slight rain showers',
  81: 'Moderate rain showers',
  82: 'Violent rain showers',
  85: 'Slight snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with slight hail',
  99: 'Thunderstorm with heavy hail',
}

function wmoDescription(code: number): string {
  return WMO_CODES[code] || 'Unknown'
}

// Cache geocoding results: location string → resolved coords
const geoCache = new Map<string, GeoResult>()

/**
 * Geocode a location name via Open-Meteo's geocoding API.
 * Returns the best match. Caches results in memory.
 */
export async function geocode(location: string): Promise<GeoResult> {
  const cached = geoCache.get(location.toLowerCase())
  if (cached) return cached

  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Geocoding failed: ${res.status}`)

  const data = await res.json()
  if (!data.results?.length) throw new Error(`Location not found: ${location}`)

  const r = data.results[0]
  const result: GeoResult = {
    latitude: r.latitude,
    longitude: r.longitude,
    name: r.name,
    country: r.country_code || r.country || '',
    timezone: r.timezone || '',
  }

  geoCache.set(location.toLowerCase(), result)
  return result
}

/**
 * Fetch current weather + 3-day forecast for a location.
 * Geocodes the configured location name automatically.
 */
export async function getWeather(locationOverride?: string): Promise<WeatherData> {
  const config = loadConfig()
  const location = locationOverride || config.location
  if (!location) throw new Error('No location configured — set it in Config → Settings')

  const geo = await geocode(location)
  const tz = config.timezone || geo.timezone || 'auto'

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${geo.latitude}&longitude=${geo.longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=${encodeURIComponent(tz)}&forecast_days=3`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Weather API failed: ${res.status}`)

  const data = await res.json()

  const current: CurrentWeather = {
    temperature: data.current.temperature_2m,
    unit: data.current_units?.temperature_2m || '°C',
    feels_like: data.current.apparent_temperature,
    humidity: data.current.relative_humidity_2m,
    wind_speed: data.current.wind_speed_10m,
    description: wmoDescription(data.current.weather_code),
    code: data.current.weather_code,
  }

  const forecast: DailyForecast[] = data.daily.time.map((date: string, i: number) => ({
    date,
    high: data.daily.temperature_2m_max[i],
    low: data.daily.temperature_2m_min[i],
    description: wmoDescription(data.daily.weather_code[i]),
    code: data.daily.weather_code[i],
  }))

  return {
    location: `${geo.name}, ${geo.country}`,
    current,
    forecast,
  }
}
