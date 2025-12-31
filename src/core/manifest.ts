/**
 * Generation manifest for resumable chunked generation.
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { createHash } from "crypto";
import { join } from "path";
import { chunkText } from "./chunker.ts";
import type { ChunkOptions } from "./chunker.ts";

export interface ChunkInfo {
  index: number;
  start: number;
  end: number;
  text: string;
  status: "pending" | "complete" | "failed";
  output: string;
  duration?: number;
}

export interface GenerationManifest {
  version: number;
  created_at: string;
  updated_at: string;
  source_hash: string;
  source_length: number;
  params: {
    model?: string;
    temperature?: number;
    speed?: number;
    voice?: string;
  };
  chunks: ChunkInfo[];
  output_file?: string;
}

const MANIFEST_VERSION = 1;

/**
 * Hash text for change detection.
 */
function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/**
 * Create a new manifest for text.
 */
export function createManifest(
  text: string,
  outputDir: string,
  params: GenerationManifest["params"],
  chunkOptions: ChunkOptions
): GenerationManifest {
  const chunks = chunkText(text, chunkOptions);

  let charIndex = 0;
  const chunkInfos: ChunkInfo[] = chunks.map((chunkText, i) => {
    const start = charIndex;
    const end = charIndex + chunkText.length;
    charIndex = end;

    return {
      index: i,
      start,
      end,
      text: chunkText,
      status: "pending",
      output: join(outputDir, `chunk_${String(i).padStart(4, "0")}.wav`),
    };
  });

  return {
    version: MANIFEST_VERSION,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    source_hash: hashText(text),
    source_length: text.length,
    params,
    chunks: chunkInfos,
  };
}

/**
 * Load existing manifest.
 */
export function loadManifest(path: string): GenerationManifest | null {
  if (!existsSync(path)) {
    return null;
  }

  try {
    const content = readFileSync(path, "utf-8");
    const manifest = JSON.parse(content) as GenerationManifest;

    if (manifest.version !== MANIFEST_VERSION) {
      throw new Error(`Unsupported manifest version: ${manifest.version}`);
    }

    return manifest;
  } catch {
    return null;
  }
}

/**
 * Save manifest to disk.
 */
export function saveManifest(manifest: GenerationManifest, path: string): void {
  manifest.updated_at = new Date().toISOString();
  writeFileSync(path, JSON.stringify(manifest, null, 2));
}

/**
 * Update chunk status in manifest.
 */
export function updateChunkStatus(
  manifest: GenerationManifest,
  chunkIndex: number,
  status: ChunkInfo["status"],
  duration?: number
): void {
  const chunk = manifest.chunks[chunkIndex];
  if (chunk) {
    chunk.status = status;
    if (duration !== undefined) {
      chunk.duration = duration;
    }
  }
}

/**
 * Check manifest validity against source text.
 */
export function validateManifest(
  manifest: GenerationManifest,
  text: string
): {
  valid: boolean;
  reason?: string;
} {
  const currentHash = hashText(text);

  if (manifest.source_hash !== currentHash) {
    return {
      valid: false,
      reason: "Source text has changed since manifest was created",
    };
  }

  if (manifest.source_length !== text.length) {
    return { valid: false, reason: "Source text length has changed" };
  }

  return { valid: true };
}

/**
 * Get chunks that need to be generated.
 */
export function getPendingChunks(manifest: GenerationManifest): ChunkInfo[] {
  return manifest.chunks.filter((c) => {
    // Pending status OR complete status but file missing
    if (c.status === "pending" || c.status === "failed") {
      return true;
    }
    if (c.status === "complete" && !existsSync(c.output)) {
      return true;
    }
    return false;
  });
}

/**
 * Check if all chunks are complete.
 */
export function isComplete(manifest: GenerationManifest): boolean {
  return manifest.chunks.every(
    (c) => c.status === "complete" && existsSync(c.output)
  );
}
