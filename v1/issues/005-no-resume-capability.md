# No way to resume failed generation

## Type
Feature Request

## Severity
Low-Medium

## Description
When generation fails partway through (timeout, crash, etc.), there's no way to resume from where it left off. Must restart from the beginning.

## Use Case
Generating a 21-part chapter where part 7 times out:
- Parts 1-6 completed successfully
- Part 7 fails
- Currently: must regenerate part 7 manually, hope it doesn't fail again
- Ideal: `speak --resume` picks up from part 7

---

## Investigation

### Prerequisites

This feature depends on:
- **Issue #003** (partial output) — Need chunk-level persistence
- **Issue #004** (auto-chunking) — Need chunked generation model

Without chunk-level persistence, there's nothing to resume from.

### Design Options

**Option A: Checkpoint files**
```bash
speak chapter.txt --output chapter.wav --checkpoint .speak_progress/
# Creates: .speak_progress/manifest.json, chunk_001.wav, chunk_002.wav, etc.
# On failure: speak --resume .speak_progress/
```

**Option B: Idempotent chunk generation**
```bash
speak chapter.txt --output-dir chunks/ --auto-chunk
# Creates: chunks/001.wav, 002.wav, etc.
# Re-running skips existing files
# Final step: speak concat chunks/*.wav --output chapter.wav
```

**Option C: Job manifest**
```bash
speak chapter.txt --output chapter.wav
# On failure, creates: chapter.wav.manifest (JSON with progress)
speak --resume chapter.wav.manifest
```

**Recommendation**: Option B (idempotent chunks) is simplest and most Unix-y. Users can inspect intermediate state, retry specific chunks, and compose with other tools.

### State Model

For resume to work, we need persistent state:

| State | Storage | Purpose |
|-------|---------|---------|
| Input text hash | Manifest file | Detect if source changed |
| Chunk boundaries | Manifest file | Consistent re-chunking |
| Completed chunks | File presence | Skip completed work |
| Generation params | Manifest file | Consistent regeneration |

---

## Implementation Plan

### Design Principles Applied

1. **Simple and boring** — File presence = completion status (no database)
2. **State is the problem** — Minimize state; chunk files ARE the state
3. **Operations are part of design** — Clear manual recovery path

### Approach

Implement idempotent chunked generation:
1. Create manifest file with chunk boundaries and params
2. Generate chunks, skip if output file already exists
3. Concatenate at end
4. Clean up intermediate files (or keep with `--keep-chunks`)

### Manifest Format

```json
{
  "version": 1,
  "created_at": "2025-12-31T10:00:00Z",
  "source_hash": "sha256:abc123...",
  "source_length": 168000,
  "params": {
    "model": "mlx-community/chatterbox-turbo-8bit",
    "temperature": 0.5,
    "speed": 1.0,
    "voice": "~/.chatter/voices/david.wav"
  },
  "chunks": [
    { "index": 0, "start": 0, "end": 6000, "status": "complete", "output": "chunk_0000.wav" },
    { "index": 1, "start": 6000, "end": 12000, "status": "complete", "output": "chunk_0001.wav" },
    { "index": 2, "start": 12000, "end": 18000, "status": "pending", "output": "chunk_0002.wav" },
    ...
  ]
}
```

### Code Changes

**File: `src/core/manifest.ts`** (new file)

```typescript
/**
 * Generation manifest for resumable chunked generation.
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { createHash } from "crypto";
import { join } from "path";
import { chunkText, ChunkOptions } from "./chunker.ts";

export interface ChunkInfo {
  index: number;
  start: number;
  end: number;
  text: string;
  status: "pending" | "complete" | "failed";
  output: string;
  duration?: number;
}

export interface GenerationManifest {
  version: number;
  created_at: string;
  updated_at: string;
  source_hash: string;
  source_length: number;
  params: {
    model?: string;
    temperature?: number;
    speed?: number;
    voice?: string;
  };
  chunks: ChunkInfo[];
  output_file?: string;
}

const MANIFEST_VERSION = 1;

/**
 * Hash text for change detection.
 */
function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/**
 * Create a new manifest for text.
 */
export function createManifest(
  text: string,
  outputDir: string,
  params: GenerationManifest["params"],
  chunkOptions: ChunkOptions
): GenerationManifest {
  const chunks = chunkText(text, chunkOptions);
  
  let charIndex = 0;
  const chunkInfos: ChunkInfo[] = chunks.map((chunkText, i) => {
    const start = charIndex;
    const end = charIndex + chunkText.length;
    charIndex = end;
    
    return {
      index: i,
      start,
      end,
      text: chunkText,
      status: "pending",
      output: join(outputDir, `chunk_${String(i).padStart(4, "0")}.wav`),
    };
  });
  
  return {
    version: MANIFEST_VERSION,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    source_hash: hashText(text),
    source_length: text.length,
    params,
    chunks: chunkInfos,
  };
}

/**
 * Load existing manifest.
 */
export function loadManifest(path: string): GenerationManifest | null {
  if (!existsSync(path)) {
    return null;
  }
  
  try {
    const content = readFileSync(path, "utf-8");
    const manifest = JSON.parse(content) as GenerationManifest;
    
    if (manifest.version !== MANIFEST_VERSION) {
      throw new Error(`Unsupported manifest version: ${manifest.version}`);
    }
    
    return manifest;
  } catch (error) {
    return null;
  }
}

/**
 * Save manifest to disk.
 */
export function saveManifest(manifest: GenerationManifest, path: string): void {
  manifest.updated_at = new Date().toISOString();
  writeFileSync(path, JSON.stringify(manifest, null, 2));
}

/**
 * Update chunk status in manifest.
 */
export function updateChunkStatus(
  manifest: GenerationManifest,
  chunkIndex: number,
  status: ChunkInfo["status"],
  duration?: number
): void {
  const chunk = manifest.chunks[chunkIndex];
  if (chunk) {
    chunk.status = status;
    if (duration !== undefined) {
      chunk.duration = duration;
    }
  }
}

/**
 * Check manifest validity against source text.
 */
export function validateManifest(manifest: GenerationManifest, text: string): {
  valid: boolean;
  reason?: string;
} {
  const currentHash = hashText(text);
  
  if (manifest.source_hash !== currentHash) {
    return { valid: false, reason: "Source text has changed since manifest was created" };
  }
  
  if (manifest.source_length !== text.length) {
    return { valid: false, reason: "Source text length has changed" };
  }
  
  return { valid: true };
}

/**
 * Get chunks that need to be generated.
 */
export function getPendingChunks(manifest: GenerationManifest): ChunkInfo[] {
  return manifest.chunks.filter((c) => {
    // Pending status OR complete status but file missing
    if (c.status === "pending" || c.status === "failed") {
      return true;
    }
    if (c.status === "complete" && !existsSync(c.output)) {
      return true;
    }
    return false;
  });
}

/**
 * Check if all chunks are complete.
 */
export function isComplete(manifest: GenerationManifest): boolean {
  return manifest.chunks.every(
    (c) => c.status === "complete" && existsSync(c.output)
  );
}
```

**File: `src/index.ts`** (add resume support)

```typescript
// Add options
.option("--resume <manifest>", "Resume from a previous incomplete generation")
.option("--keep-chunks", "Keep intermediate chunk files after completion")

// Handle resume
if (options.resume) {
  const { loadManifest, getPendingChunks, updateChunkStatus, saveManifest, isComplete } = 
    await import("./core/manifest.ts");
  const { concatenateWav, cleanupChunkFiles } = await import("./core/concatenate.ts");
  
  const manifest = loadManifest(options.resume);
  if (!manifest) {
    console.log(pc.red(`Cannot load manifest: ${options.resume}`));
    process.exit(1);
  }
  
  const pending = getPendingChunks(manifest);
  
  if (pending.length === 0 && isComplete(manifest)) {
    console.log(pc.green("All chunks already complete."));
    
    // Just do final concatenation
    const outputPath = manifest.output_file || prepareOutputPath(options.output);
    const chunkFiles = manifest.chunks.map(c => c.output);
    concatenateWav(chunkFiles, outputPath);
    
    console.log(pc.green(`✓ Output: ${outputPath}`));
    process.exit(0);
  }
  
  console.log(pc.cyan(`Resuming: ${pending.length}/${manifest.chunks.length} chunks remaining`));
  
  for (const chunk of pending) {
    console.log(pc.dim(`  Chunk ${chunk.index + 1}/${manifest.chunks.length}...`));
    
    try {
      const result = await generate({
        text: chunk.text,
        ...manifest.params,
      });
      
      copyFileSync(result.audio_path, chunk.output);
      updateChunkStatus(manifest, chunk.index, "complete", result.duration);
      saveManifest(manifest, options.resume);
      
      console.log(pc.dim(`    ✓ ${result.duration.toFixed(1)}s`));
    } catch (error) {
      updateChunkStatus(manifest, chunk.index, "failed");
      saveManifest(manifest, options.resume);
      
      console.log(pc.red(`    ✗ Failed: ${error}`));
      console.log(pc.yellow(`Resume with: speak --resume ${options.resume}`));
      process.exit(1);
    }
  }
  
  // All done - concatenate
  const outputPath = manifest.output_file || prepareOutputPath(options.output);
  const chunkFiles = manifest.chunks.map(c => c.output);
  concatenateWav(chunkFiles, outputPath);
  
  console.log(pc.green(`✓ Generated audio from ${manifest.chunks.length} chunks`));
  console.log(pc.dim(`  Output: ${outputPath}`));
  
  // Cleanup unless --keep-chunks
  if (!options.keepChunks) {
    cleanupChunkFiles(chunkFiles);
    unlinkSync(options.resume); // Remove manifest
  }
  
  process.exit(0);
}

// In auto-chunk mode, create manifest for resume capability
if (options.autoChunk) {
  const { createManifest, saveManifest, updateChunkStatus, getPendingChunks, isComplete } = 
    await import("./core/manifest.ts");
  
  const outputDir = dirname(prepareOutputPath(options.output));
  const manifestPath = join(outputDir, "manifest.json");
  
  // Create or load manifest
  let manifest = loadManifest(manifestPath);
  
  if (manifest) {
    const validation = validateManifest(manifest, text);
    if (!validation.valid) {
      console.log(pc.yellow(`Warning: ${validation.reason}`));
      console.log(pc.yellow("Creating new manifest..."));
      manifest = null;
    }
  }
  
  if (!manifest) {
    manifest = createManifest(text, outputDir, {
      model: options.model,
      temperature: parseFloat(options.temp),
      speed: parseFloat(options.speed),
      voice: options.voice,
    }, { maxChars: parseInt(options.chunkSize), overlapChars: 0 });
    
    manifest.output_file = prepareOutputPath(options.output);
    saveManifest(manifest, manifestPath);
  }
  
  // Generate pending chunks...
  // (rest of auto-chunk implementation, using manifest)
}
```

### Test Cases

```typescript
// test/integration/resume.test.ts

describe('Resume capability', () => {
  it('creates manifest during chunked generation', async () => {
    // Start generation, interrupt after 2 chunks
    // Verify manifest exists with 2 complete, rest pending
  });
  
  it('resumes from manifest', async () => {
    // Create partial manifest with 2/5 complete
    // Run with --resume
    // Verify only 3 chunks generated
    // Verify final output concatenated
  });
  
  it('detects source text changes', async () => {
    // Create manifest
    // Modify source text
    // Run with --resume
    // Should warn and offer to recreate
  });
  
  it('handles missing chunk files gracefully', async () => {
    // Create manifest with "complete" status
    // Delete one chunk file
    // Run with --resume
    // Should regenerate missing chunk
  });
});
```

### User Experience

```bash
# Initial generation (fails at chunk 7)
$ speak book-chapter.md --auto-chunk --output chapter.wav
Processing 15 chunks...
  Chunk 1/15 (5823 chars)... ✓ 48.2s
  ...
  Chunk 7/15 (5901 chars)... ✗ Timeout
Resume with: speak --resume ~/Audio/speak/manifest.json

# Resume later
$ speak --resume ~/Audio/speak/manifest.json
Resuming: 9/15 chunks remaining
  Chunk 7/15... ✓ 49.1s
  Chunk 8/15... ✓ 47.3s
  ...
✓ Generated audio from 15 chunks
  Output: ~/Audio/speak/chapter.wav
```

### Failure Modes

| Failure | Handling |
|---------|----------|
| Manifest corrupted | Clear error, suggest regenerating |
| Source text changed | Warning, option to recreate manifest |
| Chunk file missing | Regenerate that chunk |
| Params changed | Warning, suggest recreating (audio consistency) |

### Rollout

1. Implement manifest module
2. Integrate with auto-chunk
3. Add `--resume` flag
4. Test partial generation scenarios
5. Release

### Priority Note

This is lower priority than issues #002-#004 because:
- Manual chunking + retry works (painful but functional)
- Auto-chunking (#004) reduces the need for resume
- Timeout/partial output (#003) also helps

Implement this after the higher-priority issues are resolved.
