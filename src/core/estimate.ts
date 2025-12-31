/**
 * Duration and time estimation for TTS generation.
 */

import { logDecision } from "../ui/logger.ts";

// Default RTF values by model type
const DEFAULT_RTF = {
  "8bit": 0.4,
  fp16: 0.5,
  "4bit": 0.35,
  default: 0.45,
} as const;

export interface Estimate {
  inputChars: number;
  inputWords: number;
  audioDurationSeconds: number;
  audioDurationMinutes: number;
  generationTimeSeconds: number;
  generationTimeMinutes: number;
  rtf: number;
}

/**
 * Get RTF for a model.
 */
function getRtf(model?: string): number {
  if (model) {
    if (model.includes("8bit")) {
      return DEFAULT_RTF["8bit"];
    }
    if (model.includes("fp16")) {
      return DEFAULT_RTF.fp16;
    }
    if (model.includes("4bit")) {
      return DEFAULT_RTF["4bit"];
    }
  }

  return DEFAULT_RTF.default;
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
  const rtf = getRtf(model);
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
  };
}

/**
 * Format estimate for display.
 */
export function formatEstimate(estimate: Estimate): string {
  const lines: string[] = [];

  lines.push(
    `Input: ${estimate.inputChars.toLocaleString()} characters (~${estimate.inputWords.toLocaleString()} words)`
  );
  lines.push(`Estimated audio: ~${formatDuration(estimate.audioDurationSeconds)}`);
  lines.push(
    `Estimated generation time: ~${formatDuration(estimate.generationTimeSeconds)}`
  );
  lines.push(`RTF: ${estimate.rtf.toFixed(2)}x`);

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
export function shouldConfirm(
  estimate: Estimate,
  thresholdMinutes: number = 5
): boolean {
  return estimate.generationTimeMinutes >= thresholdMinutes;
}
