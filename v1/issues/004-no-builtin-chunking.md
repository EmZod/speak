# No built-in chunking for long documents

## Type
Feature Request

## Severity
Medium

## Description
The tool has no built-in way to handle long documents. Users must manually chunk input, generate parts separately, and concatenate with external tools.

## Current Workflow (Manual)
```bash
# 1. Split the file
split -b 8000 chapter.txt part_

# 2. Generate each part
for p in part_*; do
  speak "$p" --voice voice.wav --output audio/
done

# 3. Concatenate with sox
sox audio/*.wav chapter.wav

# 4. Cleanup
rm part_* audio/speak_*.wav
```

## Proposed Workflow
```bash
speak chapter.txt --voice voice.wav --output chapter.wav --auto-chunk
```

---

## Investigation

### Why Chunking Is Needed

The speak tool has two limits that require chunking:
1. **Client timeout** (300s default) — Long texts exceed this
2. **Memory constraints** — Very long audio can exhaust memory before saving

Currently, the Python server does internal chunking for TTS quality (sentence boundaries), but:
- It doesn't handle the timeout problem
- It doesn't save intermediate results
- It doesn't provide progress for the overall document

### Related Issues

- Issue #002 (progress) — Chunking enables per-chunk progress
- Issue #003 (timeout/partial) — Chunking with per-chunk saves solves timeout problem
- Both issues are prerequisites or parallel work

### Design Questions

1. **What is a "chunk"?**
   - Fixed byte/char size? — Simple but may break mid-sentence
   - Sentence boundaries? — Better quality, variable size
   - Paragraph boundaries? — Larger chunks, may hit timeout
   - **Answer**: Use sentence boundaries with a max size fallback

2. **Where does chunking happen?**
   - TypeScript client? — Simpler, Python server unchanged
   - Python server? — Better text processing, but already does it
   - **Answer**: TypeScript client for orchestration, leverages existing Python chunking

3. **How to concatenate?**
   - Shell out to sox/ffmpeg? — Works, external dependency
   - Use node-based audio lib? — Avoids dependency
   - Do it in Python? — Already has scipy
   - **Answer**: Shell to sox (already commonly available), with fallback error message

### Hot Path Impact

Chunking happens before generation starts — not in the hot path. Concatenation happens after — also not hot path. Generation itself (the hot path) is unchanged.

---

## Implementation Plan

### Design Principles Applied

1. **Simple and boring** — Use sentence boundaries (well-understood), sox for concat (well-tested)
2. **Hot paths first** — Chunking doesn't affect generation speed
3. **Decide failure modes** — Partial concat on error, cleanup temp files

### Approach

Add `--auto-chunk` flag that:
1. Splits input at sentence boundaries (max ~6000 chars per chunk for safety margin)
2. Generates each chunk with progress reporting
3. Concatenates results using sox
4. Cleans up intermediate files
5. Returns single output file

### Code Changes

**File: `src/core/chunker.ts`** (new file)

```typescript
/**
 * Text chunking for long document processing.
 * 
 * Strategy: Split at sentence boundaries, respecting max chunk size.
 * Falls back to word boundaries if sentences are too long.
 */

export interface ChunkOptions {
  maxChars: number;      // Max characters per chunk
  overlapChars: number;  // Overlap for context (0 = none)
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  maxChars: 6000,    // ~1500 words, generates ~2-3 min audio
  overlapChars: 0,   // No overlap by default
};

// Sentence-ending patterns
const SENTENCE_END = /[.!?]+[\s\n]+/g;

/**
 * Split text into chunks at sentence boundaries.
 */
export function chunkText(text: string, options: ChunkOptions = DEFAULT_CHUNK_OPTIONS): string[] {
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
      splitIndex = lastMatch.index! + lastMatch[0].length;
    } else {
      // No sentence boundary found - fall back to word boundary
      const lastSpace = segment.lastIndexOf(' ');
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
export function shouldAutoChunk(text: string, timeoutSeconds: number = 300): boolean {
  // If estimated audio duration would take >80% of timeout to generate,
  // recommend chunking. Assume ~0.4x RTF for generation.
  const estimatedAudioSeconds = estimateDuration(text);
  const estimatedGenerationSeconds = estimatedAudioSeconds * 0.4;
  return estimatedGenerationSeconds > timeoutSeconds * 0.8;
}
```

**File: `src/core/concatenate.ts`** (new file)

```typescript
/**
 * Audio file concatenation using sox.
 */

import { execSync, spawnSync } from "child_process";
import { existsSync, unlinkSync } from "fs";
import { logger, logDecision } from "../ui/logger.ts";

/**
 * Check if sox is available.
 */
export function hasSox(): boolean {
  try {
    execSync("which sox", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Concatenate multiple WAV files into one.
 * 
 * @param inputFiles Array of paths to input WAV files (in order)
 * @param outputFile Path for output WAV file
 * @returns true on success
 */
export function concatenateWav(inputFiles: string[], outputFile: string): boolean {
  if (inputFiles.length === 0) {
    throw new Error("No input files to concatenate");
  }
  
  if (inputFiles.length === 1) {
    // Just copy the single file
    const { copyFileSync } = require("fs");
    copyFileSync(inputFiles[0], outputFile);
    return true;
  }
  
  if (!hasSox()) {
    throw new Error(
      "sox is required for concatenation but not found. " +
      "Install with: brew install sox"
    );
  }
  
  logDecision(
    "Concatenating audio files",
    `${inputFiles.length} files → ${outputFile}`,
    { input_count: inputFiles.length }
  );
  
  const result = spawnSync("sox", [...inputFiles, outputFile], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  
  if (result.status !== 0) {
    const stderr = result.stderr?.toString() || "unknown error";
    throw new Error(`sox failed: ${stderr}`);
  }
  
  return true;
}

/**
 * Clean up temporary chunk files.
 */
export function cleanupChunkFiles(files: string[]): void {
  for (const file of files) {
    try {
      if (existsSync(file)) {
        unlinkSync(file);
      }
    } catch (error) {
      logger.warn("Failed to cleanup temp file", { file, error: String(error) });
    }
  }
}
```

**File: `src/index.ts`** (add auto-chunk handling)

```typescript
// Add option
.option("--auto-chunk", "Automatically chunk long documents")
.option("--chunk-size <chars>", "Max characters per chunk", "6000")

// In action handler, before generate:

if (options.autoChunk || shouldAutoChunk(text, parseInt(options.timeout))) {
  // Use chunked generation
  const { chunkText } = await import("./core/chunker.ts");
  const { concatenateWav, cleanupChunkFiles, hasSox } = await import("./core/concatenate.ts");
  
  // Verify sox is available
  if (!hasSox()) {
    console.log(pc.red("Error: sox is required for --auto-chunk but not found."));
    console.log(pc.dim("Install with: brew install sox"));
    process.exit(1);
  }
  
  const chunks = chunkText(text, { maxChars: parseInt(options.chunkSize), overlapChars: 0 });
  
  if (!options.quiet) {
    console.log(pc.cyan(`Processing ${chunks.length} chunks...`));
  }
  
  const chunkFiles: string[] = [];
  const tempDir = prepareOutputPath(options.output).replace(/\/[^/]+$/, '');
  
  try {
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      
      if (!options.quiet) {
        console.log(pc.dim(`  Chunk ${i + 1}/${chunks.length} (${chunk.length} chars)...`));
      }
      
      const result = await generate({
        text: chunk,
        model: options.model,
        temperature: parseFloat(options.temp),
        speed: parseFloat(options.speed),
        voice: options.voice,
      });
      
      // Save chunk with numbered name
      const chunkPath = `${tempDir}/chunk_${String(i).padStart(4, '0')}.wav`;
      copyFileSync(result.audio_path, chunkPath);
      chunkFiles.push(chunkPath);
      
      if (!options.quiet) {
        console.log(pc.dim(`    ✓ ${result.duration.toFixed(1)}s`));
      }
    }
    
    // Concatenate all chunks
    const outputPath = prepareOutputPath(options.output);
    concatenateWav(chunkFiles, outputPath);
    
    // Calculate total duration
    const totalDuration = chunkFiles.reduce((sum, f) => {
      // Could read duration from file, for now estimate
      return sum;
    }, 0);
    
    if (!options.quiet) {
      console.log(pc.green(`✓ Generated audio from ${chunks.length} chunks`));
      console.log(pc.dim(`  Output: ${outputPath}`));
    }
    
    // Cleanup temp chunk files
    cleanupChunkFiles(chunkFiles);
    
    if (options.play) {
      await playAudio(outputPath);
    }
    
  } catch (error) {
    // Cleanup on error
    cleanupChunkFiles(chunkFiles);
    throw error;
  }
  
  process.exit(0);
}
```

### Test Cases

```typescript
// test/unit/chunker.test.ts

describe('chunkText', () => {
  it('returns single chunk for short text', () => {
    const chunks = chunkText('Hello world.', { maxChars: 1000, overlapChars: 0 });
    expect(chunks).toEqual(['Hello world.']);
  });
  
  it('splits at sentence boundaries', () => {
    const text = 'First sentence. Second sentence. Third sentence.';
    const chunks = chunkText(text, { maxChars: 30, overlapChars: 0 });
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toBe('First sentence.');
    expect(chunks[1]).toBe('Second sentence. Third sentence.');
  });
  
  it('falls back to word boundary when no sentence end', () => {
    const text = 'A very long sentence that has no periods and keeps going on and on';
    const chunks = chunkText(text, { maxChars: 30, overlapChars: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    // Should split at word boundary, not mid-word
    expect(chunks[0]).not.toMatch(/\w$/); // Should end at word boundary
  });
  
  it('handles multiple sentence-ending punctuation', () => {
    const text = 'Really?! Yes! Okay...';
    const chunks = chunkText(text, { maxChars: 15, overlapChars: 0 });
    expect(chunks.length).toBe(2);
  });
});

// test/unit/concatenate.test.ts

describe('concatenateWav', () => {
  it('copies single file without sox', () => {
    // Create temp file, call concatenate with one file, verify copy
  });
  
  it('throws if sox not available for multiple files', () => {
    // Mock hasSox to return false
    // Expect error with install instructions
  });
});
```

### Error Handling

| Error | Handling |
|-------|----------|
| sox not installed | Clear error message with install command |
| Chunk generation fails | Save successful chunks, report partial completion |
| Disk full | Fail with error, cleanup what we can |
| Concatenation fails | Keep chunk files, report location for manual recovery |

### CLI Help Updates

```
Options:
  --auto-chunk              Automatically chunk long documents for reliable generation
  --chunk-size <chars>      Max characters per chunk (default: 6000)
```

### Rollout

1. Implement `chunker.ts` with unit tests
2. Implement `concatenate.ts` with sox check
3. Add `--auto-chunk` flag to CLI
4. Add smart detection: warn user when text is long but --auto-chunk not specified
5. Test with various document sizes
6. Release

### Verification

```bash
# Generate from large file with auto-chunking
speak large-book-chapter.md --auto-chunk --output chapter.wav

# Should output:
# Processing 15 chunks...
#   Chunk 1/15 (5823 chars)...
#     ✓ 48.2s
#   Chunk 2/15 (5912 chars)...
#     ✓ 51.1s
# ...
# ✓ Generated audio from 15 chunks
#   Output: ~/Audio/speak/chapter.wav
```
