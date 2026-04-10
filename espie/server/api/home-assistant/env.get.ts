// Returns Home Assistant config from environment variables (HA_BASE_URL, HA_TOKEN).
// Used by the frontend to show env-sourced values when no YAML config is set.

export default defineEventHandler(() => {
  return {
    base_url: process.env.HA_BASE_URL || '',
    token: process.env.HA_TOKEN || '',
  }
})
