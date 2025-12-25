/**
 * Output path handling for speak CLI
 */

import { existsSync, mkdirSync, copyFileSync } from "fs";
import { join, basename } from "path";
import { expandPath } from "./config.ts";
import type { ChildProcess } from "child_process";

/**
 * Generate output filename with timestamp
 * Format: speak_YYYY-MM-DD_HHMMSS.wav
 */
export function generateFilename(): string {
  const now = new Date();
  const date = now.toISOString().split("T")[0]; // YYYY-MM-DD
  const time = now.toTimeString().split(" ")[0].replace(/:/g, ""); // HHMMSS
  return `speak_${date}_${time}.wav`;
}

/**
 * Ensure output directory exists and return full output path
 */
export function prepareOutputPath(outputDir: string): string {
  const expandedDir = expandPath(outputDir);

  if (!existsSync(expandedDir)) {
    mkdirSync(expandedDir, { recursive: true });
  }

  const filename = generateFilename();
  return join(expandedDir, filename);
}

/**
 * Copy audio file from temp location to output path
 */
export function copyToOutput(tempPath: string, outputDir: string): string {
  const outputPath = prepareOutputPath(outputDir);
  copyFileSync(tempPath, outputPath);
  return outputPath;
}

// Track current audio player process for cleanup
let currentPlayer: ChildProcess | null = null;

/**
 * Kill any running audio playback
 */
export function stopAudio(): void {
  if (currentPlayer) {
    currentPlayer.kill("SIGTERM");
    currentPlayer = null;
  }
}

/**
 * Play audio file using afplay (macOS)
 */
export async function playAudio(path: string): Promise<void> {
  const { spawn } = await import("child_process");

  return new Promise((resolve, reject) => {
    const player = spawn("afplay", [path]);
    currentPlayer = player;

    player.on("close", (code) => {
      currentPlayer = null;
      if (code === 0 || code === null) {
        resolve();
      } else {
        reject(new Error(`afplay exited with code ${code}`));
      }
    });

    player.on("error", (err) => {
      currentPlayer = null;
      reject(err);
    });
  });
}

// Track if cleanup handlers are registered
let cleanupRegistered = false;
let cleanupCallback: (() => Promise<void>) | undefined;

/**
 * Register cleanup handlers for graceful shutdown
 */
export function registerCleanupHandlers(onCleanup?: () => Promise<void>): void {
  if (cleanupRegistered) return;
  cleanupRegistered = true;
  cleanupCallback = onCleanup;

  const cleanup = async () => {
    stopAudio();
    if (cleanupCallback) {
      await cleanupCallback();
    }
    process.exit(0);
  };

  // Use 'once' so handlers auto-remove after firing
  process.once("SIGINT", cleanup);
  process.once("SIGTERM", cleanup);
}

/**
 * Remove cleanup handlers to allow process to exit naturally
 */
export function removeCleanupHandlers(): void {
  cleanupRegistered = false;
  cleanupCallback = undefined;
  // Note: 'once' handlers are auto-removed, but we clear our state
}
