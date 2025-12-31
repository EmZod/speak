# Add estimated duration before generation

## Type
Feature Request

## Severity
Low

## Description
Before starting generation, show estimated audio duration and generation time. Helps users plan and decide whether to proceed.

## Current Behavior
```bash
speak chapter.txt --output chapter.wav
# Immediately starts generating with no preview
```

## Proposed Behavior
```bash
speak chapter.txt --output chapter.wav
# Input: 24,011 characters (~4,800 words)
# Estimated audio duration: ~25 minutes
# Estimated generation time: ~18 minutes (RTF: 0.7x)
# Proceed? [Y/n]
```

Or with a flag:
```bash
speak chapter.txt --estimate
# Input: 24,011 characters (~4,800 words)
# Estimated audio duration: ~25 minutes
# Estimated generation time: ~18 minutes (RTF: 0.7x)
# (no generation, just estimate)
```

---

## Investigation

### Estimation Model

Based on empirical data from audiobook generation:
- Average speaking rate: ~150 words per minute
- Average word length: ~5 characters
- RTF (Real-Time Factor) on M1 Max: ~0.35-0.5x (generation faster than playback)

Estimation formula:
```
words = characters / 5
audio_minutes = words / 150
generation_minutes = audio_minutes * RTF
```

The RTF varies by:
- Model (8-bit faster than fp16)
- Hardware (M3 Max faster than M1)
- Text complexity (simple text faster)

### Design Questions

1. **Prompt by default or opt-in?**
   - Default prompt for long text could be annoying for scripts
   - **Answer**: Opt-in with `--confirm` flag, always show estimate, prompt only with flag

2. **Where to show estimate?**
   - Before generation starts (current plan)
   - In progress display (already planned for #002)
   - **Answer**: Both - show before, update during

3. **RTF calibration?**
   - Hardcoded value based on common hardware
   - Calibrate on first run
   - **Answer**: Hardcoded with --calibrate option for tuning

---

## Implementation Plan

### Design Principles Applied

1. **Simple and boring** — Simple formula, no ML-based prediction
2. **Log the decisions** — Log estimation parameters for debugging
3. **Operations are part of design** — Help users plan resource usage

### Approach

1. Add `estimateDuration()` function
2. Show estimate before generation (always, not just long text)
3. Add `--estimate` flag for dry-run
4. Add `--confirm` flag to prompt before long generations
5. Add `--calibrate` command to measure local RTF

### Code Changes

**File: `src/core/estimate.ts`** (new file)

```typescript
/**
 * Duration and time estimation for TTS generation.
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { CHATTER_DIR } from "./config.ts";
import { logDecision } from "../ui/logger.ts";

// Default RTF values by model type
const DEFAULT_RTF: Record<string, number> = {
  "8bit": 0.4,
  "fp16": 0.5,
  "4bit": 0.35,
  default: 0.45,
};

const CALIBRATION_FILE = join(CHATTER_DIR, "rtf_calibration.json");

export interface CalibrationData {
  model: string;
  rtf: number;
  samples: number;
  updated: string;
}

export interface Estimate {
  inputChars: number;
  inputWords: number;
  audioDurationSeconds: number;
  audioDurationMinutes: number;
  generationTimeSeconds: number;
  generationTimeMinutes: number;
  rtf: number;
  isCalibrated: boolean;
}

/**
 * Load calibration data if available.
 */
function loadCalibration(model: string): CalibrationData | null {
  if (!existsSync(CALIBRATION_FILE)) {
    return null;
  }
  
  try {
    const data = JSON.parse(readFileSync(CALIBRATION_FILE, "utf-8"));
    return data[model] || null;
  } catch {
    return null;
  }
}

/**
 * Save calibration data.
 */
export function saveCalibration(model: string, rtf: number, samples: number): void {
  let data: Record<string, CalibrationData> = {};
  
  if (existsSync(CALIBRATION_FILE)) {
    try {
      data = JSON.parse(readFileSync(CALIBRATION_FILE, "utf-8"));
    } catch {
      // Start fresh
    }
  }
  
  data[model] = {
    model,
    rtf,
    samples,
    updated: new Date().toISOString(),
  };
  
  writeFileSync(CALIBRATION_FILE, JSON.stringify(data, null, 2));
}

/**
 * Get RTF for a model.
 */
function getRtf(model?: string): { rtf: number; isCalibrated: boolean } {
  if (model) {
    // Check for calibration
    const calibration = loadCalibration(model);
    if (calibration) {
      return { rtf: calibration.rtf, isCalibrated: true };
    }
    
    // Use model-type default
    if (model.includes("8bit")) {
      return { rtf: DEFAULT_RTF["8bit"], isCalibrated: false };
    }
    if (model.includes("fp16")) {
      return { rtf: DEFAULT_RTF["fp16"], isCalibrated: false };
    }
    if (model.includes("4bit")) {
      return { rtf: DEFAULT_RTF["4bit"], isCalibrated: false };
    }
  }
  
  return { rtf: DEFAULT_RTF.default, isCalibrated: false };
}

/**
 * Estimate duration and generation time.
 */
export function estimateDuration(text: string, model?: string): Estimate {
  const inputChars = text.length;
  const inputWords = Math.round(inputChars / 5);
  
  // ~150 words per minute speaking rate
  const audioDurationMinutes = inputWords / 150;
  const audioDurationSeconds = audioDurationMinutes * 60;
  
  // Generation time based on RTF
  const { rtf, isCalibrated } = getRtf(model);
  const generationTimeSeconds = audioDurationSeconds * rtf;
  const generationTimeMinutes = generationTimeSeconds / 60;
  
  logDecision(
    "Estimated generation parameters",
    `${inputChars} chars → ~${audioDurationMinutes.toFixed(1)} min audio`,
    {
      input_chars: inputChars,
      input_words: inputWords,
      audio_minutes: audioDurationMinutes,
      generation_minutes: generationTimeMinutes,
      rtf,
      is_calibrated: isCalibrated,
    }
  );
  
  return {
    inputChars,
    inputWords,
    audioDurationSeconds,
    audioDurationMinutes,
    generationTimeSeconds,
    generationTimeMinutes,
    rtf,
    isCalibrated,
  };
}

/**
 * Format estimate for display.
 */
export function formatEstimate(estimate: Estimate): string {
  const lines: string[] = [];
  
  lines.push(`Input: ${estimate.inputChars.toLocaleString()} characters (~${estimate.inputWords.toLocaleString()} words)`);
  lines.push(`Estimated audio: ~${formatDuration(estimate.audioDurationSeconds)}`);
  lines.push(`Estimated generation time: ~${formatDuration(estimate.generationTimeSeconds)}`);
  
  const calibrationNote = estimate.isCalibrated
    ? "(calibrated)"
    : "(estimated, run 'speak calibrate' for accuracy)";
  lines.push(`RTF: ${estimate.rtf.toFixed(2)}x ${calibrationNote}`);
  
  return lines.join("\n");
}

/**
 * Format seconds as human-readable duration.
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  
  const minutes = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  
  if (minutes < 60) {
    return secs > 0 ? `${minutes}m ${secs}s` : `${minutes}m`;
  }
  
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

/**
 * Check if text is long enough to warrant a confirmation prompt.
 */
export function shouldConfirm(estimate: Estimate, thresholdMinutes: number = 5): boolean {
  return estimate.generationTimeMinutes >= thresholdMinutes;
}
```

**File: `src/index.ts`** (add estimate display and flags)

```typescript
// Add options
.option("--estimate", "Show duration estimate without generating")
.option("--confirm", "Prompt before starting long generations")
.option("--no-estimate", "Skip estimate display")

// Before generation, show estimate
const { estimateDuration, formatEstimate, shouldConfirm } = await import("./core/estimate.ts");

const estimate = estimateDuration(text, options.model);

if (options.estimate) {
  // Dry-run: just show estimate
  console.log(pc.cyan("\nGeneration Estimate\n"));
  console.log(formatEstimate(estimate));
  console.log();
  process.exit(0);
}

// Show estimate before generation (unless --no-estimate)
if (!options.quiet && options.estimate !== false) {
  console.log(pc.dim(formatEstimate(estimate)));
  console.log();
}

// Prompt for confirmation if long and --confirm specified
if (options.confirm && shouldConfirm(estimate)) {
  const { createInterface } = await import("readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  
  const answer = await new Promise<string>((resolve) => {
    rl.question(pc.yellow("Proceed with generation? [Y/n] "), resolve);
  });
  rl.close();
  
  if (answer.toLowerCase() === "n") {
    console.log(pc.dim("Cancelled."));
    process.exit(0);
  }
}

// Continue with generation...
```

**File: `src/index.ts`** (add calibrate subcommand)

```typescript
// Subcommand: calibrate
program
  .command("calibrate")
  .description("Calibrate RTF estimation for your hardware")
  .option("-m, --model <name>", "Model to calibrate", config.model)
  .action(async (options) => {
    const { saveCalibration } = await import("./core/estimate.ts");
    const { generate } = await import("./bridge/client.ts");
    const { startDaemon, stopDaemon } = await import("./bridge/daemon.ts");
    
    console.log(pc.cyan("Calibrating RTF for your hardware...\n"));
    
    // Use a standard test text
    const testText = `
      This is a calibration test. The quick brown fox jumps over the lazy dog.
      We measure how fast audio is generated compared to its playback duration.
      This helps estimate generation time for longer documents.
    `.trim();
    
    // Ensure daemon is running
    await startDaemon();
    
    const samples: number[] = [];
    
    for (let i = 0; i < 3; i++) {
      console.log(pc.dim(`  Test ${i + 1}/3...`));
      
      const startTime = Date.now();
      const result = await generate({
        text: testText,
        model: options.model,
      });
      const elapsedSeconds = (Date.now() - startTime) / 1000;
      
      const rtf = elapsedSeconds / result.duration;
      samples.push(rtf);
      
      console.log(pc.dim(`    Duration: ${result.duration.toFixed(1)}s, Time: ${elapsedSeconds.toFixed(1)}s, RTF: ${rtf.toFixed(2)}x`));
    }
    
    // Use median RTF
    samples.sort((a, b) => a - b);
    const medianRtf = samples[Math.floor(samples.length / 2)];
    
    saveCalibration(options.model, medianRtf, samples.length);
    
    console.log(pc.green(`\n✓ Calibrated RTF: ${medianRtf.toFixed(2)}x`));
    console.log(pc.dim(`  Saved to ~/.chatter/rtf_calibration.json`));
    
    await stopDaemon();
  });
```

### Test Cases

```typescript
// test/unit/estimate.test.ts

describe('estimateDuration', () => {
  it('estimates short text correctly', () => {
    const estimate = estimateDuration('Hello world', undefined);
    
    expect(estimate.inputChars).toBe(11);
    expect(estimate.inputWords).toBe(2);
    expect(estimate.audioDurationSeconds).toBeCloseTo(0.8, 1); // ~2 words at 150 wpm
  });
  
  it('estimates long text correctly', () => {
    const longText = 'word '.repeat(3000); // 3000 words
    const estimate = estimateDuration(longText, undefined);
    
    expect(estimate.audioDurationMinutes).toBeCloseTo(20, 1); // 3000/150 = 20 min
  });
  
  it('uses model-specific RTF', () => {
    const text = 'Test text for estimation';
    
    const estimate8bit = estimateDuration(text, 'model-8bit');
    const estimateFp16 = estimateDuration(text, 'model-fp16');
    
    expect(estimate8bit.rtf).toBeLessThan(estimateFp16.rtf);
  });
  
  it('uses calibrated RTF when available', () => {
    // Save mock calibration
    saveCalibration('test-model', 0.25, 3);
    
    const estimate = estimateDuration('Test', 'test-model');
    
    expect(estimate.rtf).toBe(0.25);
    expect(estimate.isCalibrated).toBe(true);
  });
});
```

### CLI Help

```
Options:
  --estimate              Show duration estimate without generating
  --confirm               Prompt before starting long generations
  --no-estimate           Skip estimate display

Commands:
  calibrate               Calibrate RTF estimation for your hardware

Examples:
  # Just see the estimate
  speak long-document.md --estimate

  # Generate with confirmation for long text
  speak long-document.md --confirm

  # Skip estimate display in scripts
  speak "Hello" --no-estimate --quiet
```

### Rollout

1. Implement estimate module
2. Add estimate display to main flow
3. Add `--estimate` dry-run flag
4. Add `--confirm` prompt flag
5. Add `calibrate` subcommand
6. Test with various text lengths
7. Release

### Priority Note

Low priority because:
- Not blocking any workflows
- Users can estimate manually
- Nice UX polish

Implement after core issues (#001-#004) are resolved.
