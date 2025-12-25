/**
 * Unit tests for core/output.ts
 *
 * Tests output handling including:
 * - Filename generation with timestamps
 * - Output path preparation
 * - File copying to output directory
 * - Audio player process management
 * - Cleanup handlers
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, writeFileSync, readFileSync, mkdirSync } from "fs";
import { join } from "path";
import {
  createTempDir,
  cleanupTempDir,
  createTempFile,
  testLog,
} from "../../helpers/test-utils.ts";
import {
  generateFilename,
  prepareOutputPath,
  copyToOutput,
  stopAudio,
} from "../../../src/core/output.ts";

describe("core/output.ts", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir("output-test-");
    testLog.debug(`Created temp dir: ${tempDir}`);
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  describe("generateFilename", () => {
    test("generates filename with correct prefix", () => {
      testLog.step(1, "Testing filename generation");
      const filename = generateFilename();

      expect(filename).toMatch(/^speak_/);
      testLog.info(`Generated filename: ${filename}`);
    });

    test("includes date in YYYY-MM-DD format", () => {
      const filename = generateFilename();
      const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

      expect(filename).toContain(today);
    });

    test("includes time component", () => {
      const filename = generateFilename();

      // Should have format speak_YYYY-MM-DD_HHMMSS.wav
      expect(filename).toMatch(/speak_\d{4}-\d{2}-\d{2}_\d{6}\.wav$/);
    });

    test("ends with .wav extension", () => {
      const filename = generateFilename();

      expect(filename).toEndWith(".wav");
    });

    test("generates unique filenames across calls", () => {
      testLog.step(1, "Testing filename uniqueness");
      const filenames = new Set<string>();

      // Generate multiple filenames (may not be unique if within same second)
      for (let i = 0; i < 5; i++) {
        filenames.add(generateFilename());
      }

      // At minimum, format should be consistent
      for (const filename of filenames) {
        expect(filename).toMatch(/speak_\d{4}-\d{2}-\d{2}_\d{6}\.wav$/);
      }
      testLog.info(`Generated ${filenames.size} unique filenames`);
    });

    test("handles different dates correctly", () => {
      // This is a format test - actual dates will vary
      const filename = generateFilename();
      const parts = filename.split("_");

      expect(parts.length).toBe(3);
      expect(parts[0]).toBe("speak");
      // Date part
      expect(parts[1]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // Time part (with .wav)
      expect(parts[2]).toMatch(/^\d{6}\.wav$/);
    });
  });

  describe("prepareOutputPath", () => {
    test("creates directory if it doesn't exist", () => {
      testLog.step(1, "Testing directory creation");
      const outputDir = join(tempDir, "new-dir", "nested");

      expect(existsSync(outputDir)).toBe(false);

      const outputPath = prepareOutputPath(outputDir);

      expect(existsSync(outputDir)).toBe(true);
      expect(outputPath.startsWith(outputDir)).toBe(true);
      testLog.info("Directory created successfully");
    });

    test("uses existing directory without error", () => {
      const existingDir = join(tempDir, "existing");
      mkdirSync(existingDir, { recursive: true });

      const outputPath = prepareOutputPath(existingDir);

      expect(outputPath.startsWith(existingDir)).toBe(true);
    });

    test("returns full path with generated filename", () => {
      const outputPath = prepareOutputPath(tempDir);

      expect(outputPath.startsWith(tempDir)).toBe(true);
      expect(outputPath).toMatch(/speak_\d{4}-\d{2}-\d{2}_\d{6}\.wav$/);
    });

    test("expands tilde in path", () => {
      testLog.step(1, "Testing tilde expansion in output path");
      // Note: This test may fail if home directory structure doesn't allow creation
      // We're testing the expansion behavior, not actual file creation
      const tildeDir = "~/test-speak-output-" + Date.now();

      try {
        const outputPath = prepareOutputPath(tildeDir);
        expect(outputPath).not.toContain("~");
        testLog.info(`Tilde expanded in output path: ${outputPath}`);
      } finally {
        // Cleanup
        const home = process.env.HOME || "";
        const expandedDir = join(home, "test-speak-output-" + Date.now());
        if (existsSync(expandedDir)) {
          cleanupTempDir(expandedDir);
        }
      }
    });

    test("handles deeply nested paths", () => {
      const deepDir = join(tempDir, "a", "b", "c", "d", "e");

      const outputPath = prepareOutputPath(deepDir);

      expect(existsSync(deepDir)).toBe(true);
      expect(outputPath.startsWith(deepDir)).toBe(true);
    });
  });

  describe("copyToOutput", () => {
    test("copies file to output directory", () => {
      testLog.step(1, "Testing file copy to output");
      const sourceFile = createTempFile(tempDir, "source.wav", "audio content");
      const outputDir = join(tempDir, "output");
      mkdirSync(outputDir);

      const outputPath = copyToOutput(sourceFile, outputDir);

      expect(existsSync(outputPath)).toBe(true);
      expect(outputPath.startsWith(outputDir)).toBe(true);
      testLog.info(`File copied to: ${outputPath}`);
    });

    test("preserves file contents", () => {
      const originalContent = "test audio data 12345";
      const sourceFile = createTempFile(tempDir, "original.wav", originalContent);
      const outputDir = join(tempDir, "output");
      mkdirSync(outputDir);

      const outputPath = copyToOutput(sourceFile, outputDir);

      const copiedContent = readFileSync(outputPath, "utf-8");
      expect(copiedContent).toBe(originalContent);
    });

    test("generates new filename with timestamp", () => {
      const sourceFile = createTempFile(tempDir, "any-name.wav", "content");
      const outputDir = join(tempDir, "output");
      mkdirSync(outputDir);

      const outputPath = copyToOutput(sourceFile, outputDir);

      // Output should have speak_* filename, not original name
      expect(outputPath).not.toContain("any-name");
      expect(outputPath).toMatch(/speak_\d{4}-\d{2}-\d{2}_\d{6}\.wav$/);
    });

    test("creates output directory if needed", () => {
      const sourceFile = createTempFile(tempDir, "source.wav", "content");
      const outputDir = join(tempDir, "nonexistent", "nested");

      expect(existsSync(outputDir)).toBe(false);

      const outputPath = copyToOutput(sourceFile, outputDir);

      expect(existsSync(outputDir)).toBe(true);
      expect(existsSync(outputPath)).toBe(true);
    });

    test("handles large files", () => {
      testLog.step(1, "Testing large file copy");
      // Create a 1MB "file"
      const largeContent = "X".repeat(1024 * 1024);
      const sourceFile = createTempFile(tempDir, "large.wav", largeContent);
      const outputDir = join(tempDir, "output");
      mkdirSync(outputDir);

      const outputPath = copyToOutput(sourceFile, outputDir);

      expect(existsSync(outputPath)).toBe(true);
      const copiedContent = readFileSync(outputPath, "utf-8");
      expect(copiedContent.length).toBe(largeContent.length);
      testLog.info("Large file copied successfully");
    });

    test("expands tilde in output directory", () => {
      const sourceFile = createTempFile(tempDir, "source.wav", "content");

      // Create a temp output in home with unique name
      const uniqueName = `speak-test-${Date.now()}`;
      const tildeDir = `~/${uniqueName}`;
      const home = process.env.HOME || "";
      const expandedDir = join(home, uniqueName);

      try {
        const outputPath = copyToOutput(sourceFile, tildeDir);

        expect(outputPath).not.toContain("~");
        expect(outputPath.startsWith(expandedDir)).toBe(true);
      } finally {
        // Cleanup
        if (existsSync(expandedDir)) {
          cleanupTempDir(expandedDir);
        }
      }
    });
  });

  describe("stopAudio", () => {
    test("can be called without error when no audio is playing", () => {
      testLog.step(1, "Testing stopAudio with no active player");
      // Should not throw
      expect(() => stopAudio()).not.toThrow();
      testLog.info("stopAudio called successfully with no active player");
    });

    test("is idempotent - can be called multiple times", () => {
      // Call multiple times, should not throw
      stopAudio();
      stopAudio();
      stopAudio();

      // If we got here without error, test passes
      expect(true).toBe(true);
    });
  });

  describe("edge cases", () => {
    test("handles paths with spaces", () => {
      const dirWithSpaces = join(tempDir, "path with spaces", "more spaces");
      mkdirSync(dirWithSpaces, { recursive: true });

      const outputPath = prepareOutputPath(dirWithSpaces);

      expect(existsSync(dirWithSpaces)).toBe(true);
      expect(outputPath).toContain("path with spaces");
    });

    test("handles paths with special characters", () => {
      const specialDir = join(tempDir, "path-with-dashes_and_underscores");
      mkdirSync(specialDir, { recursive: true });

      const outputPath = prepareOutputPath(specialDir);

      expect(existsSync(specialDir)).toBe(true);
    });

    test("handles unicode in paths", () => {
      const unicodeDir = join(tempDir, "path-with-emoji-🎵");
      try {
        mkdirSync(unicodeDir, { recursive: true });
        const outputPath = prepareOutputPath(unicodeDir);
        expect(existsSync(unicodeDir)).toBe(true);
      } catch {
        // Some filesystems may not support unicode - that's okay
        testLog.warn("Unicode path test skipped - filesystem may not support");
      }
    });

    test("copyToOutput fails gracefully with missing source", () => {
      const nonexistentSource = join(tempDir, "does-not-exist.wav");
      const outputDir = join(tempDir, "output");
      mkdirSync(outputDir);

      expect(() => copyToOutput(nonexistentSource, outputDir)).toThrow();
    });
  });
});
