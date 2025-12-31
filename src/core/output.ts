/**
 * Output path handling for speak CLI
 */

import { existsSync, mkdirSync, copyFileSync } from "fs";
import { join, basename, dirname, extname } from "path";
import { expandPath } from "./config.ts";
import { logDecision } from "../ui/logger.ts";
import type { ChildProcess } from "child_process";

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
