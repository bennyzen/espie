export interface ValidationResult {
  module: string
  loaded: boolean
  version?: string
  error?: string
  test?: string
}

async function tryImport(specifier: string): Promise<any> {
  return import(specifier)
}

export async function validateNativeModules(): Promise<ValidationResult[]> {
  const results: ValidationResult[] = []

  // Test better-sqlite3
  try {
    const { default: Database } = await tryImport('better-sqlite3')
    const db = new Database(':memory:')
    const row = db.prepare('SELECT sqlite_version() as v').get() as { v: string }
    db.close()
    results.push({ module: 'better-sqlite3', loaded: true, version: row.v, test: 'SELECT sqlite_version() OK' })
  } catch (e: any) {
    results.push({ module: 'better-sqlite3', loaded: false, error: e.message })
  }

  // Test sqlite-vec
  try {
    const { default: Database } = await tryImport('better-sqlite3')
    const sqliteVec = await tryImport('sqlite-vec')
    const db = new Database(':memory:')
    sqliteVec.load(db)
    const row = db.prepare('SELECT vec_version() as v').get() as { v: string }
    db.close()
    results.push({ module: 'sqlite-vec', loaded: true, version: row.v, test: 'SELECT vec_version() OK' })
  } catch (e: any) {
    results.push({ module: 'sqlite-vec', loaded: false, error: e.message })
  }

  // Test onnxruntime-node (this is the high-risk one on Pi 4)
  try {
    const ort = await tryImport('onnxruntime-node')
    results.push({ module: 'onnxruntime-node', loaded: true, version: ort.env?.versions?.onnxruntime || 'unknown', test: 'import() OK' })
  } catch (e: any) {
    results.push({ module: 'onnxruntime-node', loaded: false, error: e.message })
  }

  // Test @discordjs/opus (native)
  try {
    const opus = await tryImport('@discordjs/opus')
    const OpusEncoder = opus.OpusEncoder || opus.default?.OpusEncoder
    const encoder = new OpusEncoder(16000, 1)
    const silence = Buffer.alloc(320 * 2) // 20ms of 16kHz mono PCM silence
    const encoded = encoder.encode(silence, 320)
    const decoded = encoder.decode(encoded, 320)
    results.push({
      module: '@discordjs/opus',
      loaded: true,
      test: `encode(${silence.length}B) -> ${encoded.length}B, decode -> ${decoded.length}B`,
    })
  } catch (e: any) {
    results.push({ module: '@discordjs/opus', loaded: false, error: e.message })
  }

  // Test opusscript (WASM fallback -- should always work)
  try {
    const opusscript = await tryImport('opusscript')
    const OpusScript = opusscript.default || opusscript
    const encoder = new OpusScript(16000, 1, OpusScript.Application.AUDIO)
    encoder.delete()
    results.push({ module: 'opusscript', loaded: true, test: 'WASM encoder created and destroyed' })
  } catch (e: any) {
    results.push({ module: 'opusscript', loaded: false, error: e.message })
  }

  return results
}
