// Sentence Buffer — accumulates streaming LLM text tokens and splits on sentence boundaries.
// Used between LLM streaming output and TTS input to dispatch complete sentences for synthesis.

export class SentenceBuffer {
  private buffer = ''
  private readonly boundaryRegex = /([.?!]\s|\n)/

  /**
   * Append text to buffer, extract and return all complete sentences.
   * Keeps partial (unfinished) sentence in buffer for next push.
   */
  push(text: string): string[] {
    this.buffer += text
    const sentences: string[] = []

    let match: RegExpExecArray | null
    while ((match = this.boundaryRegex.exec(this.buffer)) !== null) {
      const endIdx = match.index + match[0].length
      const sentence = this.buffer.slice(0, endIdx).trim()
      if (sentence.length > 0) {
        sentences.push(sentence)
      }
      this.buffer = this.buffer.slice(endIdx)
    }

    return sentences
  }

  /**
   * Return remaining buffer text (trimmed), reset buffer.
   * Returns null if buffer is empty after trimming.
   */
  flush(): string | null {
    const remaining = this.buffer.trim()
    this.buffer = ''
    return remaining.length > 0 ? remaining : null
  }

  /**
   * Reset buffer without returning contents.
   */
  clear(): void {
    this.buffer = ''
  }

  /**
   * Current buffer contents for debugging.
   */
  get pending(): string {
    return this.buffer
  }
}
