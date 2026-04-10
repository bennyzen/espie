export default defineEventHandler(async (event) => {
  const body = await readBody<{ base_url: string; token: string }>(event)
  const base_url = body.base_url || process.env.HA_BASE_URL || ''
  const token = body.token || process.env.HA_TOKEN || ''

  if (!base_url || !token) {
    return { ok: false, error: 'Base URL and token are required' }
  }

  // Normalize: strip trailing slash
  const url = base_url.replace(/\/+$/, '')

  try {
    // GET /api/ — verify the API is reachable and token is valid
    const apiRes = await fetch(`${url}/api/`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!apiRes.ok) {
      const text = await apiRes.text().catch(() => '')
      if (apiRes.status === 401) return { ok: false, error: 'Invalid token — check your long-lived access token' }
      return { ok: false, error: `HA returned ${apiRes.status}: ${text.slice(0, 200)}` }
    }

    // GET /api/config returns instance details: location_name, version, etc.
    const configRes = await fetch(`${url}/api/config`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const info = configRes.ok ? await configRes.json() : {}

    // GET /api/states returns all entity states — count them
    const statesRes = await fetch(`${url}/api/states`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const states = statesRes.ok ? await statesRes.json() : []
    const entityCount = Array.isArray(states) ? states.length : 0

    return {
      ok: true,
      name: info.location_name || 'Home Assistant',
      version: info.version || 'unknown',
      entityCount,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('ECONNREFUSED') || message.includes('fetch failed')) {
      return { ok: false, error: `Cannot reach ${url} — check the URL and make sure Home Assistant is running` }
    }
    return { ok: false, error: message }
  }
})
