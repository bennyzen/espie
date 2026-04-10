import { readdirSync, statSync } from 'fs'
import { resolve, join } from 'path'

export default defineEventHandler(() => {
  const ytmusicDir = resolve(process.env.YTMUSIC_DIR || './data/ytmusic')

  let files: string[]
  try {
    files = readdirSync(ytmusicDir).filter(f => f.endsWith('.mp3'))
  } catch {
    return []
  }

  return files.map((filename) => {
    const filePath = join(ytmusicDir, filename)
    const stat = statSync(filePath)

    // Parse "Title - Artist [videoId].mp3"
    const match = filename.match(/^(.+?) - (.+?) \[(.+?)\]\.mp3$/)

    return {
      filename,
      title: match?.[1] || filename.replace('.mp3', ''),
      artist: match?.[2] || 'Unknown',
      videoId: match?.[3] || null,
      size: stat.size,
      createdAt: stat.mtimeMs,
    }
  }).sort((a, b) => b.createdAt - a.createdAt)
})
