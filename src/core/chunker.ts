/**
 * Text chunking for long document processing.
 *
 * Strategy: Split at sentence boundaries, respecting max chunk size.
 * Falls back to word boundaries if sentences are too long.
 */

export interface ChunkOptions {
  maxChars: number; // Max characters per chunk
  overlapChars: number; // Overlap for context (0 = none)
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  maxChars: 6000, // ~1500 words, generates ~2-3 min audio
  overlapChars: 0, // No overlap by default
};

// Sentence-ending patterns
const SENTENCE_END = /[.!?]+[\s\n]+/g;

/**
 * Split text into chunks at sentence boundaries.
 */
export function chunkText(
  text: string,
  options: ChunkOptions = DEFAULT_CHUNK_OPTIONS
): string[] {
  const { maxChars } = options;

  // If text is short enough, return as-is
  if (text.length <= maxChars) {
    return [text.trim()];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxChars) {
      chunks.push(remaining.trim());
      break;
    }

    // Find last sentence boundary before maxChars
    const segment = remaining.slice(0, maxChars);
    const matches = [...segment.matchAll(SENTENCE_END)];

    let splitIndex: number;

    if (matches.length > 0) {
      // Split at last sentence boundary
      const lastMatch = matches[matches.length - 1];
      if (lastMatch && lastMatch.index !== undefined) {
        splitIndex = lastMatch.index + lastMatch[0].length;
      } else {
        // Fallback to word boundary
        const lastSpace = segment.lastIndexOf(" ");
        splitIndex = lastSpace > 0 ? lastSpace : maxChars;
      }
    } else {
      // No sentence boundary found - fall back to word boundary
      const lastSpace = segment.lastIndexOf(" ");
      splitIndex = lastSpace > 0 ? lastSpace : maxChars;
    }

    const chunk = remaining.slice(0, splitIndex).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }

    remaining = remaining.slice(splitIndex).trim();
  }

  return chunks;
}

/**
 * Estimate audio duration from text length.
 * Based on ~150 words/minute speaking rate, ~5 chars/word average.
 */
export function estimateDuration(text: string): number {
  const words = text.length / 5;
  const minutes = words / 150;
  return minutes * 60; // seconds
}

/**
 * Check if text should be auto-chunked based on estimated generation time.
 */
export function shouldAutoChunk(
  text: string,
  timeoutSeconds: number = 300
): boolean {
  // If estimated audio duration would take >80% of timeout to generate,
  // recommend chunking. Assume ~0.4x RTF for generation.
  const estimatedAudioSeconds = estimateDuration(text);
  const estimatedGenerationSeconds = estimatedAudioSeconds * 0.4;
  return estimatedGenerationSeconds > timeoutSeconds * 0.8;
}
