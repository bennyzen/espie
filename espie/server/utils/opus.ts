// Opus Codec Abstraction
// Tries native @discordjs/opus first, falls back to opusscript (WASM).
// Uses dynamic import() because Nitro bundles as ESM where require() is unavailable.

export interface OpusCodec {
  encode(pcm: Buffer, frameSize: number): Buffer
  decode(opus: Buffer, frameSize: number): Buffer
  destroy(): void
}

// Cache on globalThis so native modules survive Nuxt HMR re-evaluation.
let _backend: 'native' | 'wasm' | null = (globalThis as any).__opus_backend || null
let _nativeModule: any = (globalThis as any).__opus_native || null
let _wasmModule: any = (globalThis as any).__opus_wasm || null

/**
 * Detect which Opus backend is available and preload its module.
 * Returns 'native' if @discordjs/opus is installed, otherwise 'wasm' (opusscript).
 */
async function resolveBackend(): Promise<'native' | 'wasm'> {
  if (_backend) return _backend
  try {
    _nativeModule = await import('@discordjs/opus')
    _backend = 'native'
  } catch {
    try {
      _wasmModule = await import('opusscript')
      _backend = 'wasm'
    } catch {
      throw new Error('No Opus backend available: install @discordjs/opus or opusscript')
    }
  }
  ;(globalThis as any).__opus_backend = _backend
  ;(globalThis as any).__opus_native = _nativeModule
  ;(globalThis as any).__opus_wasm = _wasmModule
  return _backend
}

/**
 * Create an Opus encoder/decoder with the given sample rate and channel count.
 * Automatically selects the best available backend (native or WASM).
 */
export async function createOpusCodec(sampleRate: number, channels: number): Promise<OpusCodec> {
  const backend = await resolveBackend()

  if (backend === 'native') {
    const ns = _nativeModule.default || _nativeModule
    const OpusEncoder = ns.OpusEncoder || ns
    const encoder = new OpusEncoder(sampleRate, channels)
    return {
      encode: (pcm: Buffer, frameSize: number): Buffer => encoder.encode(pcm, frameSize),
      decode: (opus: Buffer, frameSize: number): Buffer => encoder.decode(opus, frameSize),
      destroy: () => {},
    }
  }

  // WASM fallback via opusscript
  const OpusScript = _wasmModule.default || _wasmModule
  const encoder = new OpusScript(sampleRate, channels, OpusScript.Application.AUDIO)
  return {
    encode: (pcm: Buffer, frameSize: number): Buffer => Buffer.from(encoder.encode(pcm, frameSize)),
    decode: (opus: Buffer, _frameSize: number): Buffer => Buffer.from(encoder.decode(opus)),
    destroy: () => encoder.delete(),
  }
}
