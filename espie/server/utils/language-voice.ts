// Language-aware voice selection for Edge TTS.
// Detects language via trigram analysis (franc-min) and maps to an appropriate
// Edge TTS voice, preserving gender when switching away from the configured voice.

import { franc } from 'franc-min'

type Gender = 'male' | 'female'

// Edge TTS voices per language, with gender variants.
// These are high-quality Neural voices available in Microsoft Edge TTS.
const LANGUAGE_VOICES: Record<string, Record<Gender, string>> = {
  ita: { male: 'it-IT-DiegoNeural', female: 'it-IT-ElsaNeural' },
  fra: { male: 'fr-FR-HenriNeural', female: 'fr-FR-DeniseNeural' },
  deu: { male: 'de-DE-ConradNeural', female: 'de-DE-KatjaNeural' },
  spa: { male: 'es-ES-AlvaroNeural', female: 'es-ES-ElviraNeural' },
  por: { male: 'pt-BR-AntonioNeural', female: 'pt-BR-FranciscaNeural' },
  nld: { male: 'nl-NL-MaartenNeural', female: 'nl-NL-ColetteNeural' },
  pol: { male: 'pl-PL-MarekNeural', female: 'pl-PL-AgnieszkaNeural' },
  rus: { male: 'ru-RU-DmitryNeural', female: 'ru-RU-SvetlanaNeural' },
  jpn: { male: 'ja-JP-KeitaNeural', female: 'ja-JP-NanamiNeural' },
  cmn: { male: 'zh-CN-YunxiNeural', female: 'zh-CN-XiaoxiaoNeural' },
  kor: { male: 'ko-KR-InJoonNeural', female: 'ko-KR-SunHiNeural' },
  ara: { male: 'ar-SA-HamedNeural', female: 'ar-SA-ZariyahNeural' },
  hin: { male: 'hi-IN-MadhurNeural', female: 'hi-IN-SwaraNeural' },
  tur: { male: 'tr-TR-AhmetNeural', female: 'tr-TR-EmelNeural' },
  ukr: { male: 'uk-UA-OstapNeural', female: 'uk-UA-PolinaNeural' },
  swe: { male: 'sv-SE-MattiasNeural', female: 'sv-SE-SofieNeural' },
  dan: { male: 'da-DK-JeppeNeural', female: 'da-DK-ChristelNeural' },
  nob: { male: 'nb-NO-FinnNeural', female: 'nb-NO-PernilleNeural' },
  nno: { male: 'nb-NO-FinnNeural', female: 'nb-NO-PernilleNeural' },
  fin: { male: 'fi-FI-HarriNeural', female: 'fi-FI-NooraNeural' },
  ces: { male: 'cs-CZ-AntoninNeural', female: 'cs-CZ-VlastaNeural' },
  ell: { male: 'el-GR-NestorasNeural', female: 'el-GR-AthinaNeural' },
  ron: { male: 'ro-RO-EmilNeural', female: 'ro-RO-AlinaNeural' },
  hun: { male: 'hu-HU-TamasNeural', female: 'hu-HU-NoemiNeural' },
  bul: { male: 'bg-BG-BorislavNeural', female: 'bg-BG-KalinaNeural' },
  hrv: { male: 'hr-HR-SreckoNeural', female: 'hr-HR-GabrijelaNeural' },
  slk: { male: 'sk-SK-LukasNeural', female: 'sk-SK-ViktoriaNeural' },
  cat: { male: 'ca-ES-EnricNeural', female: 'ca-ES-JoanaNeural' },
  ind: { male: 'id-ID-ArdiNeural', female: 'id-ID-GadisNeural' },
  msa: { male: 'ms-MY-OsmanNeural', female: 'ms-MY-YasminNeural' },
  vie: { male: 'vi-VN-NamMinhNeural', female: 'vi-VN-HoaiMyNeural' },
  tha: { male: 'th-TH-NiwatNeural', female: 'th-TH-PremwadeeNeural' },
}

// ISO 639-3 → BCP 47 language prefix (for matching against voice IDs)
const LANG_PREFIX: Record<string, string> = {
  eng: 'en', ita: 'it', fra: 'fr', deu: 'de', spa: 'es',
  por: 'pt', nld: 'nl', pol: 'pl', rus: 'ru', jpn: 'ja',
  cmn: 'zh', kor: 'ko', ara: 'ar', hin: 'hi', tur: 'tr',
  ukr: 'uk', swe: 'sv', dan: 'da', nob: 'nb', nno: 'nb',
  fin: 'fi', ces: 'cs', ell: 'el', ron: 'ro', hun: 'hu',
  bul: 'bg', hrv: 'hr', slk: 'sk', cat: 'ca', ind: 'id',
  msa: 'ms', vie: 'vi', tha: 'th',
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

// Restrict franc to languages we have voice mappings for (+ English).
// Without this, short English text can be misidentified as obscure languages
// like Zhuang (zyb) because franc-min has fewer profiles to disambiguate.
const SUPPORTED_LANGS = ['eng', ...Object.keys(LANGUAGE_VOICES)]

/**
 * Detect the language of a text string.
 * Returns ISO 639-3 code (e.g. 'ita', 'fra') or null if too short / ambiguous.
 */
export function detectLanguage(text: string): string | null {
  if (text.length < 20) return null
  const result = franc(text, { only: SUPPORTED_LANGS })
  return result === 'und' ? null : result
}

/**
 * Pick the best voice for the given language and configured voice.
 * Language is detected once from the user's speech (by the pipeline),
 * not per-sentence — avoids mid-response voice switching.
 */
export function resolveVoice(_text: string, configuredVoice: string, lang?: string | null): string {
  if (!lang) return configuredVoice

  // Multilingual voices handle any language natively
  if (configuredVoice.includes('Multilingual')) return configuredVoice

  // If detected language matches the configured voice's language, keep it
  const voiceLangPrefix = configuredVoice.split('-')[0]
  const detectedPrefix = LANG_PREFIX[lang]
  if (!detectedPrefix || detectedPrefix === voiceLangPrefix) return configuredVoice

  // Switch to a voice matching the detected language + same gender
  const voices = LANGUAGE_VOICES[lang]
  if (!voices) return configuredVoice

  const gender = inferGender(configuredVoice)
  return voices[gender]
}
