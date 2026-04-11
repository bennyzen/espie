// Language-aware voice selection for Edge TTS.
// Maps Whisper-detected language codes (ISO 639-1) to Edge TTS voices,
// preserving gender when switching away from the configured voice.
// No text-based detection — language comes from the ASR provider.

type Gender = 'male' | 'female'

// Edge TTS voices per language (ISO 639-1 key), with gender variants.
const LANGUAGE_VOICES: Record<string, Record<Gender, string>> = {
  it: { male: 'it-IT-DiegoNeural', female: 'it-IT-ElsaNeural' },
  fr: { male: 'fr-FR-HenriNeural', female: 'fr-FR-DeniseNeural' },
  de: { male: 'de-DE-ConradNeural', female: 'de-DE-KatjaNeural' },
  es: { male: 'es-ES-AlvaroNeural', female: 'es-ES-ElviraNeural' },
  pt: { male: 'pt-BR-AntonioNeural', female: 'pt-BR-FranciscaNeural' },
  nl: { male: 'nl-NL-MaartenNeural', female: 'nl-NL-ColetteNeural' },
  pl: { male: 'pl-PL-MarekNeural', female: 'pl-PL-AgnieszkaNeural' },
  ru: { male: 'ru-RU-DmitryNeural', female: 'ru-RU-SvetlanaNeural' },
  ja: { male: 'ja-JP-KeitaNeural', female: 'ja-JP-NanamiNeural' },
  zh: { male: 'zh-CN-YunxiNeural', female: 'zh-CN-XiaoxiaoNeural' },
  ko: { male: 'ko-KR-InJoonNeural', female: 'ko-KR-SunHiNeural' },
  ar: { male: 'ar-SA-HamedNeural', female: 'ar-SA-ZariyahNeural' },
  hi: { male: 'hi-IN-MadhurNeural', female: 'hi-IN-SwaraNeural' },
  tr: { male: 'tr-TR-AhmetNeural', female: 'tr-TR-EmelNeural' },
  uk: { male: 'uk-UA-OstapNeural', female: 'uk-UA-PolinaNeural' },
  sv: { male: 'sv-SE-MattiasNeural', female: 'sv-SE-SofieNeural' },
  da: { male: 'da-DK-JeppeNeural', female: 'da-DK-ChristelNeural' },
  nb: { male: 'nb-NO-FinnNeural', female: 'nb-NO-PernilleNeural' },
  no: { male: 'nb-NO-FinnNeural', female: 'nb-NO-PernilleNeural' },
  fi: { male: 'fi-FI-HarriNeural', female: 'fi-FI-NooraNeural' },
  cs: { male: 'cs-CZ-AntoninNeural', female: 'cs-CZ-VlastaNeural' },
  el: { male: 'el-GR-NestorasNeural', female: 'el-GR-AthinaNeural' },
  ro: { male: 'ro-RO-EmilNeural', female: 'ro-RO-AlinaNeural' },
  hu: { male: 'hu-HU-TamasNeural', female: 'hu-HU-NoemiNeural' },
  bg: { male: 'bg-BG-BorislavNeural', female: 'bg-BG-KalinaNeural' },
  hr: { male: 'hr-HR-SreckoNeural', female: 'hr-HR-GabrijelaNeural' },
  sk: { male: 'sk-SK-LukasNeural', female: 'sk-SK-ViktoriaNeural' },
  ca: { male: 'ca-ES-EnricNeural', female: 'ca-ES-JoanaNeural' },
  id: { male: 'id-ID-ArdiNeural', female: 'id-ID-GadisNeural' },
  ms: { male: 'ms-MY-OsmanNeural', female: 'ms-MY-YasminNeural' },
  vi: { male: 'vi-VN-NamMinhNeural', female: 'vi-VN-HoaiMyNeural' },
  th: { male: 'th-TH-NiwatNeural', female: 'th-TH-PremwadeeNeural' },
}

// Known male voice names (used to infer gender from voice ID for gender matching)
const MALE_NAMES = new Set([
  'Andrew', 'Brian', 'Ryan', 'William', 'Diego', 'Henri', 'Conrad',
  'Alvaro', 'Antonio', 'Maarten', 'Marek', 'Dmitry', 'Keita', 'Yunxi',
  'InJoon', 'Hamed', 'Madhur', 'Ahmet', 'Ostap', 'Mattias', 'Jeppe',
  'Finn', 'Harri', 'Antonin', 'Nestoras', 'Emil', 'Tamas', 'Borislav',
  'Srecko', 'Lukas', 'Enric', 'Ardi', 'Osman', 'NamMinh', 'Niwat',
])

function inferGender(voiceId: string): Gender {
  // Extract the name portion: "en-US-AndrewMultilingualNeural" → "Andrew"
  const parts = voiceId.split('-')
  if (parts.length >= 3) {
    const namePart = parts.slice(2).join('-').replace('MultilingualNeural', '').replace('Neural', '')
    if (MALE_NAMES.has(namePart)) return 'male'
  }
  return 'female'
}

/**
 * Pick the best Edge TTS voice for the given language (ISO 639-1 from Whisper).
 * Returns the configured voice if the language matches or is unknown.
 * Switches to a language-appropriate voice otherwise, preserving gender.
 */
export function resolveVoice(_text: string, configuredVoice: string, lang?: string | null): string {
  if (!lang) return configuredVoice

  // Multilingual voices handle any language natively
  if (configuredVoice.includes('Multilingual')) return configuredVoice

  // If detected language matches the configured voice's language prefix, keep it
  const voiceLangPrefix = configuredVoice.split('-')[0]
  if (lang === voiceLangPrefix) return configuredVoice

  // Switch to a voice matching the detected language + same gender
  const voices = LANGUAGE_VOICES[lang]
  if (!voices) return configuredVoice

  const gender = inferGender(configuredVoice)
  return voices[gender]
}
