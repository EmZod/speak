# Add --dry-run flag

## Type
Feature Request

## Severity
Low

## Description
Add a `--dry-run` flag to preview what would happen without actually generating audio. Useful for validating complex commands before committing compute time.

## Proposed Usage
```bash
speak chapters/*.txt --output-dir audio/ --auto-chunk --dry-run

# Output:
# Dry run - no audio will be generated
# 
# Input files: 6
#   chapters/ch01.txt (9,941 bytes) → audio/ch01.wav
#   chapters/ch02.txt (7,456 bytes) → audio/ch02.wav
#   chapters/ch03.txt (24,011 bytes) → audio/ch03.wav [will chunk: 3 parts]
#   ...
# 
# Total input: 112 KB
# Estimated output: ~85 minutes of audio
# Estimated time: ~60 minutes
```

## Use Cases
- Verify file paths and naming before long batch job
- Check which files would be chunked
- Estimate total time for planning
- Validate command syntax without side effects

---

## Investigation

### Related Issues

- **Issue #008** (duration estimate) — Dry-run should include estimates
- **Issue #006** (batch mode) — Dry-run most useful for batch operations
- **Issue #004** (auto-chunk) — Show chunking preview

### What to Show

1. **Input summary** — Files, sizes, text lengths
2. **Output preview** — Where files will be created
3. **Processing plan** — Which files will be chunked
4. **Estimates** — Duration, generation time
5. **Warnings** — Missing files, large inputs, etc.

### Scope

The `--dry-run` flag should work with:
- Single file: show estimate
- Multiple files: show batch plan
- Auto-chunk: show chunk breakdown
- Resume: show what would be regenerated

---

## Implementation Plan

### Design Principles Applied

1. **Operations are part of design** — Preview before commit
2. **Log the decisions** — Show the same decisions that would be made
3. **Simple and boring** — Just skip the actual generation step

### Approach

Add `--dry-run` flag that:
1. Performs all validation and planning
2. Shows what would happen
3. Exits without generating

### Code Changes

**File: `src/core/dry-run.ts`** (new file)

```typescript
/**
 * Dry-run planning for speak commands.
 */

import { existsSync, statSync, readFileSync } from "fs";
import { basename, extname } from "path";
import pc from "picocolors";
import { estimateDuration, formatEstimate } from "./estimate.ts";
import { chunkText, shouldAutoChunk } from "./chunker.ts";
import { prepareBatchInputs } from "./batch.ts";

export interface DryRunInput {
  path: string;
  exists: boolean;
  size: number;
  textLength: number;
  outputPath: string;
  willChunk: boolean;
  chunkCount?: number;
  estimate?: {
    audioDuration: number;
    generationTime: number;
  };
}

export interface DryRunPlan {
  inputs: DryRunInput[];
  totalInputSize: number;
  totalTextLength: number;
  totalEstimatedDuration: number;
  totalEstimatedTime: number;
  warnings: string[];
}

/**
 * Create a dry-run plan for the given inputs.
 */
export function createDryRunPlan(
  inputPaths: string[],
  options: {
    outputDir: string;
    autoChunk: boolean;
    chunkSize: number;
    timeout: number;
  }
): DryRunPlan {
  const warnings: string[] = [];
  const inputs: DryRunInput[] = [];
  
  let totalInputSize = 0;
  let totalTextLength = 0;
  let totalEstimatedDuration = 0;
  let totalEstimatedTime = 0;
  
  for (const inputPath of inputPaths) {
    const exists = existsSync(inputPath);
    const size = exists ? statSync(inputPath).size : 0;
    const textLength = exists ? readFileSync(inputPath, "utf-8").length : 0;
    
    if (!exists) {
      warnings.push(`File not found: ${inputPath}`);
    }
    
    // Determine output path
    const inputName = basename(inputPath, extname(inputPath));
    const outputPath = `${options.outputDir}/${inputName}.wav`;
    
    // Check if chunking needed
    const text = exists ? readFileSync(inputPath, "utf-8") : "";
    const willChunk = options.autoChunk || shouldAutoChunk(text, options.timeout);
    const chunkCount = willChunk 
      ? chunkText(text, { maxChars: options.chunkSize, overlapChars: 0 }).length 
      : 1;
    
    // Estimate duration
    const estimate = exists ? estimateDuration(text) : null;
    
    inputs.push({
      path: inputPath,
      exists,
      size,
      textLength,
      outputPath,
      willChunk,
      chunkCount,
      estimate: estimate ? {
        audioDuration: estimate.audioDurationSeconds,
        generationTime: estimate.generationTimeSeconds,
      } : undefined,
    });
    
    totalInputSize += size;
    totalTextLength += textLength;
    
    if (estimate) {
      totalEstimatedDuration += estimate.audioDurationSeconds;
      totalEstimatedTime += estimate.generationTimeSeconds;
    }
  }
  
  // Add warnings for large inputs
  if (totalEstimatedTime > 3600) {
    warnings.push(`Total generation time estimated at ${(totalEstimatedTime / 3600).toFixed(1)} hours`);
  }
  
  return {
    inputs,
    totalInputSize,
    totalTextLength,
    totalEstimatedDuration,
    totalEstimatedTime,
    warnings,
  };
}

/**
 * Format dry-run plan for display.
 */
export function formatDryRunPlan(plan: DryRunPlan): string {
  const lines: string[] = [];
  
  lines.push(pc.cyan("Dry run - no audio will be generated\n"));
  
  // Input files
  lines.push(pc.bold(`Input files: ${plan.inputs.length}`));
  
  for (const input of plan.inputs) {
    const sizeStr = formatSize(input.size);
    const statusIcon = input.exists ? pc.green("✓") : pc.red("✗");
    const chunkInfo = input.willChunk 
      ? pc.yellow(` [will chunk: ${input.chunkCount} parts]`)
      : "";
    
    lines.push(`  ${statusIcon} ${input.path} (${sizeStr}) → ${basename(input.outputPath)}${chunkInfo}`);
  }
  
  lines.push("");
  
  // Totals
  lines.push(pc.bold("Summary"));
  lines.push(`  Total input: ${formatSize(plan.totalInputSize)} (${plan.totalTextLength.toLocaleString()} chars)`);
  lines.push(`  Estimated audio: ~${formatDuration(plan.totalEstimatedDuration)}`);
  lines.push(`  Estimated time: ~${formatDuration(plan.totalEstimatedTime)}`);
  
  // Warnings
  if (plan.warnings.length > 0) {
    lines.push("");
    lines.push(pc.yellow(pc.bold("Warnings:")));
    for (const warning of plan.warnings) {
      lines.push(pc.yellow(`  ⚠ ${warning}`));
    }
  }
  
  return lines.join("\n");
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  }
  const hours = Math.floor(seconds / 3600);
  const mins = Math.round((seconds % 3600) / 60);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}
```

**File: `src/index.ts`** (add dry-run handling)

```typescript
// Add option
.option("--dry-run", "Preview what would happen without generating")

// Early in action handler, check for dry-run
if (options.dryRun) {
  const { createDryRunPlan, formatDryRunPlan } = await import("./core/dry-run.ts");
  
  // Collect input files
  let inputPaths: string[];
  if (input.length === 0 && options.clipboard) {
    console.log(pc.cyan("Dry run - clipboard input\n"));
    // Show estimate for clipboard text
    const text = execSync("pbpaste", { encoding: "utf-8" });
    const estimate = estimateDuration(text, options.model);
    console.log(formatEstimate(estimate));
    process.exit(0);
  } else if (input.length === 1 && !existsSync(input[0])) {
    // Direct text input
    console.log(pc.cyan("Dry run - direct text input\n"));
    const estimate = estimateDuration(input[0], options.model);
    console.log(formatEstimate(estimate));
    process.exit(0);
  } else {
    // File inputs
    inputPaths = input.filter((p) => existsSync(p) || p.includes('*'));
    
    // Expand globs
    if (inputPaths.some(p => p.includes('*'))) {
      const glob = await import("glob");
      const expanded: string[] = [];
      for (const p of inputPaths) {
        if (p.includes('*')) {
          expanded.push(...await glob.glob(p));
        } else {
          expanded.push(p);
        }
      }
      inputPaths = expanded;
    }
  }
  
  const plan = createDryRunPlan(inputPaths, {
    outputDir: options.outputDir || options.output,
    autoChunk: options.autoChunk,
    chunkSize: parseInt(options.chunkSize || "6000"),
    timeout: parseInt(options.timeout || "300"),
  });
  
  console.log(formatDryRunPlan(plan));
  process.exit(0);
}
```

### Test Cases

```typescript
// test/unit/dry-run.test.ts

describe('createDryRunPlan', () => {
  it('creates plan for single file', () => {
    // Create test file
    const plan = createDryRunPlan(['test.txt'], {
      outputDir: 'audio/',
      autoChunk: false,
      chunkSize: 6000,
      timeout: 300,
    });
    
    expect(plan.inputs.length).toBe(1);
    expect(plan.inputs[0].outputPath).toBe('audio/test.wav');
  });
  
  it('detects files needing chunking', () => {
    // Create large test file
    const plan = createDryRunPlan(['large.txt'], {
      outputDir: 'audio/',
      autoChunk: true,
      chunkSize: 6000,
      timeout: 300,
    });
    
    expect(plan.inputs[0].willChunk).toBe(true);
    expect(plan.inputs[0].chunkCount).toBeGreaterThan(1);
  });
  
  it('adds warning for missing files', () => {
    const plan = createDryRunPlan(['nonexistent.txt'], {
      outputDir: 'audio/',
      autoChunk: false,
      chunkSize: 6000,
      timeout: 300,
    });
    
    expect(plan.warnings.some(w => w.includes('not found'))).toBe(true);
  });
});
```

### CLI Help

```
Options:
  --dry-run               Preview what would happen without generating

Examples:
  # Preview batch job
  speak chapters/*.txt --output-dir audio/ --dry-run

  # Check chunking for large file
  speak large-doc.md --auto-chunk --dry-run

  # Validate command before running
  speak *.txt --batch --output-dir out/ --dry-run
```

### Example Output

```
$ speak chapters/*.txt --output-dir audio/ --auto-chunk --dry-run

Dry run - no audio will be generated

Input files: 6
  ✓ chapters/ch01.txt (9.7 KB) → ch01.wav
  ✓ chapters/ch02.txt (7.3 KB) → ch02.wav
  ✓ chapters/ch03.txt (23.5 KB) → ch03.wav [will chunk: 4 parts]
  ✓ chapters/ch04.txt (18.2 KB) → ch04.wav [will chunk: 3 parts]
  ✓ chapters/ch05.txt (165.0 KB) → ch05.wav [will chunk: 28 parts]
  ✓ chapters/ch06.txt (45.2 KB) → ch06.wav [will chunk: 8 parts]

Summary
  Total input: 269.0 KB (275,432 chars)
  Estimated audio: ~4h 35m
  Estimated time: ~2h 45m

Warnings:
  ⚠ Total generation time estimated at 2.8 hours
```

### Rollout

1. Implement dry-run plan module
2. Add `--dry-run` flag to CLI
3. Integrate with batch mode
4. Test with various input scenarios
5. Release

### Priority Note

Low priority because:
- Users can estimate manually or just start and cancel
- Most useful for batch operations which is also low priority
- Nice-to-have safety feature

Implement last, after all other issues.
