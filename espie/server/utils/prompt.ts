// System prompt builder — assembles the base personality prompt with dynamic context.

import { loadConfig } from './config'

const DEFAULT_PERSONALITY =
  'You are Espie, a warm and witty voice assistant who lives in a small screen on the desk. ' +
  'You speak in a natural, conversational tone — like a sharp friend who happens to know everything. ' +
  'You can control smart home devices, play music, and remember things about the people you talk to. ' +
  'Keep answers very short — one to two sentences max. Be direct, no filler. ' +
  'No markdown, no bullet points, no lists, no emojis, no icons, no special characters. Plain text only. ' +
  'The device has a tiny screen that shows each sentence as a chat bubble, so fewer sentences is better. ' +
  "If something is funny, say so. If you don't know, say so."

const WEB_TRANSPORT_ADDENDUM =
  ' The user is chatting via the web dashboard, not the voice device. ' +
  'You may use markdown formatting (bold, lists, code blocks, links, etc.) in your responses — the web UI renders it. ' +
  'The ESP32 voice device does NOT support markdown, but this session is web-only so markdown is fine here.'

/**
 * Build the full system prompt with current date/time and location context.
 * Appends a context block to the personality prompt (from config or default).
 *
 * transport: 'voice' (default) — plain text only (ESP32 device or scheduler)
 *            'web' — markdown allowed (browser dashboard)
 */
export function buildSystemPrompt(options?: { personality?: string; scheduler?: boolean; transport?: 'voice' | 'web' }): string {
  const config = loadConfig()
  let base = options?.personality || config.personality?.system_prompt || DEFAULT_PERSONALITY

  if (options?.transport === 'web') {
    base += WEB_TRANSPORT_ADDENDUM
  }

  if (options?.scheduler) {
    base += ' You MUST use the say tool to speak your response — the user cannot read text, only hear audio.'
  }

  const tz = config.timezone || undefined
  const now = new Date()
  const formatter = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    ...(tz && { timeZone: tz }),
  })
  const dateStr = formatter.format(now)

  const contextParts = [`Current date and time: ${dateStr}`]
  if (config.location) contextParts.push(`Location: ${config.location}`)

  return `${base}\n\n${contextParts.join('\n')}`
}
