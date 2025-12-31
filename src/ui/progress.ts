/**
 * Progress display utilities for speak CLI
 *
 * Since TTS generation doesn't provide intermediate progress,
 * we use a spinner with optional ETA based on text length.
 */

import pc from "picocolors";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export interface ProgressOptions {
  text: string;
  showEta?: boolean;
  quiet?: boolean;
}

export interface GenerationProgress {
  chunk: number;
  totalChunks: number;
  charsDone: number;
  charsTotal: number;
}

export interface GenerationStatus {
  phase: "loading_model" | "model_loaded" | "generating";
  model?: string;
  loadTimeMs?: number;
}

export interface Progress {
  start: () => void;
  update: (message: string) => void;
  updateProgress: (progress: GenerationProgress) => void;
  updateStatus: (status: GenerationStatus) => void;
  stop: (success?: boolean, message?: string) => void;
}

/**
 * Estimate audio duration based on text length
 * Based on benchmark: ~150 chars = ~3s audio at normal speed
 */
function estimateAudioDuration(text: string, speed: number = 1.0): number {
  const charsPerSecond = 50; // Approximate speaking rate
  return (text.length / charsPerSecond) / speed;
}

/**
 * Estimate generation time based on text length and expected RTF
 * Based on benchmark: RTF ~0.35x on M1 Max
 */
function estimateGenerationTime(text: string, speed: number = 1.0): number {
  const estimatedDuration = estimateAudioDuration(text, speed);
  const rtf = 0.5; // Conservative estimate (first run may be slower)
  return estimatedDuration * rtf;
}

/**
 * Format seconds as human-readable duration
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  } else if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}m ${secs}s`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.round((seconds % 3600) / 60);
    return `${hours}h ${mins}m`;
  }
}

/**
 * Create a spinner-based progress indicator
 */
export function createSpinner(options: ProgressOptions): Progress {
  const { text, showEta = true, quiet = false } = options;

  let frameIndex = 0;
  let intervalId: Timer | null = null;
  let startTime = 0;
  let currentMessage = "";
  
  // Track progress for ETA calculation
  let lastProgress: GenerationProgress | null = null;
  let charRate = 0; // chars per second based on actual progress

  const estimatedTime = estimateGenerationTime(text);
  const estimatedDuration = estimateAudioDuration(text);

  function render() {
    if (quiet) return;

    const frame = SPINNER_FRAMES[frameIndex];
    frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length;

    const elapsed = (Date.now() - startTime) / 1000;
    let line = `${pc.cyan(frame)} ${currentMessage}`;

    // Show progress-based ETA if we have progress data
    if (lastProgress && lastProgress.charsTotal > 0) {
      const pct = Math.round((lastProgress.charsDone / lastProgress.charsTotal) * 100);
      line = `${pc.cyan(frame)} Generating: ${pct}% (${lastProgress.chunk}/${lastProgress.totalChunks} chunks)`;
      
      // Calculate remaining time based on observed char rate
      if (charRate > 0) {
        const remaining = lastProgress.charsTotal - lastProgress.charsDone;
        const etaSeconds = Math.round(remaining / charRate);
        if (etaSeconds > 0) {
          line += pc.dim(` ~${formatDuration(etaSeconds)} remaining`);
        }
      }
    } else if (showEta && estimatedTime > 2) {
      // Fall back to estimate-based ETA
      const remaining = Math.max(0, estimatedTime - elapsed);
      if (remaining > 0) {
        line += pc.dim(` (ETA: ${formatDuration(remaining)})`);
      } else {
        line += pc.dim(` (finalizing...)`);
      }
    }

    // Clear line and write
    process.stdout.write(`\r\x1b[K${line}`);
  }

  return {
    start() {
      if (quiet) return;
      startTime = Date.now();
      currentMessage = "Generating audio...";

      // Show initial estimate
      if (showEta && estimatedTime > 2) {
        const etaStr = formatDuration(estimatedTime);
        const durationStr = formatDuration(estimatedDuration);
        console.log(pc.dim(`  Estimated: ~${durationStr} of audio (~${etaStr} to generate)`));
      }

      intervalId = setInterval(render, 80);
    },

    update(message: string) {
      currentMessage = message;
    },
    
    updateProgress(progress: GenerationProgress) {
      // Calculate char rate for ETA
      if (progress.charsDone > 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        charRate = progress.charsDone / elapsed;
      }
      lastProgress = progress;
    },

    updateStatus(status: GenerationStatus) {
      // Update message based on status phase
      if (status.phase === "loading_model") {
        currentMessage = `Loading model${status.model ? `: ${status.model}` : ""}...`;
      } else if (status.phase === "model_loaded") {
        // Print model loaded line and switch to generating
        if (!quiet) {
          const loadTime = status.loadTimeMs ? ` (${(status.loadTimeMs / 1000).toFixed(1)}s)` : "";
          process.stdout.write(`\r\x1b[K${pc.green("✓")} Model loaded${loadTime}\n`);
        }
        currentMessage = "Generating audio...";
      } else if (status.phase === "generating") {
        currentMessage = "Generating audio...";
      }
    },

    stop(success = true, message?: string) {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }

      if (quiet) return;

      // Clear the spinner line
      process.stdout.write("\r\x1b[K");

      if (message) {
        const icon = success ? pc.green("✓") : pc.red("✗");
        console.log(`${icon} ${message}`);
      }
    },
  };
}

/**
 * Progress bar for known-length operations (like streaming chunks)
 */
export interface ProgressBarOptions {
  total: number;
  width?: number;
  quiet?: boolean;
}

export interface ProgressBar {
  update: (current: number, message?: string) => void;
  finish: () => void;
}

export function createProgressBar(options: ProgressBarOptions): ProgressBar {
  const { total, width = 30, quiet = false } = options;
  let lastRenderedLine = "";

  function render(current: number, message?: string) {
    if (quiet) return;

    const percent = Math.min(100, Math.round((current / total) * 100));
    const filledWidth = Math.round((current / total) * width);
    const emptyWidth = width - filledWidth;

    const filled = "█".repeat(filledWidth);
    const empty = "░".repeat(emptyWidth);
    const bar = `[${filled}${empty}]`;

    let line = `${bar} ${percent}% (${current}/${total})`;
    if (message) {
      line += ` ${pc.dim(message)}`;
    }

    if (line !== lastRenderedLine) {
      process.stdout.write(`\r\x1b[K${line}`);
      lastRenderedLine = line;
    }
  }

  return {
    update(current: number, message?: string) {
      render(current, message);
    },

    finish() {
      if (!quiet) {
        process.stdout.write("\n");
      }
    },
  };
}
