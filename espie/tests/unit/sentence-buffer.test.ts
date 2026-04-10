import { describe, it, expect } from 'vitest'
import { SentenceBuffer } from '../../server/utils/sentence-buffer'

describe('SentenceBuffer', () => {
  it('extracts a complete sentence ending with period + space', () => {
    const buf = new SentenceBuffer()
    const result = buf.push('Hello world. ')
    expect(result).toEqual(['Hello world.'])
  })

  it('accumulates across multiple pushes', () => {
    const buf = new SentenceBuffer()
    const first = buf.push('Hello ')
    expect(first).toEqual([])
    const second = buf.push('world. ')
    expect(second).toEqual(['Hello world.'])
  })

  it('extracts multiple sentences in one push', () => {
    const buf = new SentenceBuffer()
    const result = buf.push('First? Second! Third. ')
    expect(result).toEqual(['First?', 'Second!', 'Third.'])
  })

  it('returns empty array when no boundary found', () => {
    const buf = new SentenceBuffer()
    const result = buf.push('No boundary yet')
    expect(result).toEqual([])
  })

  it('flush returns remaining text after incomplete push', () => {
    const buf = new SentenceBuffer()
    buf.push('Partial sentence')
    const flushed = buf.flush()
    expect(flushed).toBe('Partial sentence')
  })

  it('flush returns null on empty buffer', () => {
    const buf = new SentenceBuffer()
    expect(buf.flush()).toBeNull()
  })

  it('clear resets buffer, subsequent flush returns null', () => {
    const buf = new SentenceBuffer()
    buf.push('Some text')
    buf.clear()
    expect(buf.flush()).toBeNull()
  })

  it('treats newline as sentence boundary', () => {
    const buf = new SentenceBuffer()
    const result = buf.push('Line one\nLine two\n')
    expect(result).toEqual(['Line one', 'Line two'])
  })

  it('pending getter returns current buffer contents', () => {
    const buf = new SentenceBuffer()
    buf.push('In progress')
    expect(buf.pending).toBe('In progress')
  })
})
