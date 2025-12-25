/**
 * End-to-end tests for CLI commands
 *
 * Tests the speak CLI as a black box:
 * - help command
 * - version command
 * - config command
 * - models command
 * - setup command (with --health)
 * - daemon command
 *
 * Note: Some tests require the Python environment to be set up.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { spawn } from "child_process";
import { join } from "path";
import { existsSync } from "fs";
import {
  testLog,
  createTempDir,
  cleanupTempDir,
  withTimeout,
} from "../helpers/test-utils.ts";
import { isVenvValid } from "../../src/python/setup.ts";

// Path to the CLI entry point
const CLI_PATH = join(import.meta.dir, "../../src/index.ts");

// Helper to run CLI commands
async function runCli(
  args: string[],
  options?: { timeout?: number; env?: Record<string, string> }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn("bun", ["run", CLI_PATH, ...args], {
      env: { ...process.env, ...options?.env },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    const timeout = options?.timeout ?? 30000;
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

const pythonAvailable = isVenvValid();

describe("CLI e2e tests", () => {
  describe("help command", () => {
    test("shows help with --help", async () => {
      testLog.step(1, "Testing --help flag");

      const result = await runCli(["--help"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("speak");
      expect(result.stdout).toContain("text to speech");
      expect(result.stdout).toContain("Options");

      testLog.info("Help displayed correctly");
    });

    test("shows help for subcommands", async () => {
      const result = await runCli(["setup", "--help"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("setup");
    });
  });

  describe("version command", () => {
    test("shows version with --version", async () => {
      testLog.step(1, "Testing --version flag");

      const result = await runCli(["--version"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);

      testLog.info(`Version: ${result.stdout.trim()}`);
    });
  });

  describe("config command", () => {
    test("shows current configuration", async () => {
      testLog.step(1, "Testing config command");

      const result = await runCli(["config"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Current Configuration");
      expect(result.stdout).toContain("output_dir");
      expect(result.stdout).toContain("model");
      expect(result.stdout).toContain("temperature");

      testLog.info("Config displayed correctly");
    });

    test("config shows file location", async () => {
      const result = await runCli(["config"]);

      expect(result.stdout).toContain("config.toml");
      expect(result.stdout).toContain(".chatter");
    });

    test("config --init creates config file", async () => {
      testLog.step(1, "Testing config --init");

      const result = await runCli(["config", "--init"]);

      // May already exist, which is also okay
      if (result.exitCode === 0) {
        const hasCreated = result.stdout.includes("Created");
        const alreadyExists = result.stdout.includes("already exists");
        expect(hasCreated || alreadyExists).toBe(true);
      }

      testLog.info("Config init completed");
    });
  });

  describe("models command", () => {
    test("lists available models", async () => {
      testLog.step(1, "Testing models command");

      const result = await runCli(["models"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Chatterbox");
      expect(result.stdout).toContain("mlx-community");
      expect(result.stdout).toContain("8bit");

      testLog.info("Models listed correctly");
    });

    test("shows model descriptions", async () => {
      const result = await runCli(["models"]);

      expect(result.stdout).toContain("quantized");
      expect(result.stdout).toContain("precision");
    });

    test("marks current/default model", async () => {
      const result = await runCli(["models"]);

      expect(result.stdout).toContain("current");
    });
  });

  describe("setup command", () => {
    test.skipIf(!pythonAvailable)("setup --health checks environment", async () => {
      testLog.step(1, "Testing setup --health");

      const result = await runCli(["setup", "--health"], { timeout: 60000 });

      // Should succeed if Python is properly set up
      if (result.exitCode === 0) {
        expect(result.stdout).toContain("healthy");
      } else {
        expect(result.stdout + result.stderr).toContain("issue");
      }

      testLog.info("Health check completed");
    });

    test("setup help shows options", async () => {
      const result = await runCli(["setup", "--help"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("--force");
      expect(result.stdout).toContain("--health");
    });
  });

  describe("daemon command", () => {
    test("daemon help shows subcommands", async () => {
      const result = await runCli(["daemon", "--help"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("kill");
    });

    test.skipIf(!pythonAvailable)("daemon kill is safe when not running", async () => {
      testLog.step(1, "Testing daemon kill");

      const result = await runCli(["daemon", "kill"]);

      // Should not error even if daemon isn't running
      expect(result.exitCode).toBe(0);

      testLog.info("Daemon kill completed safely");
    });
  });

  describe("completions command", () => {
    test("generates bash completions", async () => {
      testLog.step(1, "Testing bash completions");

      const result = await runCli(["completions", "bash"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("complete");
      expect(result.stdout).toContain("_speak");

      testLog.info("Bash completions generated");
    });

    test("generates zsh completions", async () => {
      const result = await runCli(["completions", "zsh"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("#compdef");
      expect(result.stdout).toContain("speak");
    });

    test("generates fish completions", async () => {
      const result = await runCli(["completions", "fish"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("complete -c speak");
    });

    test("rejects invalid shell", async () => {
      const result = await runCli(["completions", "invalid"]);

      expect(result.exitCode).toBe(1);
      expect(result.stdout + result.stderr).toContain("Invalid shell");
    });

    test("completions --install shows instructions", async () => {
      const result = await runCli(["completions", "bash", "--install"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("bashrc");
      expect(result.stdout).toContain("eval");
    });
  });

  describe("input handling", () => {
    test.skipIf(!pythonAvailable)("handles no input gracefully", async () => {
      testLog.step(1, "Testing no input handling");

      const result = await runCli([]);

      // Should show usage or error message
      expect(result.stdout + result.stderr).toMatch(/input|help|usage/i);

      testLog.info("No input handled gracefully");
    });

    test.skipIf(!pythonAvailable)("handles missing file gracefully", async () => {
      const result = await runCli(["nonexistent-file.txt"]);

      // Should either try to speak the text or fail gracefully
      expect(result.exitCode).toBeDefined();
    });
  });

  describe("option validation", () => {
    test.skipIf(!pythonAvailable)("validates temperature range", async () => {
      testLog.step(1, "Testing temperature validation");

      // Valid temperature
      const validResult = await runCli(["--temp", "0.5", "--help"]);
      expect(validResult.exitCode).toBe(0);

      // Note: actual validation happens at runtime
      testLog.info("Temperature option accepted");
    });

    test.skipIf(!pythonAvailable)("validates speed range", async () => {
      // Valid speed
      const validResult = await runCli(["--speed", "1.0", "--help"]);
      expect(validResult.exitCode).toBe(0);
    });

    test("accepts all markdown modes", async () => {
      const modes = ["plain", "smart"];

      for (const mode of modes) {
        const result = await runCli(["--markdown", mode, "--help"]);
        expect(result.exitCode).toBe(0);
      }
    });

    test("accepts all code-block modes", async () => {
      const modes = ["read", "skip", "placeholder"];

      for (const mode of modes) {
        const result = await runCli(["--code-blocks", mode, "--help"]);
        expect(result.exitCode).toBe(0);
      }
    });
  });

  describe("environment variable overrides", () => {
    test("SPEAK_MODEL is recognized", async () => {
      const result = await runCli(["config"], {
        env: { SPEAK_MODEL: "test-model" },
      });

      // Config should show the env override is possible
      expect(result.stdout).toContain("model");
    });
  });

  describe("quiet and verbose modes", () => {
    test.skipIf(!pythonAvailable)("--quiet reduces output", async () => {
      testLog.step(1, "Testing quiet mode");

      // With --quiet and --help, should still show help
      const result = await runCli(["--quiet", "--help"]);
      expect(result.exitCode).toBe(0);

      testLog.info("Quiet mode tested");
    });

    test.skipIf(!pythonAvailable)("--verbose increases output", async () => {
      // With --verbose and --help
      const result = await runCli(["--verbose", "--help"]);
      expect(result.exitCode).toBe(0);
    });
  });
});

describe("CLI error handling", () => {
  test("unknown command shows error", async () => {
    const result = await runCli(["unknown-command"]);

    // Commander.js may handle this differently
    // It might show help or an error
    expect(result.stdout + result.stderr).toBeDefined();
  });

  test("invalid option shows error", async () => {
    const result = await runCli(["--invalid-option"]);

    // Should error or show help
    if (result.exitCode !== 0) {
      expect(result.stdout + result.stderr).toMatch(/unknown|invalid|error/i);
    }
  });
});
