/**
 * Test utilities and helpers for speak CLI tests
 *
 * Provides common functions for setting up test environments,
 * mocking file systems, capturing console output, and cleanup.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

/**
 * Create a temporary directory for tests
 */
export function createTempDir(prefix: string = "speak-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/**
 * Clean up temporary directory
 */
export function cleanupTempDir(dir: string): void {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Create a temporary file with content
 */
export function createTempFile(dir: string, filename: string, content: string): string {
  const filePath = join(dir, filename);
  const fileDir = join(dir, ...filename.split("/").slice(0, -1));
  if (fileDir !== dir && !existsSync(fileDir)) {
    mkdirSync(fileDir, { recursive: true });
  }
  writeFileSync(filePath, content);
  return filePath;
}

/**
 * Capture console output during function execution
 */
export interface CapturedOutput {
  stdout: string[];
  stderr: string[];
}

export function captureConsole(): {
  output: CapturedOutput;
  restore: () => void;
} {
  const output: CapturedOutput = { stdout: [], stderr: [] };
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;

  console.log = (...args: unknown[]) => {
    output.stdout.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]) => {
    output.stderr.push(args.map(String).join(" "));
  };
  console.warn = (...args: unknown[]) => {
    output.stderr.push(args.map(String).join(" "));
  };

  return {
    output,
    restore: () => {
      console.log = originalLog;
      console.error = originalError;
      console.warn = originalWarn;
    },
  };
}

/**
 * Wait for a condition to be true
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeout: number = 5000,
  interval: number = 100
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await condition()) {
      return;
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`Timeout waiting for condition after ${timeout}ms`);
}

/**
 * Generate random string for unique test identifiers
 */
export function randomId(length: number = 8): string {
  return Math.random().toString(36).substring(2, 2 + length);
}

/**
 * Mock environment variables for testing
 */
export function mockEnv(vars: Record<string, string | undefined>): () => void {
  const originalValues: Record<string, string | undefined> = {};

  for (const [key, value] of Object.entries(vars)) {
    originalValues[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return () => {
    for (const [key, value] of Object.entries(originalValues)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

/**
 * Test timeout wrapper
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeout: number,
  message: string = "Operation timed out"
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(message)), timeout)
    ),
  ]);
}

/**
 * Skip test if condition is true
 */
export function skipIf(condition: boolean, reason: string): void {
  if (condition) {
    console.log(`  [SKIP] ${reason}`);
  }
}

/**
 * Assertion helpers with detailed logging
 */
export const assert = {
  equals<T>(actual: T, expected: T, message?: string): void {
    if (actual !== expected) {
      throw new Error(
        `${message || "Assertion failed"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
      );
    }
  },

  deepEquals<T>(actual: T, expected: T, message?: string): void {
    const actualStr = JSON.stringify(actual, null, 2);
    const expectedStr = JSON.stringify(expected, null, 2);
    if (actualStr !== expectedStr) {
      throw new Error(
        `${message || "Deep equality assertion failed"}:\nExpected:\n${expectedStr}\nActual:\n${actualStr}`
      );
    }
  },

  contains(text: string, substring: string, message?: string): void {
    if (!text.includes(substring)) {
      throw new Error(
        `${message || "Contains assertion failed"}: "${substring}" not found in "${text.slice(0, 100)}..."`
      );
    }
  },

  matches(text: string, pattern: RegExp, message?: string): void {
    if (!pattern.test(text)) {
      throw new Error(
        `${message || "Pattern assertion failed"}: ${pattern} did not match "${text.slice(0, 100)}..."`
      );
    }
  },

  throws(fn: () => void, expectedMessage?: string | RegExp): void {
    let threw = false;
    let actualMessage = "";
    try {
      fn();
    } catch (e) {
      threw = true;
      actualMessage = e instanceof Error ? e.message : String(e);
    }
    if (!threw) {
      throw new Error("Expected function to throw, but it did not");
    }
    if (expectedMessage) {
      if (typeof expectedMessage === "string") {
        if (!actualMessage.includes(expectedMessage)) {
          throw new Error(
            `Expected error message to contain "${expectedMessage}", got "${actualMessage}"`
          );
        }
      } else {
        if (!expectedMessage.test(actualMessage)) {
          throw new Error(
            `Expected error message to match ${expectedMessage}, got "${actualMessage}"`
          );
        }
      }
    }
  },

  async throwsAsync(
    fn: () => Promise<void>,
    expectedMessage?: string | RegExp
  ): Promise<void> {
    let threw = false;
    let actualMessage = "";
    try {
      await fn();
    } catch (e) {
      threw = true;
      actualMessage = e instanceof Error ? e.message : String(e);
    }
    if (!threw) {
      throw new Error("Expected async function to throw, but it did not");
    }
    if (expectedMessage) {
      if (typeof expectedMessage === "string") {
        if (!actualMessage.includes(expectedMessage)) {
          throw new Error(
            `Expected error message to contain "${expectedMessage}", got "${actualMessage}"`
          );
        }
      } else {
        if (!expectedMessage.test(actualMessage)) {
          throw new Error(
            `Expected error message to match ${expectedMessage}, got "${actualMessage}"`
          );
        }
      }
    }
  },

  isTrue(value: boolean, message?: string): void {
    if (value !== true) {
      throw new Error(`${message || "Expected true"}, got ${value}`);
    }
  },

  isFalse(value: boolean, message?: string): void {
    if (value !== false) {
      throw new Error(`${message || "Expected false"}, got ${value}`);
    }
  },

  isNull(value: unknown, message?: string): void {
    if (value !== null) {
      throw new Error(`${message || "Expected null"}, got ${JSON.stringify(value)}`);
    }
  },

  isNotNull(value: unknown, message?: string): void {
    if (value === null || value === undefined) {
      throw new Error(`${message || "Expected non-null value"}, got ${value}`);
    }
  },

  arrayEquals<T>(actual: T[], expected: T[], message?: string): void {
    if (actual.length !== expected.length) {
      throw new Error(
        `${message || "Array length mismatch"}: expected ${expected.length}, got ${actual.length}`
      );
    }
    for (let i = 0; i < actual.length; i++) {
      if (actual[i] !== expected[i]) {
        throw new Error(
          `${message || "Array element mismatch"} at index ${i}: expected ${expected[i]}, got ${actual[i]}`
        );
      }
    }
  },
};

/**
 * Logging helpers for tests
 */
export const testLog = {
  info: (message: string) => console.log(`  [INFO] ${message}`),
  debug: (message: string) => console.log(`  [DEBUG] ${message}`),
  warn: (message: string) => console.log(`  [WARN] ${message}`),
  error: (message: string) => console.log(`  [ERROR] ${message}`),
  step: (step: number, message: string) => console.log(`  [STEP ${step}] ${message}`),
};
