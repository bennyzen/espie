// Weather tool — lets the agent check current weather and forecast.

import { Type } from '@sinclair/typebox'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { getWeather } from '../utils/weather'

export function createWeatherTool(): AgentTool<any> {
  return {
    name: 'get_weather',
    label: 'Get Weather',
    description:
      'Get the current weather and 3-day forecast. Uses the configured location by default. ' +
      'You can optionally specify a different location.',
    parameters: Type.Object({
      location: Type.Optional(Type.String({ description: 'Location to check, e.g. "Tokyo, Japan". Omit to use configured location.' })),
    }),
    execute: async (_id: string, params: { location?: string }) => {
      const weather = await getWeather(params.location)
      const c = weather.current

      const lines = [
        `${weather.location}: ${c.description}, ${c.temperature}°C (feels like ${c.feels_like}°C)`,
        `Humidity: ${c.humidity}% | Wind: ${c.wind_speed} km/h`,
        '',
        'Forecast:',
        ...weather.forecast.map(d => `  ${d.date}: ${d.description}, ${d.low}–${d.high}°C`),
      ]

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] }
    },
  }
}
