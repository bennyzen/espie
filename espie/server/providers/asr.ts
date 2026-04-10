// ASR Providers — Groq Whisper (default) and OpenAI Whisper (alternative).
// Each factory returns an ASRProvider with a transcribe method.

import Groq from 'groq-sdk'
import OpenAI from 'openai'
import { createWavHeader } from '../utils/audio-converter'

export interface ASRProvider {
  transcribe(pcmData: Buffer, sampleRate?: number): Promise<string>
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
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) {
    throw new Error('GROQ_API_KEY environment variable is required for ASR')
  }

  const groq = new Groq({ apiKey })
  const asrModel = model || 'whisper-large-v3-turbo'

  return {
    async transcribe(pcmData: Buffer, sampleRate = 16000): Promise<string> {
      // Wrap raw PCM in a WAV header for the Groq API
      const wavHeader = createWavHeader(pcmData.length, sampleRate, 1, 16)
      const wavBuffer = Buffer.concat([wavHeader, pcmData])

      const file = new File([wavBuffer], 'audio.wav', { type: 'audio/wav' })

      const transcription = await groq.audio.transcriptions.create({
        file,
        model: asrModel,
        language: 'en',
        temperature: 0.0,
        response_format: 'json',
      })

      return transcription.text
    },
  }
}

/**
 * Create an ASR provider backed by OpenAI Whisper.
 * Requires OPENAI_API_KEY environment variable.
 */
export function createOpenAIASR(): ASRProvider {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is required for OpenAI ASR')
  }

  const openai = new OpenAI({ apiKey })

  return {
    async transcribe(pcmData: Buffer, sampleRate = 16000): Promise<string> {
      // Wrap raw PCM in a WAV header for the OpenAI API
      const wavHeader = createWavHeader(pcmData.length, sampleRate, 1, 16)
      const wavBuffer = Buffer.concat([wavHeader, pcmData])

      const file = new File([wavBuffer], 'audio.wav', { type: 'audio/wav' })

      const transcription = await openai.audio.transcriptions.create({
        file,
        model: 'whisper-1',
        language: 'en',
      })

      return transcription.text
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
