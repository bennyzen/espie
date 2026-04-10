import { getWeather } from '../utils/weather'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const location = query.location as string | undefined
  return await getWeather(location || undefined)
})
