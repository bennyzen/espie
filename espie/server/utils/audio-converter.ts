// Audio Converter — MP3 to PCM conversion via ffmpeg, PCM to Opus frame encoding, WAV header creation.
// Used in the TTS output pipeline: Edge TTS (MP3) -> PCM (ffmpeg) -> Opus frames (codec) -> device.

import { spawn } from 'child_process'
import type { OpusCodec } from './opus'

/**
 * Convert MP3 audio buffer to 24kHz mono 16-bit PCM using ffmpeg subprocess.
 * Spawns ffmpeg with array args (no shell injection risk).
 * Supports optional AbortSignal to cancel mid-conversion.
 */
export function mp3ToPcm(mp3Data: Buffer, signal?: AbortSignal): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Aborted'))
      return
    }

    const proc = spawn('ffmpeg', [
      '-i', 'pipe:0',
      '-f', 's16le',
      '-acodec', 'pcm_s16le',
      '-ar', '24000',
      '-ac', '1',
      '-loglevel', 'error',
      'pipe:1',
    ], { stdio: ['pipe', 'pipe', 'pipe'] })

    const chunks: Buffer[] = []
    const stderrChunks: Buffer[] = []

    proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    proc.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk))

    const onAbort = () => {
      proc.kill('SIGKILL')
      reject(new Error('Aborted'))
    }

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true })
    }

    proc.on('close', (code) => {
      if (signal) {
        signal.removeEventListener('abort', onAbort)
      }
      if (code === 0) {
        resolve(Buffer.concat(chunks))
      } else {
        const stderr = Buffer.concat(stderrChunks).toString()
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`))
      }
    })

    proc.on('error', (err) => {
      if (signal) {
        signal.removeEventListener('abort', onAbort)
      }
      reject(err)
    })

    proc.stdin.write(mp3Data)
    proc.stdin.end()
  })
}

/**
 * Split PCM data into 60ms frames at 24kHz and encode each to Opus.
 * 60ms at 24000 Hz = 1440 samples per frame.
 * Each Int16 sample = 2 bytes, so frame size in bytes = 1440 * 2 = 2880.
 */
export function pcmToOpusFrames(pcmData: Buffer, codec: OpusCodec): Buffer[] {
  const FRAME_SIZE = 1440    // samples per 60ms at 24kHz
  const FRAME_BYTES = 2880   // 1440 * 2 bytes per Int16 sample
  const frames: Buffer[] = []

  for (let offset = 0; offset + FRAME_BYTES <= pcmData.length; offset += FRAME_BYTES) {
    const pcmFrame = pcmData.subarray(offset, offset + FRAME_BYTES)
    const opusFrame = codec.encode(pcmFrame, FRAME_SIZE)
    frames.push(opusFrame)
  }

  return frames
}

/**
 * Create a WAV file header for raw PCM data.
 * Used to wrap PCM audio for Groq Whisper ASR (expects WAV input).
 */
export function createWavHeader(
  dataLength: number,
  sampleRate: number,
  channels: number,
  bitsPerSample: number,
): Buffer {
  const header = Buffer.alloc(44)
  const byteRate = sampleRate * channels * (bitsPerSample / 8)
  const blockAlign = channels * (bitsPerSample / 8)

  // RIFF header
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + dataLength, 4)     // file size - 8
  header.write('WAVE', 8)

  // fmt chunk
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)                  // fmt chunk size
  header.writeUInt16LE(1, 20)                   // audio format: PCM = 1
  header.writeUInt16LE(channels, 22)            // number of channels
  header.writeUInt32LE(sampleRate, 24)          // sample rate
  header.writeUInt32LE(byteRate, 28)            // byte rate
  header.writeUInt16LE(blockAlign, 32)          // block align
  header.writeUInt16LE(bitsPerSample, 34)       // bits per sample

  // data chunk
  header.write('data', 36)
  header.writeUInt32LE(dataLength, 40)          // data size

  return header
}
