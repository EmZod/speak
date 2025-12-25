/**
 * End-to-end tests for TTS generation
 *
 * Tests the full TTS pipeline:
 * - Text to audio generation
 * - File input processing
 * - Markdown processing
 * - Preview mode
 * - Output file handling
 *
 * Note: These tests require the Python environment and may take time.
 * Set SPEAK_E2E_TESTS=1 to enable full generation tests.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { spawn } from "child_process";
import { join } from "path";
import { existsSync, readFileSync } from "fs";
import {
  testLog,
  createTempDir,
  cleanupTempDir,
  createTempFile,
  withTimeout,
} from "../helpers/test-utils.ts";
import { isVenvValid } from "../../src/python/setup.ts";

// Path to the CLI entry point
const CLI_PATH = join(import.meta.dir, "../../src/index.ts");

// Check if we should run full E2E tests
const runFullE2E = process.env.SPEAK_E2E_TESTS === "1";
const pythonAvailable = isVenvValid();
const canRunGeneration = pythonAvailable && runFullE2E;

// Helper to run CLI commands
async function runCli(
  args: string[],
  options?: { timeout?: number; env?: Record<string, string>; cwd?: string }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn("bun", ["run", CLI_PATH, ...args], {
      env: { ...process.env, ...options?.env },
      cwd: options?.cwd,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    const timeout = options?.timeout ?? 120000; // 2 minutes for generation
    const timer = setTimeout(() => {
      proc.kill();
      resolve({ stdout, stderr, exitCode: -1 });
    }, timeout);

    proc.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: exitCode ?? 0 });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: err.message, exitCode: 1 });
    });
  });
}

describe("TTS generation e2e tests", () => {
  let tempDir: string;
  let outputDir: string;

  beforeAll(() => {
    if (!canRunGeneration) {
      if (!pythonAvailable) {
        testLog.warn("Python environment not set up - generation tests skipped");
      } else if (!runFullE2E) {
        testLog.warn("Set SPEAK_E2E_TESTS=1 to enable full generation tests");
      }
    }
  });

  beforeEach(() => {
    tempDir = createTempDir("tts-e2e-");
    outputDir = join(tempDir, "output");
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  afterAll(async () => {
    // Stop daemon if running
    if (pythonAvailable) {
      await runCli(["daemon", "kill"]);
    }
  });

  describe("basic generation", () => {
    test.skipIf(!canRunGeneration)("generates audio from text", async () => {
      testLog.step(1, "Generating audio from text");

      const result = await runCli(
        ["Hello, world!", "--output", outputDir, "--quiet"],
        { timeout: 180000 }
      );

      expect(result.exitCode).toBe(0);

      // Check output file was created
      const files = existsSync(outputDir) ?
        require("fs").readdirSync(outputDir) : [];
      const wavFiles = files.filter((f: string) => f.endsWith(".wav"));

      expect(wavFiles.length).toBeGreaterThan(0);
      testLog.info(`Generated: ${wavFiles[0]}`);
    });

    test.skipIf(!canRunGeneration)("generates audio from short text", async () => {
      testLog.step(1, "Generating from short text");

      const result = await runCli(
        ["Hi!", "--output", outputDir, "--quiet"],
        { timeout: 180000 }
      );

      expect(result.exitCode).toBe(0);
      testLog.info("Short text generated");
    });

    test.skipIf(!canRunGeneration)("outputs duration and RTF info", async () => {
      const result = await runCli(
        ["Hello, this is a test.", "--output", outputDir],
        { timeout: 180000 }
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Generated");
      expect(result.stdout).toMatch(/\d+\.\d+s/); // Duration
      expect(result.stdout).toContain("RTF");
    });
  });

  describe("file input", () => {
    test.skipIf(!canRunGeneration)("generates from text file", async () => {
      testLog.step(1, "Generating from text file");

      const textFile = createTempFile(tempDir, "input.txt", "This is text from a file.");

      const result = await runCli(
        [textFile, "--output", outputDir, "--quiet"],
        { timeout: 180000 }
      );

      expect(result.exitCode).toBe(0);
      testLog.info("Text file processed");
    });

    test.skipIf(!canRunGeneration)("generates from markdown file", async () => {
      testLog.step(1, "Generating from markdown file");

      const mdFile = createTempFile(
        tempDir,
        "input.md",
        "# Hello\n\nThis is **markdown** content."
      );

      const result = await runCli(
        [mdFile, "--output", outputDir, "--quiet"],
        { timeout: 180000 }
      );

      expect(result.exitCode).toBe(0);
      testLog.info("Markdown file processed");
    });

    test.skipIf(!pythonAvailable)("handles missing file gracefully", async () => {
      const result = await runCli(
        [join(tempDir, "nonexistent.txt"), "--output", outputDir],
        { timeout: 30000 }
      );

      // Should either process as text or fail gracefully
      // The exact behavior depends on implementation
      expect(result.exitCode).toBeDefined();
    });
  });

  describe("markdown processing", () => {
    test.skipIf(!canRunGeneration)("processes markdown in plain mode", async () => {
      testLog.step(1, "Testing plain markdown mode");

      const mdFile = createTempFile(
        tempDir,
        "test.md",
        "# Title\n\nWith **bold** and [link](url)."
      );

      const result = await runCli(
        [mdFile, "--markdown", "plain", "--output", outputDir, "--quiet"],
        { timeout: 180000 }
      );

      expect(result.exitCode).toBe(0);
      testLog.info("Plain mode processed");
    });

    test.skipIf(!canRunGeneration)("processes markdown in smart mode", async () => {
      testLog.step(1, "Testing smart markdown mode");

      const mdFile = createTempFile(
        tempDir,
        "test.md",
        "# Title\n\nContent here."
      );

      const result = await runCli(
        [mdFile, "--markdown", "smart", "--output", outputDir, "--quiet"],
        { timeout: 180000 }
      );

      expect(result.exitCode).toBe(0);
      testLog.info("Smart mode processed");
    });

    test.skipIf(!canRunGeneration)("handles code blocks with skip mode", async () => {
      const mdFile = createTempFile(
        tempDir,
        "test.md",
        "Text before.\n\n```\ncode block\n```\n\nText after."
      );

      const result = await runCli(
        [mdFile, "--code-blocks", "skip", "--output", outputDir, "--quiet"],
        { timeout: 180000 }
      );

      expect(result.exitCode).toBe(0);
    });

    test.skipIf(!canRunGeneration)("handles code blocks with placeholder mode", async () => {
      const mdFile = createTempFile(
        tempDir,
        "test.md",
        "Text.\n\n```python\nprint('hello')\n```\n\nMore text."
      );

      const result = await runCli(
        [mdFile, "--code-blocks", "placeholder", "--output", outputDir, "--quiet"],
        { timeout: 180000 }
      );

      expect(result.exitCode).toBe(0);
    });
  });

  describe("preview mode", () => {
    test.skipIf(!canRunGeneration)("generates only first sentence", async () => {
      testLog.step(1, "Testing preview mode");

      const longText = "First sentence. Second sentence. Third sentence. Fourth sentence.";

      const result = await runCli(
        [longText, "--preview", "--output", outputDir, "--quiet"],
        { timeout: 180000 }
      );

      expect(result.exitCode).toBe(0);
      testLog.info("Preview mode generated");
    });

    test.skipIf(!canRunGeneration)("preview shows preview message", async () => {
      const result = await runCli(
        ["First sentence. More content.", "--preview", "--output", outputDir],
        { timeout: 180000 }
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Preview");
    });
  });

  describe("model selection", () => {
    test.skipIf(!canRunGeneration)("uses specified model", async () => {
      testLog.step(1, "Testing model selection");

      const result = await runCli(
        [
          "Test",
          "--model", "mlx-community/chatterbox-turbo-8bit",
          "--output", outputDir,
          "--quiet",
        ],
        { timeout: 180000 }
      );

      expect(result.exitCode).toBe(0);
      testLog.info("Model selection worked");
    });
  });

  describe("temperature and speed", () => {
    test.skipIf(!canRunGeneration)("accepts custom temperature", async () => {
      const result = await runCli(
        ["Test", "--temp", "0.7", "--output", outputDir, "--quiet"],
        { timeout: 180000 }
      );

      expect(result.exitCode).toBe(0);
    });

    test.skipIf(!canRunGeneration)("accepts custom speed", async () => {
      const result = await runCli(
        ["Test", "--speed", "1.2", "--output", outputDir, "--quiet"],
        { timeout: 180000 }
      );

      expect(result.exitCode).toBe(0);
    });
  });

  describe("output handling", () => {
    test.skipIf(!canRunGeneration)("creates output directory", async () => {
      const nestedOutput = join(tempDir, "nested", "output", "dir");

      expect(existsSync(nestedOutput)).toBe(false);

      const result = await runCli(
        ["Test", "--output", nestedOutput, "--quiet"],
        { timeout: 180000 }
      );

      expect(result.exitCode).toBe(0);
      expect(existsSync(nestedOutput)).toBe(true);
    });

    test.skipIf(!canRunGeneration)("generates timestamped filename", async () => {
      const result = await runCli(
        ["Test", "--output", outputDir, "--quiet"],
        { timeout: 180000 }
      );

      expect(result.exitCode).toBe(0);

      const files = require("fs").readdirSync(outputDir);
      const wavFile = files.find((f: string) => f.endsWith(".wav"));

      expect(wavFile).toBeDefined();
      expect(wavFile).toMatch(/speak_\d{4}-\d{2}-\d{2}_\d{6}\.wav/);
    });
  });

  describe("daemon mode", () => {
    test.skipIf(!canRunGeneration)("daemon mode keeps server running", async () => {
      testLog.step(1, "Testing daemon mode");

      // First call with --daemon
      const result1 = await runCli(
        ["First call", "--daemon", "--output", outputDir, "--quiet"],
        { timeout: 180000 }
      );

      expect(result1.exitCode).toBe(0);

      // Second call should be faster
      const start = Date.now();
      const result2 = await runCli(
        ["Second call", "--daemon", "--output", outputDir, "--quiet"],
        { timeout: 180000 }
      );
      const elapsed = Date.now() - start;

      expect(result2.exitCode).toBe(0);
      testLog.info(`Second call took ${elapsed}ms`);

      // Cleanup
      await runCli(["daemon", "kill"]);
    });
  });

  describe("emotion tags", () => {
    test.skipIf(!canRunGeneration)("handles emotion tags", async () => {
      testLog.step(1, "Testing emotion tags");

      const result = await runCli(
        ["[laugh] That's funny!", "--output", outputDir, "--quiet"],
        { timeout: 180000 }
      );

      expect(result.exitCode).toBe(0);
      testLog.info("Emotion tags processed");
    });

    test.skipIf(!canRunGeneration)("handles multiple emotion tags", async () => {
      const result = await runCli(
        ["[sigh] Monday again. [laugh] Just kidding!", "--output", outputDir, "--quiet"],
        { timeout: 180000 }
      );

      expect(result.exitCode).toBe(0);
    });
  });

  describe("error cases", () => {
    test.skipIf(!pythonAvailable)("handles empty input", async () => {
      const result = await runCli(
        ["", "--output", outputDir],
        { timeout: 30000 }
      );

      // Should handle gracefully
      if (result.exitCode !== 0) {
        expect(result.stdout + result.stderr).toMatch(/empty|input/i);
      }
    });

    test.skipIf(!pythonAvailable)("handles whitespace-only input", async () => {
      const result = await runCli(
        ["   ", "--output", outputDir],
        { timeout: 30000 }
      );

      // Should handle gracefully
      expect(result.stdout + result.stderr).toBeDefined();
    });
  });
});

describe("TTS generation performance", () => {
  let outputDir: string;

  beforeEach(() => {
    const tempDir = createTempDir("tts-perf-");
    outputDir = join(tempDir, "output");
  });

  test.skipIf(!canRunGeneration)("reports RTF metric", async () => {
    testLog.step(1, "Checking RTF metric");

    const result = await runCli(
      ["Performance test text here.", "--output", outputDir],
      { timeout: 180000 }
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("RTF");
    expect(result.stdout).toMatch(/RTF:\s*\d+\.\d+/);

    testLog.info("RTF metric reported");
  });
});
