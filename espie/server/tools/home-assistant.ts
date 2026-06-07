/**
 * Native Home Assistant tools via REST API.
 * Replaces the Python ha-mcp subprocess with direct HTTP calls.
 * Requires HA_BASE_URL and HA_TOKEN environment variables.
 */
import { Type } from '@sinclair/typebox'
import type { AgentTool } from '@earendil-works/pi-agent-core'

interface HAToolsConfig {
  baseUrl: string
  token: string
}

async function haFetch(config: HAToolsConfig, path: string, options?: RequestInit) {
  const res = await fetch(`${config.baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`HA API ${res.status}: ${text.slice(0, 200)}`)
  }
  return res.json()
}

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] }
}

/**
 * Create Home Assistant agent tools.
 * Returns tools for: get_state, list_entities, call_service, turn_on, turn_off, toggle.
 */
export function createHomeAssistantTools(config: HAToolsConfig): AgentTool<any>[] {
  const tools: AgentTool<any>[] = [
    {
      name: 'ha_get_state',
      label: 'Get Entity State',
      description: 'Get the current state and attributes of a Home Assistant entity. Use this to check if a light is on, get sensor readings, check device status, etc.',
      parameters: Type.Object({
        entity_id: Type.String({ description: 'Entity ID, e.g. light.living_room, sensor.temperature' }),
      }),
      execute: async (_id: string, params: { entity_id: string }) => {
        const state = await haFetch(config, `/api/states/${params.entity_id}`)
        const attrs = state.attributes || {}
        const parts = [`${params.entity_id}: ${state.state}`]
        if (attrs.friendly_name) parts.unshift(attrs.friendly_name)
        if (attrs.unit_of_measurement) parts[parts.length - 1] += ` ${attrs.unit_of_measurement}`
        if (attrs.brightness !== undefined) parts.push(`brightness: ${Math.round((attrs.brightness / 255) * 100)}%`)
        if (attrs.temperature !== undefined) parts.push(`color_temp: ${attrs.temperature}`)
        return textResult(parts.join('\n'))
      },
    },
    {
      name: 'ha_list_entities',
      label: 'List Entities',
      description: 'List Home Assistant entities, optionally filtered by domain (light, switch, sensor, automation, media_player, etc). Returns entity IDs with their current states.',
      parameters: Type.Object({
        domain: Type.Optional(Type.String({ description: 'Filter by domain, e.g. light, switch, sensor, automation, media_player' })),
      }),
      execute: async (_id: string, params: { domain?: string }) => {
        const states: any[] = await haFetch(config, '/api/states')
        let filtered = states
        if (params.domain) {
          filtered = states.filter((s: any) => s.entity_id.startsWith(params.domain + '.'))
        }
        const lines = filtered.map((s: any) => {
          const name = s.attributes?.friendly_name || s.entity_id
          return `${s.entity_id} (${name}): ${s.state}`
        })
        return textResult(lines.length > 0 ? lines.join('\n') : 'No entities found')
      },
    },
    {
      name: 'ha_call_service',
      label: 'Call Service',
      description: 'Call any Home Assistant service. Use for advanced operations like setting brightness, changing color, running scripts, triggering automations, etc. Common services: light.turn_on (with brightness_pct, color_name), media_player.play_media, automation.trigger, script.turn_on.',
      parameters: Type.Object({
        domain: Type.String({ description: 'Service domain, e.g. light, switch, media_player, automation' }),
        service: Type.String({ description: 'Service name, e.g. turn_on, turn_off, toggle, trigger' }),
        entity_id: Type.Optional(Type.String({ description: 'Target entity ID' })),
        data: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: 'Service data, e.g. { "brightness_pct": 50 }' })),
      }),
      execute: async (_id: string, params: { domain: string; service: string; entity_id?: string; data?: Record<string, any> }) => {
        const body: any = { ...params.data }
        if (params.entity_id) body.entity_id = params.entity_id
        const result = await haFetch(config, `/api/services/${params.domain}/${params.service}`, {
          method: 'POST',
          body: JSON.stringify(body),
        })
        const affected = Array.isArray(result) ? result.length : 0
        return textResult(`Called ${params.domain}.${params.service}${params.entity_id ? ` on ${params.entity_id}` : ''} (${affected} entities affected)`)
      },
    },
    {
      name: 'ha_turn_on',
      label: 'Turn On',
      description: 'Turn on a light, switch, or other entity. For lights, you can optionally set brightness (0-100%).',
      parameters: Type.Object({
        entity_id: Type.String({ description: 'Entity to turn on, e.g. light.bedroom, switch.fan' }),
        brightness_pct: Type.Optional(Type.Number({ description: 'Brightness percentage 0-100 (lights only)' })),
      }),
      execute: async (_id: string, params: { entity_id: string; brightness_pct?: number }) => {
        const domain = params.entity_id.split('.')[0]
        const body: any = { entity_id: params.entity_id }
        if (params.brightness_pct !== undefined) body.brightness_pct = params.brightness_pct
        await haFetch(config, `/api/services/${domain}/turn_on`, {
          method: 'POST',
          body: JSON.stringify(body),
        })
        const extra = params.brightness_pct !== undefined ? ` at ${params.brightness_pct}%` : ''
        return textResult(`Turned on ${params.entity_id}${extra}`)
      },
    },
    {
      name: 'ha_turn_off',
      label: 'Turn Off',
      description: 'Turn off a light, switch, or other entity.',
      parameters: Type.Object({
        entity_id: Type.String({ description: 'Entity to turn off, e.g. light.bedroom, switch.fan' }),
      }),
      execute: async (_id: string, params: { entity_id: string }) => {
        const domain = params.entity_id.split('.')[0]
        await haFetch(config, `/api/services/${domain}/turn_off`, {
          method: 'POST',
          body: JSON.stringify({ entity_id: params.entity_id }),
        })
        return textResult(`Turned off ${params.entity_id}`)
      },
    },
    {
      name: 'ha_toggle',
      label: 'Toggle',
      description: 'Toggle a light, switch, or other entity (on→off or off→on).',
      parameters: Type.Object({
        entity_id: Type.String({ description: 'Entity to toggle, e.g. light.bedroom, switch.fan' }),
      }),
      execute: async (_id: string, params: { entity_id: string }) => {
        const domain = params.entity_id.split('.')[0]
        await haFetch(config, `/api/services/${domain}/toggle`, {
          method: 'POST',
          body: JSON.stringify({ entity_id: params.entity_id }),
        })
        const state = await haFetch(config, `/api/states/${params.entity_id}`)
        return textResult(`Toggled ${params.entity_id} → now ${state.state}`)
      },
    },
    {
      name: 'ha_trigger_automation',
      label: 'Trigger Automation',
      description: 'Trigger a Home Assistant automation by entity ID.',
      parameters: Type.Object({
        entity_id: Type.String({ description: 'Automation entity ID, e.g. automation.morning_lights' }),
      }),
      execute: async (_id: string, params: { entity_id: string }) => {
        await haFetch(config, '/api/services/automation/trigger', {
          method: 'POST',
          body: JSON.stringify({ entity_id: params.entity_id }),
        })
        return textResult(`Triggered ${params.entity_id}`)
      },
    },
  ]

  return tools
}
