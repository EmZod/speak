# Add batch processing mode

## Type
Feature Request

## Severity
Low

## Description
No built-in way to process multiple files in one command. Must loop manually or run separate commands.

## Current Workflow
```bash
for f in chapters/*.txt; do
  name=$(basename "$f" .txt)
  speak "$f" --voice voice.wav --output "audio/${name}.wav"
done
```

## Proposed Workflow
```bash
speak chapters/*.txt --voice voice.wav --output-dir audio/
# Creates: audio/chapter_01.wav, audio/chapter_02.wav, etc.
```

---

## Investigation

### Use Cases

1. **Audiobook generation** — Convert multiple chapter files
2. **Podcast production** — Convert script segments
3. **Documentation** — Generate audio for multiple docs
4. **Batch updates** — Regenerate only changed files

### Design Questions

1. **How to handle glob patterns?**
   - Shell expansion (already works): `speak *.txt`
   - Built-in glob: `speak "*.txt"` — More portable
   - **Answer**: Rely on shell expansion for simplicity

2. **Output naming convention?**
   - Input filename with `.wav` extension
   - Numbered sequence
   - User-specified template
   - **Answer**: Input filename by default, keep it simple

3. **Parallel vs sequential?**
   - Sequential: Simpler, predictable resource usage
   - Parallel: Faster for many small files
   - **Answer**: Sequential by default, `--parallel` option for advanced use

4. **Error handling?**
   - Stop on first error: Simple, predictable
   - Continue and report all errors: Better for batch jobs
   - **Answer**: Continue by default, `--stop-on-error` to halt

### Hot Path Considerations

Batch mode just wraps single-file generation. No hot path changes needed.

---

## Implementation Plan

### Design Principles Applied

1. **Simple and boring** — Sequential processing, file-based tracking
2. **Log the decisions** — Log each file start/complete/skip
3. **Operations are part of design** — Clear status output, resumable

### Approach

When multiple input files are detected:
1. Validate all inputs exist
2. Determine output paths
3. Process sequentially (or parallel with flag)
4. Report summary

### Code Changes

**File: `src/core/batch.ts`** (new file)

```typescript
/**
 * Batch processing for multiple input files.
 */

import { existsSync, statSync } from "fs";
import { basename, extname, join } from "path";
import { logger, logDecision } from "../ui/logger.ts";

export interface BatchInput {
  inputPath: string;
  outputPath: string;
  exists: boolean;
  size: number;
}

export interface BatchOptions {
  outputDir: string;
  skipExisting: boolean;
}

/**
 * Prepare batch inputs with output paths.
 */
export function prepareBatchInputs(
  inputPaths: string[],
  options: BatchOptions
): BatchInput[] {
  const { outputDir, skipExisting } = options;
  
  return inputPaths.map((inputPath) => {
    // Derive output filename from input
    const inputName = basename(inputPath, extname(inputPath));
    const outputPath = join(outputDir, `${inputName}.wav`);
    
    const exists = existsSync(inputPath);
    const size = exists ? statSync(inputPath).size : 0;
    
    const outputExists = existsSync(outputPath);
    
    return {
      inputPath,
      outputPath,
      exists,
      size,
      skip: skipExisting && outputExists,
    };
  });
}

/**
 * Validate batch inputs.
 */
export function validateBatchInputs(inputs: BatchInput[]): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  
  for (const input of inputs) {
    if (!input.exists) {
      errors.push(`File not found: ${input.inputPath}`);
    }
  }
  
  // Check for duplicate output paths
  const outputPaths = new Set<string>();
  for (const input of inputs) {
    if (outputPaths.has(input.outputPath)) {
      errors.push(`Duplicate output path: ${input.outputPath}`);
    }
    outputPaths.add(input.outputPath);
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

export interface BatchResult {
  inputPath: string;
  outputPath: string;
  success: boolean;
  duration?: number;
  error?: string;
  skipped: boolean;
}

export interface BatchSummary {
  total: number;
  success: number;
  failed: number;
  skipped: number;
  totalDuration: number;
  results: BatchResult[];
}

/**
 * Create batch summary from results.
 */
export function summarizeBatch(results: BatchResult[]): BatchSummary {
  return {
    total: results.length,
    success: results.filter((r) => r.success && !r.skipped).length,
    failed: results.filter((r) => !r.success && !r.skipped).length,
    skipped: results.filter((r) => r.skipped).length,
    totalDuration: results.reduce((sum, r) => sum + (r.duration || 0), 0),
    results,
  };
}
```

**File: `src/index.ts`** (add batch handling)

```typescript
// Modify argument handling
.argument("[input...]", "Text to convert, file paths, or glob pattern")

// Add batch options
.option("--output-dir <dir>", "Output directory for batch mode")
.option("--skip-existing", "Skip files that already have output")
.option("--stop-on-error", "Stop batch processing on first error")
.option("--parallel <n>", "Process n files in parallel (default: 1)", "1")

// In action handler, detect batch mode
const isBatchMode = input.length > 1 || 
  (input.length === 1 && input[0].includes('*'));

if (isBatchMode) {
  const { prepareBatchInputs, validateBatchInputs, summarizeBatch } = 
    await import("./core/batch.ts");
  
  // Expand globs if needed (though shell usually does this)
  let inputPaths = input;
  if (input.length === 1 && input[0].includes('*')) {
    const glob = await import("glob");
    inputPaths = await glob.glob(input[0]);
  }
  
  // Prepare and validate
  const outputDir = options.outputDir || options.output;
  const batchInputs = prepareBatchInputs(inputPaths, {
    outputDir,
    skipExisting: options.skipExisting,
  });
  
  const validation = validateBatchInputs(batchInputs);
  if (!validation.valid) {
    for (const error of validation.errors) {
      console.log(pc.red(`Error: ${error}`));
    }
    process.exit(1);
  }
  
  // Ensure output directory exists
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }
  
  if (!options.quiet) {
    console.log(pc.cyan(`Processing ${batchInputs.length} files...\n`));
  }
  
  const results: BatchResult[] = [];
  const parallel = parseInt(options.parallel);
  
  // Process files
  if (parallel > 1) {
    // Parallel processing
    const chunks = chunkArray(batchInputs, parallel);
    for (const chunk of chunks) {
      const chunkResults = await Promise.all(
        chunk.map((input) => processFile(input, options))
      );
      results.push(...chunkResults);
    }
  } else {
    // Sequential processing
    for (const input of batchInputs) {
      const result = await processFile(input, options);
      results.push(result);
      
      if (!result.success && options.stopOnError) {
        console.log(pc.red("\nStopping due to --stop-on-error"));
        break;
      }
    }
  }
  
  // Print summary
  const summary = summarizeBatch(results);
  
  if (!options.quiet) {
    console.log(pc.cyan("\n--- Batch Summary ---"));
    console.log(`  Total:    ${summary.total}`);
    console.log(pc.green(`  Success:  ${summary.success}`));
    if (summary.failed > 0) {
      console.log(pc.red(`  Failed:   ${summary.failed}`));
    }
    if (summary.skipped > 0) {
      console.log(pc.yellow(`  Skipped:  ${summary.skipped}`));
    }
    console.log(pc.dim(`  Duration: ${summary.totalDuration.toFixed(1)}s total`));
  }
  
  // Exit with error code if any failed
  process.exit(summary.failed > 0 ? 1 : 0);
}

// Helper function for processing single file in batch
async function processFile(
  input: BatchInput,
  options: any
): Promise<BatchResult> {
  const { inputPath, outputPath, skip } = input;
  
  if (skip) {
    if (!options.quiet) {
      console.log(pc.dim(`  Skip: ${basename(inputPath)} (output exists)`));
    }
    return { inputPath, outputPath, success: true, skipped: true };
  }
  
  if (!options.quiet) {
    process.stdout.write(`  ${basename(inputPath)}...`);
  }
  
  try {
    const text = readFileSync(inputPath, "utf-8");
    
    const result = await generate({
      text,
      model: options.model,
      temperature: parseFloat(options.temp),
      speed: parseFloat(options.speed),
      voice: options.voice,
    });
    
    copyFileSync(result.audio_path, outputPath);
    
    if (!options.quiet) {
      console.log(pc.green(` ✓ ${result.duration.toFixed(1)}s`));
    }
    
    return {
      inputPath,
      outputPath,
      success: true,
      duration: result.duration,
      skipped: false,
    };
    
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    
    if (!options.quiet) {
      console.log(pc.red(` ✗ ${message}`));
    }
    
    return {
      inputPath,
      outputPath,
      success: false,
      error: message,
      skipped: false,
    };
  }
}
```

### Test Cases

```typescript
// test/integration/batch.test.ts

describe('Batch mode', () => {
  it('processes multiple files', async () => {
    // Create 3 test files
    // Run batch command
    // Verify 3 output files created
  });
  
  it('skips existing with --skip-existing', async () => {
    // Create test files and one output
    // Run with --skip-existing
    // Verify only missing outputs generated
  });
  
  it('stops on error with --stop-on-error', async () => {
    // Create test files, one invalid
    // Run with --stop-on-error
    // Verify stopped at invalid file
  });
  
  it('continues on error by default', async () => {
    // Create test files, one invalid in middle
    // Run without --stop-on-error
    // Verify continued past invalid file
  });
  
  it('handles parallel processing', async () => {
    // Create test files
    // Run with --parallel 2
    // Verify all processed (order may vary)
  });
});
```

### CLI Help

```
Options:
  --output-dir <dir>      Output directory for batch mode
  --skip-existing         Skip files that already have output
  --stop-on-error         Stop batch processing on first error  
  --parallel <n>          Process n files in parallel (default: 1)

Examples:
  # Process all chapters
  speak chapters/*.txt --output-dir audio/

  # Only generate missing files
  speak chapters/*.txt --output-dir audio/ --skip-existing

  # Faster batch with parallel processing
  speak chapters/*.txt --output-dir audio/ --parallel 2
```

### Failure Modes

| Failure | Handling |
|---------|----------|
| Input file not found | Report error, continue (or stop with flag) |
| Output dir not writable | Fail immediately before processing |
| Single file failure | Report, continue to next (or stop with flag) |
| Parallel failure | Report all failures in summary |

### Rollout

1. Implement batch module
2. Add batch detection to CLI
3. Add batch options
4. Test with various file counts
5. Release

### Priority Note

This is lower priority because:
- Shell loops work fine for batch processing
- Main pain points are chunking/timeout (issues #003-#004)
- Nice-to-have polish feature

Implement after higher-priority issues are resolved.
