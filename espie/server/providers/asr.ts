// ASR Providers — Groq Whisper (default) and OpenAI Whisper (alternative).
// Each factory returns an ASRProvider with a transcribe method.

import Groq from 'groq-sdk'
import OpenAI from 'openai'
import { createWavHeader } from '../utils/audio-converter'
import { loadConfig } from '../utils/config'

export interface ASRResult {
  text: string
  language: string | null  // ISO 639-1 code (e.g. 'en', 'it', 'fr') or null if unknown
}

export interface ASRProvider {
  transcribe(pcmData: Buffer, sampleRate?: number): Promise<ASRResult>
}

// Whisper returns full language names ("English", "Italian"), not ISO codes.
// Map to ISO 639-1 for Edge TTS voice selection.
const WHISPER_LANG_TO_ISO: Record<string, string> = {
  english: 'en', italian: 'it', french: 'fr', german: 'de', spanish: 'es',
  portuguese: 'pt', dutch: 'nl', polish: 'pl', russian: 'ru', japanese: 'ja',
  chinese: 'zh', korean: 'ko', arabic: 'ar', hindi: 'hi', turkish: 'tr',
  ukrainian: 'uk', swedish: 'sv', danish: 'da', norwegian: 'no', finnish: 'fi',
  czech: 'cs', greek: 'el', romanian: 'ro', hungarian: 'hu', bulgarian: 'bg',
  croatian: 'hr', slovak: 'sk', catalan: 'ca', indonesian: 'id', malay: 'ms',
  vietnamese: 'vi', thai: 'th', hebrew: 'he', persian: 'fa', tamil: 'ta',
  telugu: 'te', bengali: 'bn', urdu: 'ur', filipino: 'tl', swahili: 'sw',
}

function normalizeLanguage(whisperLang: string | undefined | null): string | null {
  if (!whisperLang) return null
  return WHISPER_LANG_TO_ISO[whisperLang.toLowerCase()] || null
}

// Available Groq ASR models
export const GROQ_ASR_MODELS = [
  { id: 'whisper-large-v3-turbo', name: 'Whisper Large V3 Turbo (recommended)' },
  { id: 'whisper-large-v3', name: 'Whisper Large V3' },
  { id: 'distil-whisper-large-v3-en', name: 'Distil Whisper Large V3 (English, fastest)' },
]

/**
 * Create an ASR provider backed by Groq Whisper.
 * Requires GROQ_API_KEY environment variable.
 */
export function createGroqASR(model?: string): ASRProvider {
  // Resolve the key the same way the LLM does: config (set via the /config UI,
  // stored in data/.config.yaml api_keys.groq) first, then the env var.
  const apiKey = loadConfig().api_keys?.groq || process.env.GROQ_API_KEY
  if (!apiKey) {
    throw new Error('Groq API key not set — add it in the /config page (api_keys.groq) or set GROQ_API_KEY')
  }

  const groq = new Groq({ apiKey })
  const asrModel = model || 'whisper-large-v3-turbo'

  return {
    async transcribe(pcmData: Buffer, sampleRate = 16000): Promise<ASRResult> {
      // Wrap raw PCM in a WAV header for the Groq API
      const wavHeader = createWavHeader(pcmData.length, sampleRate, 1, 16)
      const wavBuffer = Buffer.concat([wavHeader, pcmData])

      const file = new File([wavBuffer], 'audio.wav', { type: 'audio/wav' })

      const transcription = await groq.audio.transcriptions.create({
        file,
        model: asrModel,
        temperature: 0.0,
        response_format: 'verbose_json',
      })

      const text = typeof transcription.text === 'string' ? transcription.text
        : typeof transcription === 'string' ? transcription : ''

      return {
        text,
        language: normalizeLanguage((transcription as any).language),
      }
    },
  }
}

/**
 * Create an ASR provider backed by OpenAI Whisper.
 * Requires OPENAI_API_KEY environment variable.
 */
export function createOpenAIASR(): ASRProvider {
  const apiKey = loadConfig().api_keys?.openai || process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OpenAI API key not set — add it in the /config page (api_keys.openai) or set OPENAI_API_KEY')
  }

  const openai = new OpenAI({ apiKey })

  return {
    async transcribe(pcmData: Buffer, sampleRate = 16000): Promise<ASRResult> {
      // Wrap raw PCM in a WAV header for the OpenAI API
      const wavHeader = createWavHeader(pcmData.length, sampleRate, 1, 16)
      const wavBuffer = Buffer.concat([wavHeader, pcmData])

      const file = new File([wavBuffer], 'audio.wav', { type: 'audio/wav' })

      const transcription = await openai.audio.transcriptions.create({
        file,
        model: 'whisper-1',
        response_format: 'verbose_json',
      })

      const text = typeof transcription.text === 'string' ? transcription.text
        : typeof transcription === 'string' ? transcription : ''

      return {
        text,
        language: normalizeLanguage((transcription as any).language),
      }
    },
  }
}

/**
 * Backward-compatible factory — creates the default Groq ASR provider.
 * Existing code importing { createASR } from './asr' continues to work.
 */
export function createASR(): ASRProvider {
  return createGroqASR()
}
