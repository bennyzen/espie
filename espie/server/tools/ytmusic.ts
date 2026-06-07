/**
 * YouTube Music tool — search and download via yt-dlp subprocess.
 * Returns an AgentTool that the voice agent can call to play music.
 * Downloads are cached in YTMUSIC_DIR to avoid redundant fetches.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import * as path from 'node:path'
import { Type } from '@sinclair/typebox'
import type { AgentTool } from '@earendil-works/pi-agent-core'

const execFileAsync = promisify(execFile)

function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
}

/** Strip YouTube junk from video title: "(Official Music Video)", artist name suffix/prefix, etc. */
function cleanTitle(rawTitle: string, artist: string): string {
  const escaped = artist.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return rawTitle
    // Remove parenthesized/bracketed tags: (Official Music Video), [Official Audio], (Lyrics), etc.
    .replace(/[\(\[]\s*(official\s*(music\s*)?video|official\s*audio|music\s*video|lyric\s*video|lyrics?|audio|visualizer|animated\s*video|live|hd|hq|remastered|ft\.?[^)\]]*)\s*[\)\]]/gi, '')
    // Remove "ArtistName - " prefix (common: "The Blaze - TERRITORY")
    .replace(new RegExp(`^${escaped}\\s*[-|]\\s*`, 'i'), '')
    // Remove " - ArtistName" or " | ArtistName" suffix
    .replace(new RegExp(`\\s*[-|]\\s*${escaped}\\s*$`, 'i'), '')
    // Remove " by ArtistName" suffix
    .replace(new RegExp(`\\s+by\\s+${escaped}\\s*$`, 'i'), '')
    // Clean up trailing/leading dashes and whitespace
    .replace(/\s*[-|]\s*$/, '')
    .replace(/^\s*[-|]\s*/, '')
    .trim()
}

interface YTMusicDetails {
  id?: string
  title?: string
  artist?: string
  path?: string
  error?: string
}

/**
 * Create a YouTube Music AgentTool that searches and downloads via yt-dlp.
 * Downloads MP3 files to YTMUSIC_DIR (default: ./data/ytmusic).
 * The VoicePipeline handles MP3->PCM->Opus conversion and streaming to device.
 */
/**
 * Create a tool that lists all downloaded tracks in the music library.
 */
export function createListMusicTool(): AgentTool<any> {
  const ytmusicDir = process.env.YTMUSIC_DIR || './data/ytmusic'

  return {
    name: 'list_music',
    label: 'list_music',
    description:
      'List all downloaded songs in the music library. Use this when the user asks what music is available, what songs have been downloaded, or wants to browse their library.',
    parameters: Type.Object({}),
    execute: async () => {
      try {
        if (!existsSync(ytmusicDir)) {
          return { content: [{ type: 'text' as const, text: 'Music library is empty — no songs downloaded yet.' }], details: {} }
        }
        const files = readdirSync(ytmusicDir).filter(f => f.endsWith('.mp3'))
        if (files.length === 0) {
          return { content: [{ type: 'text' as const, text: 'Music library is empty — no songs downloaded yet.' }], details: {} }
        }
        const tracks = files.map((filename) => {
          const match = filename.match(/^(.+?) - (.+?) \[.+?\]\.mp3$/)
          return match ? `${match[1]} — ${match[2]}` : filename.replace('.mp3', '')
        }).sort((a, b) => a.localeCompare(b))

        return {
          content: [{ type: 'text' as const, text: `Music library (${tracks.length} tracks):\n${tracks.map(t => `• ${t}`).join('\n')}` }],
          details: { count: tracks.length },
        }
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Could not list music library: ${err.message}` }], details: { error: err.message } }
      }
    },
  }
}

export function createYTMusicTool(): AgentTool<any> {
  const ytmusicDir = process.env.YTMUSIC_DIR || './data/ytmusic'

  // Ensure download directory exists
  if (!existsSync(ytmusicDir)) {
    mkdirSync(ytmusicDir, { recursive: true })
  }

  return {
    name: 'play_music',
    label: 'play_music',
    description:
      'Search YouTube Music and play a song. Provide a search query like artist name, song title, or genre.',
    parameters: Type.Object({
      query: Type.String({ description: 'Search query for music' }),
    }),
    execute: async (
      _toolCallId: string,
      params: { query: string },
      _signal?: AbortSignal,
    ): Promise<{ content: Array<{ type: string; text: string }>; details: YTMusicDetails }> => {
      try {
        // Step 1: Search via yt-dlp
        const searchResult = await execFileAsync(
          'yt-dlp',
          [`ytsearch1:${params.query}`, '--dump-json', '--no-download'],
          { timeout: 15000 },
        )

        const metadata = JSON.parse(searchResult.stdout)
        const id = metadata.id
        const title = metadata.title || 'Unknown Title'
        const artist = metadata.uploader || metadata.channel || 'Unknown Artist'

        // Step 2: Check cache by video ID (supports both old and new naming)
        const cached = readdirSync(ytmusicDir).find(f => f.includes(`[${id}]`) || f === `${id}.mp3`)
        if (cached) {
          return {
            content: [{ type: 'text', text: `Now playing: ${title} by ${artist}` }],
            details: { id, title, artist, path: path.join(ytmusicDir, cached) },
          }
        }

        // Step 3: Download as MP3 with descriptive filename
        const cleanedTitle = cleanTitle(title, artist)
        const safeName = `${sanitizeFilename(cleanedTitle || title)} - ${sanitizeFilename(artist)} [${id}].mp3`
        const outputPath = path.join(ytmusicDir, safeName)
        const url = `https://www.youtube.com/watch?v=${id}`
        await execFileAsync(
          'yt-dlp',
          [url, '-x', '--audio-format', 'mp3', '--audio-quality', '128K', '-o', outputPath, '--no-playlist'],
          { timeout: 120000 },
        )

        return {
          content: [{ type: 'text', text: `Now playing: ${title} by ${artist}` }],
          details: { id, title, artist, path: outputPath },
        }
      } catch (err: any) {
        return {
          content: [
            {
              type: 'text',
              text: `Sorry, could not play that music: ${err.message || String(err)}`,
            },
          ],
          details: { error: err.message || String(err) },
        }
      }
    },
  }
}
