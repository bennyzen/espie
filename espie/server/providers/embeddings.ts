// Embedding Provider — local ONNX via fastembed (BAAI/bge-small-en-v1.5, 384 dims).
// No API key needed. Model downloaded on first use (~130MB, cached).

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<Float32Array[]>
  readonly dimensions: number
}

// Always check globalThis at call time — Nitro may code-split API routes and
// WebSocket routes into separate bundles with independent module scopes.
// Module-level reads of globalThis only capture the value at load time, which
// may be before another code path populated the cache.

export function createEmbeddings(): EmbeddingProvider {
  return {
    dimensions: 384,

    async embed(texts: string[]): Promise<Float32Array[]> {
      let model = (globalThis as any).__fastembed_model
      if (!model) {
        const { EmbeddingModel, FlagEmbedding } = await import('fastembed')
        model = await FlagEmbedding.init({
          model: EmbeddingModel.BGESmallENV15,
        })
        ;(globalThis as any).__fastembed_model = model
        console.log('[embeddings] FastEmbed initialized (bge-small-en-v1.5, 384 dims)')
      }

      const results: Float32Array[] = []
      for await (const batch of model.embed(texts)) {
        for (const embedding of batch) {
          results.push(embedding)
        }
      }
      return results
    },
  }
}
