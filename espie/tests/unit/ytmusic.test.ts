import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Mock setup ---
const {
  mockExecFile,
  mockExistsSync,
  mockMkdirSync,
  mockReaddirSync,
} = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
  mockExistsSync: vi.fn().mockReturnValue(false),
  mockMkdirSync: vi.fn(),
  mockReaddirSync: vi.fn().mockReturnValue([]),
}))

vi.mock('node:child_process', () => ({
  execFile: mockExecFile,
}))

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
  readdirSync: mockReaddirSync,
}))

vi.mock('node:util', () => ({
  promisify: (fn: any) => {
    // Return a function that calls our mockExecFile and returns a promise
    return (...args: any[]) => {
      return new Promise((resolve, reject) => {
        const result = mockExecFile(...args)
        if (result instanceof Error) {
          reject(result)
        } else {
          resolve(result)
        }
      })
    }
  },
}))

import { createYTMusicTool } from '../../server/tools/ytmusic'

describe('createYTMusicTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExistsSync.mockReturnValue(false)
    mockReaddirSync.mockReturnValue([])
  })

  it('returns an AgentTool with name play_music', () => {
    const tool = createYTMusicTool()
    expect(tool.name).toBe('play_music')
    expect(tool.label).toBe('play_music')
    expect(typeof tool.execute).toBe('function')
    expect(tool.description.toLowerCase()).toContain('music')
  })

  it('has TypeBox parameters with query string', () => {
    const tool = createYTMusicTool()
    expect(tool.parameters).toBeDefined()
    // TypeBox schema should describe a query property
    expect(tool.parameters.properties?.query).toBeDefined()
  })

  it('searches via yt-dlp with ytsearch1 prefix', async () => {
    const tool = createYTMusicTool()

    mockExecFile
      // First call: search
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          id: 'abc123',
          title: 'Test Song',
          uploader: 'Test Artist',
        }),
        stderr: '',
      })
      // Second call: download
      .mockResolvedValueOnce({ stdout: '', stderr: '' })

    await tool.execute('call-1', { query: 'test song' })

    const searchCall = mockExecFile.mock.calls[0]
    expect(searchCall[0]).toBe('yt-dlp')
    expect(searchCall[1]).toContain('ytsearch1:test song')
    expect(searchCall[1]).toContain('--dump-json')
    expect(searchCall[1]).toContain('--no-download')
  })

  it('downloads with extract audio and mp3 format flags', async () => {
    const tool = createYTMusicTool()

    mockExecFile
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          id: 'abc123',
          title: 'Test Song',
          uploader: 'Test Artist',
        }),
        stderr: '',
      })
      .mockResolvedValueOnce({ stdout: '', stderr: '' })

    await tool.execute('call-1', { query: 'test song' })

    const downloadCall = mockExecFile.mock.calls[1]
    expect(downloadCall[0]).toBe('yt-dlp')
    expect(downloadCall[1]).toContain('-x')
    expect(downloadCall[1]).toContain('--audio-format')
    expect(downloadCall[1]).toContain('mp3')
  })

  it('returns success result with title and artist', async () => {
    const tool = createYTMusicTool()

    mockExecFile
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          id: 'abc123',
          title: 'Test Song',
          uploader: 'Test Artist',
        }),
        stderr: '',
      })
      .mockResolvedValueOnce({ stdout: '', stderr: '' })

    const result = await tool.execute('call-1', { query: 'test song' })
    expect(result.content[0].text).toContain('Now playing')
    expect(result.content[0].text).toContain('Test Song')
    expect(result.content[0].text).toContain('Test Artist')
    expect(result.details.title).toBe('Test Song')
    expect(result.details.artist).toBe('Test Artist')
    expect(result.details.id).toBe('abc123')
  })

  it('returns error result when yt-dlp fails (no crash)', async () => {
    const tool = createYTMusicTool()

    mockExecFile.mockRejectedValueOnce(new Error('yt-dlp not found'))

    const result = await tool.execute('call-1', { query: 'test song' })
    expect(result.content[0].text).toContain('could not play')
    expect(result.details.error).toBeDefined()
  })

  it('skips download when file already exists (cache hit)', async () => {
    const tool = createYTMusicTool()

    mockExecFile.mockResolvedValueOnce({
      stdout: JSON.stringify({
        id: 'cached123',
        title: 'Cached Song',
        uploader: 'Cached Artist',
      }),
      stderr: '',
    })

    // Directory listing returns cached file matching the video ID
    mockReaddirSync.mockReturnValue(['Cached Song - Cached Artist [cached123].mp3'])

    const result = await tool.execute('call-1', { query: 'cached song' })

    // Should only have 1 call (search), no download call
    expect(mockExecFile).toHaveBeenCalledTimes(1)
    expect(result.content[0].text).toContain('Now playing')
    expect(result.details.title).toBe('Cached Song')
  })

  it('detects legacy cache files (id-only naming)', async () => {
    const tool = createYTMusicTool()

    mockExecFile.mockResolvedValueOnce({
      stdout: JSON.stringify({
        id: 'legacy456',
        title: 'Legacy Song',
        uploader: 'Legacy Artist',
      }),
      stderr: '',
    })

    // Old-format cache file
    mockReaddirSync.mockReturnValue(['legacy456.mp3'])

    const result = await tool.execute('call-1', { query: 'legacy song' })

    expect(mockExecFile).toHaveBeenCalledTimes(1)
    expect(result.content[0].text).toContain('Now playing')
    expect(result.details.path).toContain('legacy456.mp3')
  })
})
