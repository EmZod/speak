/**
 * Audio file concatenation using sox.
 */

import { execSync, spawnSync } from "child_process";
import { existsSync, unlinkSync, copyFileSync } from "fs";
import { logger, logDecision } from "../ui/logger.ts";

/**
 * Check if sox is available.
 */
export function hasSox(): boolean {
  try {
    execSync("which sox", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Concatenate multiple WAV files into one.
 *
 * @param inputFiles Array of paths to input WAV files (in order)
 * @param outputFile Path for output WAV file
 * @returns true on success
 */
export function concatenateWav(
  inputFiles: string[],
  outputFile: string
): boolean {
  if (inputFiles.length === 0) {
    throw new Error("No input files to concatenate");
  }

  if (inputFiles.length === 1) {
    // Just copy the single file
    const singleFile = inputFiles[0];
    if (singleFile) {
      copyFileSync(singleFile, outputFile);
    }
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
    { input_count: inputFiles.length }
  );

  const result = spawnSync("sox", [...inputFiles, outputFile], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    const stderr = result.stderr?.toString() || "unknown error";
    throw new Error(`sox failed: ${stderr}`);
  }

  return true;
}

/**
 * Clean up temporary chunk files.
 */
export function cleanupChunkFiles(files: string[]): void {
  for (const file of files) {
    try {
      if (existsSync(file)) {
        unlinkSync(file);
      }
    } catch (error) {
      logger.warn("Failed to cleanup temp file", {
        file,
        error: String(error),
      });
    }
  }
}
