// GET /api/providers/audio — returns available ASR and TTS providers with their models/voices.

import { GROQ_ASR_MODELS } from '../../providers/asr'

export default defineEventHandler(() => {
  return {
    asr: [
      {
        id: 'groq',
        name: 'Groq Whisper',
        envVar: 'GROQ_API_KEY',
        models: GROQ_ASR_MODELS,
      },
      {
        id: 'openai',
        name: 'OpenAI Whisper',
        envVar: 'OPENAI_API_KEY',
        models: [
          { id: 'whisper-1', name: 'Whisper V2' },
        ],
      },
    ],
    tts: [
      {
        id: 'edge',
        name: 'Edge TTS (free)',
        envVar: null,
        voices: [
          { id: 'en-US-AndrewMultilingualNeural', name: 'Andrew (US, male)' },
          { id: 'en-US-AvaMultilingualNeural', name: 'Ava (US, female)' },
          { id: 'en-US-BrianMultilingualNeural', name: 'Brian (US, male)' },
          { id: 'en-US-EmmaMultilingualNeural', name: 'Emma (US, female)' },
          { id: 'en-GB-RyanNeural', name: 'Ryan (UK, male)' },
          { id: 'en-GB-SoniaNeural', name: 'Sonia (UK, female)' },
          { id: 'en-AU-NatashaNeural', name: 'Natasha (AU, female)' },
          { id: 'en-AU-WilliamNeural', name: 'William (AU, male)' },
        ],
      },
      {
        id: 'openai',
        name: 'OpenAI TTS',
        envVar: 'OPENAI_API_KEY',
        voices: [
          { id: 'alloy', name: 'Alloy' },
          { id: 'echo', name: 'Echo' },
          { id: 'fable', name: 'Fable' },
          { id: 'onyx', name: 'Onyx' },
          { id: 'nova', name: 'Nova' },
          { id: 'shimmer', name: 'Shimmer' },
        ],
      },
    ],
  }
})
