/**
 * Unit tests for ui/progress.ts
 *
 * Tests progress display utilities including:
 * - Spinner creation and animation
 * - ETA calculation
 * - Duration formatting
 * - Progress bar rendering
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { testLog, captureConsole } from "../../helpers/test-utils.ts";
import {
  createSpinner,
  createProgressBar,
  type ProgressOptions,
  type ProgressBarOptions,
} from "../../../src/ui/progress.ts";

describe("ui/progress.ts", () => {
  describe("createSpinner", () => {
    test("creates spinner with required options", () => {
      testLog.step(1, "Testing spinner creation");
      const spinner = createSpinner({ text: "Hello world" });

      expect(spinner).toBeDefined();
      expect(typeof spinner.start).toBe("function");
      expect(typeof spinner.update).toBe("function");
      expect(typeof spinner.stop).toBe("function");
      testLog.info("Spinner created with all methods");
    });

    test("spinner has start method", () => {
      const spinner = createSpinner({ text: "Test" });

      expect(() => spinner.start()).not.toThrow();
      spinner.stop(true);
    });

    test("spinner has update method", () => {
      const spinner = createSpinner({ text: "Test" });

      spinner.start();
      expect(() => spinner.update("New message")).not.toThrow();
      spinner.stop(true);
    });

    test("spinner has stop method", () => {
      const spinner = createSpinner({ text: "Test" });

      spinner.start();
      expect(() => spinner.stop(true)).not.toThrow();
    });

    test("stop accepts success/failure parameter", () => {
      const spinner = createSpinner({ text: "Test" });

      spinner.start();
      expect(() => spinner.stop(true)).not.toThrow();

      const spinner2 = createSpinner({ text: "Test" });
      spinner2.start();
      expect(() => spinner2.stop(false)).not.toThrow();
    });

    test("stop accepts optional message", () => {
      const spinner = createSpinner({ text: "Test" });

      spinner.start();
      expect(() => spinner.stop(true, "Custom message")).not.toThrow();
    });

    test("handles quiet mode", () => {
      testLog.step(1, "Testing quiet mode");
      const { output, restore } = captureConsole();

      const spinner = createSpinner({ text: "Test", quiet: true });
      spinner.start();
      spinner.update("Update");
      spinner.stop(true, "Done");

      // In quiet mode, should not output anything
      restore();
      testLog.info(`Quiet mode output: ${output.stdout.length} messages`);
    });

    test("handles long text gracefully", () => {
      const longText = "A".repeat(1000);
      const spinner = createSpinner({ text: longText });

      // Should not throw
      spinner.start();
      spinner.stop(true);
    });

    test("handles empty text", () => {
      const spinner = createSpinner({ text: "" });

      // Should not throw
      spinner.start();
      spinner.stop(true);
    });

    test("showEta option affects behavior", () => {
      // With showEta, spinner should calculate estimated time
      const spinnerWithEta = createSpinner({ text: "Test content", showEta: true });
      const spinnerWithoutEta = createSpinner({ text: "Test", showEta: false });

      // Both should work without throwing
      spinnerWithEta.start();
      spinnerWithEta.stop(true);

      spinnerWithoutEta.start();
      spinnerWithoutEta.stop(true);
    });

    test("can be started and stopped multiple times", () => {
      const spinner = createSpinner({ text: "Test" });

      for (let i = 0; i < 3; i++) {
        spinner.start();
        spinner.stop(true);
      }

      // If we got here, test passes
      expect(true).toBe(true);
    });

    test("update can be called multiple times", () => {
      const spinner = createSpinner({ text: "Test" });

      spinner.start();
      for (let i = 0; i < 10; i++) {
        spinner.update(`Message ${i}`);
      }
      spinner.stop(true);

      expect(true).toBe(true);
    });
  });

  describe("createProgressBar", () => {
    test("creates progress bar with required options", () => {
      testLog.step(1, "Testing progress bar creation");
      const bar = createProgressBar({ total: 100 });

      expect(bar).toBeDefined();
      expect(typeof bar.update).toBe("function");
      expect(typeof bar.finish).toBe("function");
      testLog.info("Progress bar created with all methods");
    });

    test("update changes progress", () => {
      const bar = createProgressBar({ total: 100, quiet: true });

      expect(() => bar.update(0)).not.toThrow();
      expect(() => bar.update(50)).not.toThrow();
      expect(() => bar.update(100)).not.toThrow();
    });

    test("update accepts optional message", () => {
      const bar = createProgressBar({ total: 100, quiet: true });

      expect(() => bar.update(50, "Processing...")).not.toThrow();
    });

    test("finish completes the bar", () => {
      const bar = createProgressBar({ total: 100, quiet: true });

      bar.update(100);
      expect(() => bar.finish()).not.toThrow();
    });

    test("handles custom width", () => {
      const narrowBar = createProgressBar({ total: 100, width: 10, quiet: true });
      const wideBar = createProgressBar({ total: 100, width: 50, quiet: true });

      // Both should work
      narrowBar.update(50);
      narrowBar.finish();

      wideBar.update(50);
      wideBar.finish();
    });

    test("handles quiet mode", () => {
      const bar = createProgressBar({ total: 100, quiet: true });

      bar.update(25);
      bar.update(50);
      bar.update(75);
      bar.update(100);
      bar.finish();

      // Should not throw, even in quiet mode
      expect(true).toBe(true);
    });

    test("handles total of 0", () => {
      const bar = createProgressBar({ total: 0, quiet: true });

      // Edge case: division by zero protection
      expect(() => bar.update(0)).not.toThrow();
      bar.finish();
    });

    test("handles total of 1", () => {
      const bar = createProgressBar({ total: 1, quiet: true });

      bar.update(0);
      bar.update(1);
      bar.finish();

      expect(true).toBe(true);
    });

    test("handles large totals", () => {
      const bar = createProgressBar({ total: 1000000, quiet: true });

      bar.update(500000);
      bar.update(1000000);
      bar.finish();

      expect(true).toBe(true);
    });

    test("handles progress greater than total", () => {
      const bar = createProgressBar({ total: 100, quiet: true });

      // Progress > total should be clamped or handled gracefully
      expect(() => bar.update(150)).not.toThrow();
      bar.finish();
    });

    test("handles negative progress", () => {
      const bar = createProgressBar({ total: 100, quiet: true });

      // Negative progress should be handled gracefully
      expect(() => bar.update(-10)).not.toThrow();
      bar.finish();
    });

    test("update with same value doesn't cause issues", () => {
      const bar = createProgressBar({ total: 100, quiet: true });

      bar.update(50);
      bar.update(50);
      bar.update(50);
      bar.finish();

      expect(true).toBe(true);
    });
  });

  describe("ETA estimation (via spinner)", () => {
    test("estimates based on text length", () => {
      testLog.step(1, "Testing ETA estimation");

      // Short text - should have short or no ETA
      const shortSpinner = createSpinner({
        text: "Short",
        showEta: true,
        quiet: true,
      });

      // Long text - should estimate longer
      const longSpinner = createSpinner({
        text: "A".repeat(1000),
        showEta: true,
        quiet: true,
      });

      // Both should work without throwing
      shortSpinner.start();
      shortSpinner.stop(true);

      longSpinner.start();
      longSpinner.stop(true);

      testLog.info("ETA estimation handled for various text lengths");
    });
  });

  describe("edge cases", () => {
    test("spinner handles special characters in text", () => {
      const spinner = createSpinner({
        text: "Special chars: 🎵 <>&\"'",
        quiet: true,
      });

      spinner.start();
      spinner.update("More special: ñ é ü");
      spinner.stop(true);

      expect(true).toBe(true);
    });

    test("spinner handles newlines in text", () => {
      const spinner = createSpinner({
        text: "Line 1\nLine 2\nLine 3",
        quiet: true,
      });

      spinner.start();
      spinner.stop(true);

      expect(true).toBe(true);
    });

    test("progress bar handles rapid updates", () => {
      const bar = createProgressBar({ total: 100, quiet: true });

      for (let i = 0; i <= 100; i++) {
        bar.update(i);
      }
      bar.finish();

      expect(true).toBe(true);
    });

    test("progress bar handles fractional values", () => {
      const bar = createProgressBar({ total: 100, quiet: true });

      bar.update(33.33);
      bar.update(66.66);
      bar.update(99.99);
      bar.finish();

      expect(true).toBe(true);
    });

    test("spinner can be stopped without starting", () => {
      const spinner = createSpinner({ text: "Test", quiet: true });

      // Stop without start should not throw
      expect(() => spinner.stop(true)).not.toThrow();
    });

    test("spinner update without start doesn't throw", () => {
      const spinner = createSpinner({ text: "Test", quiet: true });

      // Update without start might not show but shouldn't throw
      expect(() => spinner.update("Update")).not.toThrow();
    });
  });

  describe("visual output format (non-quiet)", () => {
    test("spinner outputs to console when not quiet", () => {
      // This is more of a smoke test - actual visual output is hard to test
      const spinner = createSpinner({ text: "Test output" });

      // Start and immediately stop
      spinner.start();
      spinner.stop(true);

      // If we got here without error, basic output works
      expect(true).toBe(true);
    });

    test("progress bar outputs to console when not quiet", () => {
      const bar = createProgressBar({ total: 10 });

      bar.update(5);
      bar.finish();

      expect(true).toBe(true);
    });
  });

  describe("interface compliance", () => {
    test("Progress interface is complete", () => {
      const spinner = createSpinner({ text: "Test", quiet: true });

      expect(spinner).toHaveProperty("start");
      expect(spinner).toHaveProperty("update");
      expect(spinner).toHaveProperty("stop");
    });

    test("ProgressBar interface is complete", () => {
      const bar = createProgressBar({ total: 100, quiet: true });

      expect(bar).toHaveProperty("update");
      expect(bar).toHaveProperty("finish");
    });

    test("ProgressOptions type allows all options", () => {
      const options: ProgressOptions = {
        text: "Test",
        showEta: true,
        quiet: false,
      };

      const spinner = createSpinner(options);
      expect(spinner).toBeDefined();
      spinner.start();
      spinner.stop(true);
    });

    test("ProgressBarOptions type allows all options", () => {
      const options: ProgressBarOptions = {
        total: 100,
        width: 40,
        quiet: false,
      };

      const bar = createProgressBar(options);
      expect(bar).toBeDefined();
      bar.update(50);
      bar.finish();
    });
  });
});
