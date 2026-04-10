import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('EmbeddingProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  describe('createOpenAIEmbeddings', () => {
    it('returns a provider with dimensions=384', async () => {
      vi.doMock('openai', () => ({
        default: class MockOpenAI {
          embeddings = {
            create: vi.fn().mockResolvedValue({
              data: [{ embedding: new Array(384).fill(0.1) }],
            }),
          }
        },
      }))

      const { createOpenAIEmbeddings } = await import('../../server/providers/embeddings')
      const provider = createOpenAIEmbeddings()

      expect(provider.dimensions).toBe(384)
    })

    it('calls OpenAI API with correct parameters', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        data: [{ embedding: new Array(384).fill(0.5) }],
      })

      vi.doMock('openai', () => ({
        default: class MockOpenAI {
          embeddings = { create: mockCreate }
        },
      }))

      const { createOpenAIEmbeddings } = await import('../../server/providers/embeddings')
      const provider = createOpenAIEmbeddings()

      await provider.embed(['test text'])

      expect(mockCreate).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: ['test text'],
        dimensions: 384,
        encoding_format: 'float',
      })
    })

    it('returns Float32Array[] from embed()', async () => {
      vi.doMock('openai', () => ({
        default: class MockOpenAI {
          embeddings = {
            create: vi.fn().mockResolvedValue({
              data: [
                { embedding: [0.1, 0.2, 0.3] },
                { embedding: [0.4, 0.5, 0.6] },
              ],
            }),
          }
        },
      }))

      const { createOpenAIEmbeddings } = await import('../../server/providers/embeddings')
      const provider = createOpenAIEmbeddings()

      const results = await provider.embed(['text1', 'text2'])

      expect(results).toHaveLength(2)
      expect(results[0]).toBeInstanceOf(Float32Array)
      expect(results[1]).toBeInstanceOf(Float32Array)
      expect(Array.from(results[0])).toEqual([
        expect.closeTo(0.1),
        expect.closeTo(0.2),
        expect.closeTo(0.3),
      ])
    })
  })

  describe('createEmbeddings factory', () => {
    it('returns OpenAI provider by default (no config)', async () => {
      vi.doMock('openai', () => ({
        default: class MockOpenAI {
          embeddings = {
            create: vi.fn().mockResolvedValue({
              data: [{ embedding: new Array(384).fill(0) }],
            }),
          }
        },
      }))

      const { createEmbeddings } = await import('../../server/providers/embeddings')
      const provider = createEmbeddings()

      expect(provider.dimensions).toBe(384)
    })

    it('returns OpenAI provider when configured explicitly', async () => {
      vi.doMock('openai', () => ({
        default: class MockOpenAI {
          embeddings = {
            create: vi.fn().mockResolvedValue({
              data: [{ embedding: new Array(384).fill(0) }],
            }),
          }
        },
      }))

      const { createEmbeddings } = await import('../../server/providers/embeddings')
      const provider = createEmbeddings({ provider: 'openai' })

      expect(provider.dimensions).toBe(384)
    })

    it('throws on unknown provider', async () => {
      vi.doMock('openai', () => ({
        default: class MockOpenAI {
          embeddings = { create: vi.fn() }
        },
      }))

      const { createEmbeddings } = await import('../../server/providers/embeddings')

      expect(() => createEmbeddings({ provider: 'unknown' })).toThrow(
        'Unknown embeddings provider: unknown',
      )
    })

    it('routes "fastembed" to fastembed provider', async () => {
      vi.doMock('openai', () => ({
        default: class MockOpenAI {
          embeddings = { create: vi.fn() }
        },
      }))
      vi.doMock('fastembed', () => ({
        EmbeddingModel: { BGESmallENV15: 'BGESmallENV15' },
        FlagEmbedding: {
          init: vi.fn().mockResolvedValue({
            embed: vi.fn().mockImplementation(async function* (texts: string[]) {
              for (const _ of texts) {
                yield new Array(384).fill(0.1)
              }
            }),
          }),
        },
      }))

      const { createEmbeddings } = await import('../../server/providers/embeddings')
      const provider = createEmbeddings({ provider: 'fastembed' })

      expect(provider.dimensions).toBe(384)
    })

    it('routes "local" alias to fastembed provider', async () => {
      vi.doMock('openai', () => ({
        default: class MockOpenAI {
          embeddings = { create: vi.fn() }
        },
      }))
      vi.doMock('fastembed', () => ({
        EmbeddingModel: { BGESmallENV15: 'BGESmallENV15' },
        FlagEmbedding: {
          init: vi.fn().mockResolvedValue({
            embed: vi.fn().mockImplementation(async function* (texts: string[]) {
              for (const _ of texts) {
                yield new Array(384).fill(0.1)
              }
            }),
          }),
        },
      }))

      const { createEmbeddings } = await import('../../server/providers/embeddings')
      const provider = createEmbeddings({ provider: 'local' })

      expect(provider.dimensions).toBe(384)
    })
  })

  describe('createFastEmbedEmbeddings', () => {
    it('returns a provider with dimensions=384', async () => {
      vi.doMock('openai', () => ({
        default: class MockOpenAI {
          embeddings = { create: vi.fn() }
        },
      }))
      vi.doMock('fastembed', () => ({
        EmbeddingModel: { BGESmallENV15: 'BGESmallENV15' },
        FlagEmbedding: {
          init: vi.fn().mockResolvedValue({
            embed: vi.fn().mockImplementation(async function* (texts: string[]) {
              for (const _ of texts) {
                yield new Array(384).fill(0.1)
              }
            }),
          }),
        },
      }))

      const { createFastEmbedEmbeddings } = await import('../../server/providers/embeddings')
      const provider = createFastEmbedEmbeddings()

      expect(provider.dimensions).toBe(384)
    })

    it('calls model.embed() and returns Float32Array[]', async () => {
      const mockEmbed = vi.fn().mockImplementation(async function* (texts: string[]) {
        for (const _ of texts) {
          yield new Array(384).fill(0.5)
        }
      })

      vi.doMock('openai', () => ({
        default: class MockOpenAI {
          embeddings = { create: vi.fn() }
        },
      }))
      vi.doMock('fastembed', () => ({
        EmbeddingModel: { BGESmallENV15: 'BGESmallENV15' },
        FlagEmbedding: {
          init: vi.fn().mockResolvedValue({
            embed: mockEmbed,
          }),
        },
      }))

      const { createFastEmbedEmbeddings } = await import('../../server/providers/embeddings')
      const provider = createFastEmbedEmbeddings()

      const results = await provider.embed(['text1', 'text2'])

      expect(results).toHaveLength(2)
      expect(results[0]).toBeInstanceOf(Float32Array)
      expect(results[1]).toBeInstanceOf(Float32Array)
      expect(results[0].length).toBe(384)
    })

    it('throws helpful error when fastembed is not installed', async () => {
      vi.doMock('openai', () => ({
        default: class MockOpenAI {
          embeddings = { create: vi.fn() }
        },
      }))
      vi.doMock('fastembed', () => {
        throw new Error('Cannot find module "fastembed"')
      })

      const { createFastEmbedEmbeddings } = await import('../../server/providers/embeddings')
      const provider = createFastEmbedEmbeddings()

      await expect(provider.embed(['test'])).rejects.toThrow(
        /Failed to initialize fastembed.*npm install fastembed/,
      )
    })
  })
})
