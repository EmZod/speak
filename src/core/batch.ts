/**
 * Batch processing for multiple input files.
 */

import { existsSync, statSync } from "fs";
import { basename, extname, join } from "path";
import { logDecision } from "../ui/logger.ts";

export interface BatchInput {
  inputPath: string;
  outputPath: string;
  exists: boolean;
  size: number;
  skip: boolean;
}

export interface BatchOptions {
  outputDir: string;
  skipExisting: boolean;
}

/**
 * Prepare batch inputs with output paths.
 */
export function prepareBatchInputs(
  inputPaths: string[],
  options: BatchOptions
): BatchInput[] {
  const { outputDir, skipExisting } = options;

  return inputPaths.map((inputPath) => {
    // Derive output filename from input
    const inputName = basename(inputPath, extname(inputPath));
    const outputPath = join(outputDir, `${inputName}.wav`);

    const exists = existsSync(inputPath);
    const size = exists ? statSync(inputPath).size : 0;

    const outputExists = existsSync(outputPath);

    return {
      inputPath,
      outputPath,
      exists,
      size,
      skip: skipExisting && outputExists,
    };
  });
}

/**
 * Validate batch inputs.
 */
export function validateBatchInputs(inputs: BatchInput[]): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  for (const input of inputs) {
    if (!input.exists) {
      errors.push(`File not found: ${input.inputPath}`);
    }
  }

  // Check for duplicate output paths
  const outputPaths = new Set<string>();
  for (const input of inputs) {
    if (outputPaths.has(input.outputPath)) {
      errors.push(`Duplicate output path: ${input.outputPath}`);
    }
    outputPaths.add(input.outputPath);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export interface BatchResult {
  inputPath: string;
  outputPath: string;
  success: boolean;
  duration?: number;
  error?: string;
  skipped: boolean;
}

export interface BatchSummary {
  total: number;
  success: number;
  failed: number;
  skipped: number;
  totalDuration: number;
  results: BatchResult[];
}

/**
 * Create batch summary from results.
 */
export function summarizeBatch(results: BatchResult[]): BatchSummary {
  return {
    total: results.length,
    success: results.filter((r) => r.success && !r.skipped).length,
    failed: results.filter((r) => !r.success && !r.skipped).length,
    skipped: results.filter((r) => r.skipped).length,
    totalDuration: results.reduce((sum, r) => sum + (r.duration || 0), 0),
    results,
  };
}
