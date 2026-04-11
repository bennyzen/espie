// TTS Providers — Edge TTS (default) and OpenAI TTS (alternative).
// Each factory returns a TTSProvider with a synthesize method.

import { Communicate } from 'edge-tts-universal'
import OpenAI from 'openai'
import { resolveVoice } from '../utils/language-voice'

export interface TTSProvider {
  synthesize(text: string, signal?: AbortSignal): Promise<Buffer>
  /** Set the language for all subsequent synthesize calls until cleared. */
  setLanguage(lang: string | null): void
}

/**
 * Create a TTS provider backed by Microsoft Edge TTS.
 * Language is set externally (from the user's ASR transcription) and applies
 * to every sentence in the response — no per-sentence detection.
 */
export function createEdgeTTS(voiceOverride?: string): TTSProvider {
  const defaultVoice = voiceOverride || process.env.TTS_VOICE || 'en-US-AriaNeural'
  let lang: string | null = null

  return {
    setLanguage(l: string | null) { lang = l },

    async synthesize(text: string, signal?: AbortSignal): Promise<Buffer> {
      if (signal?.aborted) {
        throw new Error('Aborted')
      }

      const voice = resolveVoice(text, defaultVoice, lang)
      if (voice !== defaultVoice) {
        console.log(`[tts] ${lang}: "${text.slice(0, 50)}…" → ${voice}`)
      }

      const communicate = new Communicate(text, { voice })
      const mp3Chunks: Buffer[] = []

      for await (const chunk of communicate.stream()) {
        if (signal?.aborted) {
          throw new Error('Aborted')
        }
        if (chunk.type === 'audio' && chunk.data) {
          mp3Chunks.push(Buffer.from(chunk.data))
        }
      }

      if (mp3Chunks.length === 0) {
        throw new Error(`TTS produced no audio for text: "${text.slice(0, 50)}"`)
      }

      return Buffer.concat(mp3Chunks)
    },
  }
}

/**
 * Create a TTS provider backed by OpenAI TTS.
 * Requires OPENAI_API_KEY environment variable.
 * Uses TTS_OPENAI_VOICE env var, defaulting to 'nova'.
 */
export function createOpenAITTS(voiceOverride?: string): TTSProvider {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is required for OpenAI TTS')
  }

  const openai = new OpenAI({ apiKey })
  const voice = (voiceOverride || process.env.TTS_OPENAI_VOICE || 'nova') as 'nova' | 'alloy' | 'echo' | 'fable' | 'onyx' | 'shimmer'

  return {
    setLanguage() {},

    async synthesize(text: string, signal?: AbortSignal): Promise<Buffer> {
      if (signal?.aborted) {
        throw new Error('Aborted')
      }

      const response = await openai.audio.speech.create({
        model: 'tts-1',
        voice,
        input: text,
        response_format: 'mp3',
      })

      const arrayBuffer = await response.arrayBuffer()
      return Buffer.from(arrayBuffer)
    },
  }
}

/**
 * Backward-compatible factory — creates the default Edge TTS provider.
 * Existing code importing { createTTS } from './tts' continues to work.
 */
export function createTTS(): TTSProvider {
  return createEdgeTTS()
}
