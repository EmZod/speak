/**
 * Audio device detection and availability checking.
 *
 * Determines which audio playback method is available on the system:
 * - node-speaker (preferred, streaming capable)
 * - afplay (macOS fallback)
 * - aplay (Linux fallback)
 */

import { execSync } from "child_process";
import { logger } from "../ui/logger.ts";

export type AudioMethod = "speaker" | "afplay" | "aplay" | "none";

export interface AudioAvailability {
  available: boolean;
  method: AudioMethod;
  error?: string;
}

/**
 * Check if audio playback is available on this system.
 * Tries node-speaker first, then falls back to system tools.
 */
export async function checkAudioAvailable(): Promise<AudioAvailability> {
  // Try node-speaker first (preferred for streaming)
  try {
    const Speaker = (await import("speaker")).default;
    // Create a test speaker to verify it works
    const testSpeaker = new Speaker({
      channels: 1,
      bitDepth: 16,
      sampleRate: 24000,
    });
    testSpeaker.close();

    return { available: true, method: "speaker" };
  } catch (speakerError) {
    logger.debug("node-speaker not available", { error: String(speakerError) });
  }

  // Fall back to afplay (macOS)
  try {
    execSync("which afplay", { timeout: 1000 });
    return { available: true, method: "afplay" };
  } catch {
    logger.debug("afplay not available");
  }

  // Fall back to aplay (Linux)
  try {
    execSync("which aplay", { timeout: 1000 });
    return { available: true, method: "aplay" };
  } catch {
    logger.debug("aplay not available");
  }

  return {
    available: false,
    method: "none",
    error: "No audio playback method available. Install portaudio (for speaker) or use macOS/Linux.",
  };
}

/**
 * Check if a specific audio method is available.
 */
export function checkMethodAvailable(method: AudioMethod): boolean {
  switch (method) {
    case "speaker":
      try {
        require.resolve("speaker");
        return true;
      } catch {
        return false;
      }
    case "afplay":
      try {
        execSync("which afplay", { timeout: 1000 });
        return true;
      } catch {
        return false;
      }
    case "aplay":
      try {
        execSync("which aplay", { timeout: 1000 });
        return true;
      } catch {
        return false;
      }
    default:
      return false;
  }
}
