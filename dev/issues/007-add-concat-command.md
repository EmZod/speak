# Add built-in concatenation command

## Type
Feature Request

## Severity
Low

## Description
After generating multiple audio parts, users must use external tools (sox, ffmpeg) to concatenate them. A built-in concat feature would complete the workflow.

## Current Workflow
```bash
# Generate parts
speak part1.txt --output audio/
speak part2.txt --output audio/
speak part3.txt --output audio/

# Concatenate with external tool
sox audio/speak_*.wav combined.wav
```

## Proposed Workflow
```bash
# Option A: Concat existing files
speak concat audio/*.wav --output combined.wav

# Option B: Generate and concat in one step
speak part1.txt part2.txt part3.txt --concat --output combined.wav
```

---

## Investigation

### Related Issues

- **Issue #004** (auto-chunking) — Already needs concat internally
- **Issue #006** (batch mode) — Could optionally concat batch output

The concatenation functionality will be implemented for #004. This issue is about exposing it as a standalone command.

### Design Questions

1. **Subcommand vs flag?**
   - Subcommand: `speak concat file1.wav file2.wav`
   - Flag: `speak --concat-only file1.wav file2.wav`
   - **Answer**: Subcommand is cleaner for pure concat operations

2. **Dependencies?**
   - sox (already used internally)
   - ffmpeg (more common, more features)
   - Native audio library
   - **Answer**: sox for consistency with #004

3. **Additional features?**
   - Crossfade between files?
   - Normalize volume?
   - **Answer**: Keep it simple, just concatenate. Advanced users can use sox directly.

---

## Implementation Plan

### Design Principles Applied

1. **Simple and boring** — Wrapper around sox, nothing fancy
2. **Single responsibility** — Just concat, don't do generation

### Approach

Add `speak concat` subcommand that:
1. Takes list of audio files as arguments
2. Validates they exist and are readable
3. Calls sox to concatenate
4. Outputs to specified path

### Code Changes

**File: `src/index.ts`** (add concat subcommand)

```typescript
// Subcommand: concat
program
  .command("concat <files...>")
  .description("Concatenate multiple audio files into one")
  .option("-o, --output <file>", "Output file path", "combined.wav")
  .option("--normalize", "Normalize volume across files")
  .action(async (files: string[], options) => {
    const { concatenateWav, hasSox } = await import("./core/concatenate.ts");
    const { initLogger, logger } = await import("./ui/logger.ts");
    
    initLogger({ logLevel: config.log_level });
    
    // Check sox availability
    if (!hasSox()) {
      console.log(pc.red("Error: sox is required for concatenation but not found."));
      console.log(pc.dim("Install with: brew install sox"));
      process.exit(1);
    }
    
    // Validate input files
    const missing = files.filter((f) => !existsSync(f));
    if (missing.length > 0) {
      console.log(pc.red("Error: Files not found:"));
      for (const f of missing) {
        console.log(pc.red(`  - ${f}`));
      }
      process.exit(1);
    }
    
    // Sort files naturally (for numbered sequences)
    const sortedFiles = [...files].sort((a, b) => {
      return a.localeCompare(b, undefined, { numeric: true });
    });
    
    if (!options.quiet) {
      console.log(pc.cyan(`Concatenating ${sortedFiles.length} files...`));
      for (const f of sortedFiles) {
        console.log(pc.dim(`  - ${basename(f)}`));
      }
    }
    
    try {
      const outputPath = expandPath(options.output);
      
      // Ensure output directory exists
      const outputDir = dirname(outputPath);
      if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
      }
      
      concatenateWav(sortedFiles, outputPath, { normalize: options.normalize });
      
      // Get duration of output
      const duration = await getAudioDuration(outputPath);
      
      if (!options.quiet) {
        console.log(pc.green(`✓ Created ${outputPath}`));
        console.log(pc.dim(`  Duration: ${duration.toFixed(1)}s`));
      }
      
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(pc.red(`Error: ${message}`));
      process.exit(1);
    }
  });
```

**File: `src/core/concatenate.ts`** (extend for normalize option)

```typescript
export interface ConcatOptions {
  normalize?: boolean;
}

/**
 * Concatenate multiple WAV files into one.
 */
export function concatenateWav(
  inputFiles: string[],
  outputFile: string,
  options: ConcatOptions = {}
): boolean {
  if (inputFiles.length === 0) {
    throw new Error("No input files to concatenate");
  }
  
  if (inputFiles.length === 1) {
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
    { input_count: inputFiles.length, normalize: options.normalize }
  );
  
  // Build sox command
  const args = [...inputFiles, outputFile];
  
  // Add normalize effect if requested
  if (options.normalize) {
    args.push("norm");
  }
  
  const result = spawnSync("sox", args, {
    stdio: ["ignore", "pipe", "pipe"],
  });
  
  if (result.status !== 0) {
    const stderr = result.stderr?.toString() || "unknown error";
    throw new Error(`sox failed: ${stderr}`);
  }
  
  return true;
}

/**
 * Get audio file duration using sox.
 */
export async function getAudioDuration(path: string): Promise<number> {
  const { execSync } = await import("child_process");
  
  try {
    const output = execSync(`sox --info -D "${path}"`, { encoding: "utf-8" });
    return parseFloat(output.trim());
  } catch {
    return 0;
  }
}
```

### Test Cases

```typescript
// test/integration/concat.test.ts

describe('speak concat', () => {
  it('concatenates multiple wav files', async () => {
    // Create test wav files
    // Run speak concat
    // Verify output duration equals sum of inputs
  });
  
  it('sorts files naturally', async () => {
    // Create: part_1.wav, part_2.wav, part_10.wav
    // Run concat in random order
    // Verify correct sequence in output
  });
  
  it('errors on missing files', async () => {
    // Run with nonexistent file
    // Verify error message
  });
  
  it('handles single file', async () => {
    // Run with single file
    // Verify copied to output
  });
});
```

### CLI Help

```
Usage: speak concat [options] <files...>

Concatenate multiple audio files into one

Arguments:
  files                    Audio files to concatenate (in order)

Options:
  -o, --output <file>      Output file path (default: "combined.wav")
  --normalize              Normalize volume across files
  -h, --help               Display help

Examples:
  # Concatenate in alphabetical order
  speak concat chapter_*.wav --output book.wav

  # Explicit order
  speak concat intro.wav body.wav outro.wav -o podcast.wav

  # With volume normalization
  speak concat *.wav -o combined.wav --normalize
```

### Error Messages

```
# Missing sox
Error: sox is required for concatenation but not found.
Install with: brew install sox

# Missing files
Error: Files not found:
  - missing_file.wav
  - another_missing.wav

# sox failure
Error: sox failed: <error details>
```

### Rollout

1. Ensure `concatenate.ts` is complete (from #004)
2. Add `concat` subcommand
3. Add duration reporting
4. Test with various file counts
5. Release

### Priority Note

Very low priority because:
- sox is readily available
- Users comfortable with command line can use sox directly
- Nice-to-have for workflow completeness

Implement last, after all other issues.
