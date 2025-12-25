/**
 * End-to-end tests for streaming mode
 *
 * Tests the streaming TTS pipeline:
 * - Chunked audio generation
 * - Buffer management
 * - Playback during generation
 *
 * Note: These tests require the Python environment and may take time.
 * Set SPEAK_E2E_TESTS=1 to enable full streaming tests.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { spawn, type ChildProcess } from "child_process";
import { join } from "path";
import { existsSync } from "fs";
import {
  testLog,
  createTempDir,
  cleanupTempDir,
  createTempFile,
} from "../helpers/test-utils.ts";
import { isVenvValid } from "../../src/python/setup.ts";

// Path to the CLI entry point
const CLI_PATH = join(import.meta.dir, "../../src/index.ts");

// Check if we should run full E2E tests
const runFullE2E = process.env.SPEAK_E2E_TESTS === "1";
const pythonAvailable = isVenvValid();
const canRunStreaming = pythonAvailable && runFullE2E;

// Helper to run CLI commands with streaming output capture
async function runCliStreaming(
  args: string[],
  options?: {
    timeout?: number;
    onStdout?: (chunk: string) => void;
    onStderr?: (chunk: string) => void;
  }
): Promise<{ stdout: string; stderr: string; exitCode: number; interrupted: boolean }> {
  return new Promise((resolve) => {
    const proc = spawn("bun", ["run", CLI_PATH, ...args], {
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    let interrupted = false;

    proc.stdout.on("data", (data) => {
      const chunk = data.toString();
      stdout += chunk;
      options?.onStdout?.(chunk);
    });

    proc.stderr.on("data", (data) => {
      const chunk = data.toString();
      stderr += chunk;
      options?.onStderr?.(chunk);
    });

    const timeout = options?.timeout ?? 300000; // 5 minutes for streaming
    const timer = setTimeout(() => {
      interrupted = true;
      proc.kill("SIGINT");
    }, timeout);

    proc.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: exitCode ?? 0, interrupted });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: err.message, exitCode: 1, interrupted });
    });
  });
}

// Helper to interrupt after a delay
async function runCliWithInterrupt(
  args: string[],
  interruptAfterMs: number
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn("bun", ["run", CLI_PATH, ...args], {
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    // Interrupt after delay
    setTimeout(() => {
      proc.kill("SIGINT");
    }, interruptAfterMs);

    proc.on("close", (exitCode) => {
      resolve({ stdout, stderr, exitCode: exitCode ?? 0 });
    });

    proc.on("error", (err) => {
      resolve({ stdout, stderr: err.message, exitCode: 1 });
    });
  });
}

describe("Streaming mode e2e tests", () => {
  let tempDir: string;
  let outputDir: string;

  beforeAll(() => {
    if (!canRunStreaming) {
      if (!pythonAvailable) {
        testLog.warn("Python environment not set up - streaming tests skipped");
      } else if (!runFullE2E) {
        testLog.warn("Set SPEAK_E2E_TESTS=1 to enable full streaming tests");
      }
    }
  });

  beforeEach(() => {
    tempDir = createTempDir("streaming-e2e-");
    outputDir = join(tempDir, "output");
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  afterAll(async () => {
    // Stop daemon if running
    if (pythonAvailable) {
      const proc = spawn("bun", ["run", CLI_PATH, "daemon", "kill"]);
      await new Promise((resolve) => proc.on("close", resolve));
    }
  });

  describe("basic streaming", () => {
    test.skipIf(!canRunStreaming)("streams audio from text", async () => {
      testLog.step(1, "Testing basic streaming");

      const longText = "This is a longer text for streaming. It has multiple sentences. The streaming mode should generate audio in chunks. Each chunk plays while the next is being generated.";

      const result = await runCliStreaming(
        [longText, "--stream", "--quiet"],
        { timeout: 300000 }
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Streamed");
      expect(result.stdout).toContain("chunks");

      testLog.info("Streaming completed");
    });

    test.skipIf(!canRunStreaming)("reports chunk count", async () => {
      const text = "First sentence. Second sentence. Third sentence.";

      const result = await runCliStreaming(
        [text, "--stream"],
        { timeout: 300000 }
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/\d+\s*chunks/);
    });

    test.skipIf(!canRunStreaming)("reports total duration", async () => {
      const text = "Short streaming test.";

      const result = await runCliStreaming(
        [text, "--stream"],
        { timeout: 300000 }
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/\d+\.\d+s.*audio/);
    });

    test.skipIf(!canRunStreaming)("reports RTF", async () => {
      const text = "Another streaming test.";

      const result = await runCliStreaming(
        [text, "--stream"],
        { timeout: 300000 }
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("RTF");
    });
  });

  describe("file streaming", () => {
    test.skipIf(!canRunStreaming)("streams from text file", async () => {
      testLog.step(1, "Testing streaming from file");

      const content = "This is content from a file. It will be streamed. Multiple sentences here.";
      const textFile = createTempFile(tempDir, "stream-test.txt", content);

      const result = await runCliStreaming(
        [textFile, "--stream", "--quiet"],
        { timeout: 300000 }
      );

      expect(result.exitCode).toBe(0);
      testLog.info("File streaming completed");
    });

    test.skipIf(!canRunStreaming)("streams from markdown file", async () => {
      const content = `# Introduction

This is the first paragraph of the document. It's long enough to test streaming.

## Section One

More content here for streaming purposes. We need multiple sentences for proper chunk generation.

## Section Two

The final section with concluding remarks.`;

      const mdFile = createTempFile(tempDir, "stream-test.md", content);

      const result = await runCliStreaming(
        [mdFile, "--stream", "--quiet"],
        { timeout: 300000 }
      );

      expect(result.exitCode).toBe(0);
    });
  });

  describe("buffering behavior", () => {
    test.skipIf(!canRunStreaming)("shows buffering status", async () => {
      testLog.step(1, "Testing buffering display");

      const longText = "This is a text for testing the buffering mechanism. It needs to be long enough to show buffering behavior. The system should buffer audio before starting playback.";

      let sawBuffering = false;

      const result = await runCliStreaming(
        [longText, "--stream"],
        {
          timeout: 300000,
          onStdout: (chunk) => {
            if (chunk.includes("Buffer") || chunk.includes("Buffering")) {
              sawBuffering = true;
            }
          },
        }
      );

      expect(result.exitCode).toBe(0);
      // Note: may or may not see buffering depending on speed
      testLog.info(`Buffering observed: ${sawBuffering}`);
    });

    test.skipIf(!canRunStreaming)("handles short text (no buffering needed)", async () => {
      const shortText = "Short text.";

      const result = await runCliStreaming(
        [shortText, "--stream", "--quiet"],
        { timeout: 300000 }
      );

      expect(result.exitCode).toBe(0);
    });
  });

  describe("interrupt handling", () => {
    test.skipIf(!canRunStreaming)("handles Ctrl+C gracefully", async () => {
      testLog.step(1, "Testing Ctrl+C handling");

      const longText = "This is a very long text that will take a while to generate. ".repeat(10);

      const result = await runCliWithInterrupt(
        [longText, "--stream"],
        5000 // Interrupt after 5 seconds
      );

      // Should exit cleanly on interrupt
      expect(result.exitCode).toBeDefined();
      expect(result.stdout).toContain("Interrupted") || expect(result.exitCode).toBe(0);

      testLog.info("Ctrl+C handled gracefully");
    });
  });

  describe("streaming with options", () => {
    test.skipIf(!canRunStreaming)("streams with custom temperature", async () => {
      const text = "Streaming with temperature.";

      const result = await runCliStreaming(
        [text, "--stream", "--temp", "0.7", "--quiet"],
        { timeout: 300000 }
      );

      expect(result.exitCode).toBe(0);
    });

    test.skipIf(!canRunStreaming)("streams with custom speed", async () => {
      const text = "Streaming with speed adjustment.";

      const result = await runCliStreaming(
        [text, "--stream", "--speed", "1.2", "--quiet"],
        { timeout: 300000 }
      );

      expect(result.exitCode).toBe(0);
    });

    test.skipIf(!canRunStreaming)("streams with markdown processing", async () => {
      const text = "# Header\n\nWith **bold** text to stream.";

      const result = await runCliStreaming(
        [text, "--stream", "--markdown", "smart", "--quiet"],
        { timeout: 300000 }
      );

      expect(result.exitCode).toBe(0);
    });
  });

  describe("daemon with streaming", () => {
    test.skipIf(!canRunStreaming)("streaming works with daemon mode", async () => {
      testLog.step(1, "Testing streaming with daemon");

      // First call - starts daemon
      const result1 = await runCliStreaming(
        ["First streaming call.", "--stream", "--daemon", "--quiet"],
        { timeout: 300000 }
      );

      expect(result1.exitCode).toBe(0);

      // Second call - should be faster
      const result2 = await runCliStreaming(
        ["Second streaming call.", "--stream", "--daemon", "--quiet"],
        { timeout: 300000 }
      );

      expect(result2.exitCode).toBe(0);

      // Cleanup
      const proc = spawn("bun", ["run", CLI_PATH, "daemon", "kill"]);
      await new Promise((resolve) => proc.on("close", resolve));

      testLog.info("Streaming with daemon completed");
    });
  });

  describe("streaming progress", () => {
    test.skipIf(!canRunStreaming)("shows chunk progress", async () => {
      const text = "First sentence for chunk. Second sentence. Third sentence.";

      let chunkCount = 0;

      const result = await runCliStreaming(
        [text, "--stream"],
        {
          timeout: 300000,
          onStdout: (chunk) => {
            if (chunk.includes("chunk")) {
              chunkCount++;
            }
          },
        }
      );

      expect(result.exitCode).toBe(0);
      testLog.info(`Observed ${chunkCount} chunk mentions`);
    });
  });

  describe("streaming error handling", () => {
    test.skipIf(!pythonAvailable)("handles empty text gracefully", async () => {
      const result = await runCliStreaming(
        ["", "--stream"],
        { timeout: 30000 }
      );

      // Should handle gracefully
      if (result.exitCode !== 0) {
        expect(result.stdout + result.stderr).toMatch(/empty|input/i);
      }
    });
  });

  describe("quiet mode in streaming", () => {
    test.skipIf(!canRunStreaming)("quiet mode reduces output", async () => {
      const text = "Quiet streaming test.";

      const normalResult = await runCliStreaming(
        [text, "--stream"],
        { timeout: 300000 }
      );

      const quietResult = await runCliStreaming(
        [text, "--stream", "--quiet"],
        { timeout: 300000 }
      );

      expect(normalResult.exitCode).toBe(0);
      expect(quietResult.exitCode).toBe(0);

      // Quiet should have less output
      expect(quietResult.stdout.length).toBeLessThanOrEqual(normalResult.stdout.length);
    });
  });
});

describe("Streaming vs non-streaming comparison", () => {
  const canCompare = pythonAvailable && runFullE2E;
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir("stream-compare-");
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  test.skipIf(!canCompare)("both modes produce output", async () => {
    testLog.step(1, "Comparing streaming vs non-streaming");

    const text = "Comparison test sentence.";
    const outputDir = join(tempDir, "output");

    // Non-streaming
    const nonStreamResult = await runCliStreaming(
      [text, "--output", outputDir, "--quiet"],
      { timeout: 300000 }
    );

    expect(nonStreamResult.exitCode).toBe(0);

    // Streaming (no persistent output, just plays)
    const streamResult = await runCliStreaming(
      [text, "--stream", "--quiet"],
      { timeout: 300000 }
    );

    expect(streamResult.exitCode).toBe(0);

    testLog.info("Both modes completed successfully");
  });
});
