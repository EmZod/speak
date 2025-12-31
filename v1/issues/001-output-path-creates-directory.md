# Output path flag creates directory instead of file

## Type
Bug

## Severity
High - Major UX issue

## Description
When using `--output path/to/file.wav`, the tool creates a directory named `file.wav/` containing an auto-named file inside, rather than creating `file.wav` as the actual output file.

## Expected Behavior
```bash
speak "Hello" --output audio/greeting.wav
# Creates: audio/greeting.wav
```

## Actual Behavior
```bash
speak "Hello" --output audio/greeting.wav
# Creates: audio/greeting.wav/speak_2025-12-31_093524.wav
```

## Workaround
Use `--output` with a directory path, then rename the auto-generated file:
```bash
speak "Hello" --output audio/
mv audio/speak_*.wav audio/greeting.wav
```

---

## Investigation

### Root Cause Analysis

Looking at `src/core/output.ts`:

```typescript
export function prepareOutputPath(outputDir: string): string {
  const expandedDir = expandPath(outputDir);

  if (!existsSync(expandedDir)) {
    mkdirSync(expandedDir, { recursive: true });  // <-- PROBLEM: Always creates as directory
  }

  const filename = generateFilename();
  return join(expandedDir, filename);  // <-- Always appends auto-generated filename
}
```

The function `prepareOutputPath` unconditionally:
1. Treats `outputDir` as a directory path
2. Creates it with `mkdirSync` if it doesn't exist
3. Appends an auto-generated filename

There's no logic to detect whether the user intended to specify a filename vs a directory.

### State Inventory

| State | Current Owner | Issue |
|-------|---------------|-------|
| Output path interpretation | `prepareOutputPath` | No distinction between file/directory intent |
| Filename generation | `generateFilename` | Always generates, even when user provided name |
| Directory creation | `mkdirSync` | Blindly creates, even for `.wav` paths |

### Failure Modes

| Scenario | Current Behavior | Expected |
|----------|------------------|----------|
| `--output dir/` | Works correctly | Works correctly |
| `--output dir` | Creates `dir/speak_*.wav` | Creates `dir/speak_*.wav` |
| `--output dir/file.wav` | Creates `dir/file.wav/speak_*.wav` | Creates `dir/file.wav` |
| `--output file.wav` | Creates `file.wav/speak_*.wav` | Creates `file.wav` |

---

## Implementation Plan

### Design Principles Applied

1. **Simple and boring** — Use path extension detection, a well-understood pattern
2. **Log the decisions** — Log whether we interpreted input as file or directory
3. **State ownership** — Single function owns output path resolution

### Approach

Detect user intent by checking if the path ends with a known audio extension. If yes, treat as filename. If no, treat as directory.

### Code Changes

**File: `src/core/output.ts`**

```typescript
import { existsSync, mkdirSync, copyFileSync, renameSync } from "fs";
import { join, basename, dirname, extname } from "path";
import { expandPath } from "./config.ts";
import { logDecision } from "../ui/logger.ts";

// Supported audio extensions for output files
const AUDIO_EXTENSIONS = [".wav", ".mp3", ".flac", ".ogg", ".m4a"];

/**
 * Determine if path looks like a file (has audio extension) or directory
 */
function isFilePath(path: string): boolean {
  const ext = extname(path).toLowerCase();
  return AUDIO_EXTENSIONS.includes(ext);
}

/**
 * Prepare output path, handling both file and directory specifications.
 * 
 * - If path ends with audio extension: use as-is (create parent dir)
 * - If path ends with / or has no extension: treat as directory, generate filename
 */
export function prepareOutputPath(outputPath: string): string {
  const expanded = expandPath(outputPath);
  
  if (isFilePath(expanded)) {
    // User specified a filename
    const dir = dirname(expanded);
    
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    
    logDecision(
      "Using user-specified output filename",
      "Path has audio extension",
      { output_path: expanded, directory: dir }
    );
    
    return expanded;
  }
  
  // User specified a directory (or path without extension)
  if (!existsSync(expanded)) {
    mkdirSync(expanded, { recursive: true });
  }
  
  const filename = generateFilename();
  const fullPath = join(expanded, filename);
  
  logDecision(
    "Generated output filename",
    "Path appears to be directory",
    { output_dir: expanded, filename, full_path: fullPath }
  );
  
  return fullPath;
}
```

**File: `src/index.ts`** (update `--output` option description)

```typescript
.option("-o, --output <path>", "Output file (.wav) or directory", config.output_dir)
```

### Test Cases

```typescript
// test/unit/output.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { prepareOutputPath } from '../src/core/output';
import { existsSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';

const TEST_DIR = '/tmp/speak-test-output';

describe('prepareOutputPath', () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  it('treats .wav path as filename', () => {
    const result = prepareOutputPath(join(TEST_DIR, 'output.wav'));
    expect(result).toBe(join(TEST_DIR, 'output.wav'));
    expect(existsSync(TEST_DIR)).toBe(true);
  });

  it('treats directory path as directory and generates filename', () => {
    const result = prepareOutputPath(join(TEST_DIR, 'subdir'));
    expect(result).toMatch(/subdir\/speak_\d{4}-\d{2}-\d{2}_\d{6}\.wav$/);
    expect(existsSync(join(TEST_DIR, 'subdir'))).toBe(true);
  });

  it('creates parent directories for file path', () => {
    const result = prepareOutputPath(join(TEST_DIR, 'a/b/c/output.wav'));
    expect(result).toBe(join(TEST_DIR, 'a/b/c/output.wav'));
    expect(existsSync(join(TEST_DIR, 'a/b/c'))).toBe(true);
  });

  it('handles trailing slash as directory', () => {
    const result = prepareOutputPath(join(TEST_DIR, 'explicit-dir/'));
    expect(result).toMatch(/explicit-dir\/speak_.*\.wav$/);
  });

  it('handles path with no extension as directory', () => {
    const result = prepareOutputPath(join(TEST_DIR, 'no-extension'));
    expect(result).toMatch(/no-extension\/speak_.*\.wav$/);
  });

  it('recognizes various audio extensions', () => {
    for (const ext of ['.wav', '.mp3', '.flac', '.ogg', '.m4a']) {
      const result = prepareOutputPath(join(TEST_DIR, `file${ext}`));
      expect(result).toBe(join(TEST_DIR, `file${ext}`));
    }
  });
});
```

### Migration / Breaking Changes

**Potentially breaking**: Users who have scripts relying on the current (buggy) behavior where `--output file.wav` creates a directory will see different behavior.

**Mitigation**: This is a bug fix. The new behavior matches user expectation and documentation intent.

### Rollout

1. Implement change
2. Add tests
3. Update help text for `--output` to clarify it accepts file or directory
4. Release in next minor version

### Verification

After implementation:
```bash
# Should create audio/greeting.wav directly
speak "Hello" --output audio/greeting.wav
ls -la audio/greeting.wav  # Should be a file, not directory

# Should still work with directory
speak "Hello" --output audio/
ls -la audio/speak_*.wav  # Should see auto-named file
```
