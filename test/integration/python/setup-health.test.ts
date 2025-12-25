/**
 * Integration tests for python/setup.ts and python/health.ts
 *
 * Tests Python environment management:
 * - Python availability detection
 * - Virtual environment validation
 * - Package version retrieval
 * - Health check execution
 *
 * Note: Some tests require Python to be installed on the system.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync } from "fs";
import { testLog } from "../../helpers/test-utils.ts";
import { VENV_DIR, VENV_PYTHON, VENV_PIP } from "../../../src/core/config.ts";

// Import setup functions
import {
  checkPython,
  isVenvValid,
  getPackageVersions,
  REQUIRED_PACKAGES,
} from "../../../src/python/setup.ts";

// Import health functions
import { runHealthCheck, type HealthCheckResult } from "../../../src/python/health.ts";

// Check if system Python is available
let systemPythonAvailable = false;

describe("python/setup.ts integration tests", () => {
  beforeAll(async () => {
    testLog.info("Checking system Python availability...");

    const pythonCheck = await checkPython();
    systemPythonAvailable = pythonCheck.available;

    if (systemPythonAvailable) {
      testLog.info(`System Python found: ${pythonCheck.version} at ${pythonCheck.path}`);
    } else {
      testLog.warn("System Python not found - some tests will be skipped");
    }
  });

  describe("checkPython", () => {
    test("returns availability status", async () => {
      testLog.step(1, "Checking Python availability");

      const result = await checkPython();

      expect(result).toBeDefined();
      expect(typeof result.available).toBe("boolean");
      testLog.info(`Python available: ${result.available}`);
    });

    test.skipIf(!systemPythonAvailable)("returns version when available", async () => {
      const result = await checkPython();

      expect(result.available).toBe(true);
      expect(result.version).toBeDefined();
      expect(typeof result.version).toBe("string");
      expect(result.version).toMatch(/^\d+\.\d+/);

      testLog.info(`Python version: ${result.version}`);
    });

    test.skipIf(!systemPythonAvailable)("returns path when available", async () => {
      const result = await checkPython();

      expect(result.available).toBe(true);
      expect(result.path).toBeDefined();
      expect(typeof result.path).toBe("string");
      expect(result.path).toContain("python");

      testLog.info(`Python path: ${result.path}`);
    });
  });

  describe("isVenvValid", () => {
    test("returns boolean", () => {
      testLog.step(1, "Checking virtual environment validity");

      const result = isVenvValid();

      expect(typeof result).toBe("boolean");
      testLog.info(`Virtual environment valid: ${result}`);
    });

    test("checks for Python interpreter", () => {
      // isVenvValid checks if VENV_PYTHON exists
      const venvValid = isVenvValid();

      if (venvValid) {
        expect(existsSync(VENV_PYTHON)).toBe(true);
      }
    });

    test("checks for pip", () => {
      const venvValid = isVenvValid();

      if (venvValid) {
        expect(existsSync(VENV_PIP)).toBe(true);
      }
    });
  });

  describe("REQUIRED_PACKAGES", () => {
    test("includes mlx-audio", () => {
      expect(REQUIRED_PACKAGES).toContain("mlx-audio");
    });

    test("includes essential dependencies", () => {
      expect(REQUIRED_PACKAGES).toContain("mlx-lm");
      expect(REQUIRED_PACKAGES).toContain("scipy");
    });

    test("is non-empty array", () => {
      expect(Array.isArray(REQUIRED_PACKAGES)).toBe(true);
      expect(REQUIRED_PACKAGES.length).toBeGreaterThan(0);
    });
  });

  describe("getPackageVersions", () => {
    const venvValid = isVenvValid();

    test.skipIf(!venvValid)("returns package versions when venv exists", async () => {
      testLog.step(1, "Getting package versions");

      const versions = await getPackageVersions();

      expect(versions).toBeDefined();
      expect(typeof versions).toBe("object");

      // Log found packages
      const packageCount = Object.keys(versions).length;
      testLog.info(`Found ${packageCount} packages`);
    });

    test.skipIf(!venvValid)("includes mlx-audio version", async () => {
      const versions = await getPackageVersions();

      // Package names may be normalized
      const mlxAudioVersion = versions["mlx-audio"] || versions["mlx_audio"];

      if (mlxAudioVersion) {
        expect(typeof mlxAudioVersion).toBe("string");
        testLog.info(`mlx-audio version: ${mlxAudioVersion}`);
      }
    });

    test("returns empty object when venv doesn't exist", async () => {
      // If venv doesn't exist, should return empty object
      if (!isVenvValid()) {
        const versions = await getPackageVersions();
        expect(Object.keys(versions).length).toBe(0);
      }
    });
  });

  describe("path constants", () => {
    test("VENV_DIR is in home .chatter", () => {
      expect(VENV_DIR).toContain(".chatter");
      expect(VENV_DIR).toContain("env");
    });

    test("VENV_PYTHON is in VENV_DIR", () => {
      expect(VENV_PYTHON.startsWith(VENV_DIR)).toBe(true);
      expect(VENV_PYTHON).toContain("python3");
    });

    test("VENV_PIP is in VENV_DIR", () => {
      expect(VENV_PIP.startsWith(VENV_DIR)).toBe(true);
      expect(VENV_PIP).toContain("pip");
    });
  });
});

describe("python/health.ts integration tests", () => {
  const venvValid = isVenvValid();

  describe("runHealthCheck", () => {
    test.skipIf(!venvValid)("returns complete health check result", async () => {
      testLog.step(1, "Running health check");

      const result = await runHealthCheck();

      expect(result).toBeDefined();
      expect(typeof result.healthy).toBe("boolean");
      expect(typeof result.venvExists).toBe("boolean");
      expect(typeof result.pythonWorks).toBe("boolean");
      expect(typeof result.mlxAudioImports).toBe("boolean");
      expect(Array.isArray(result.missingPackages)).toBe(true);
      expect(Array.isArray(result.errors)).toBe(true);

      testLog.info(`Health check result: ${result.healthy ? "healthy" : "unhealthy"}`);
    });

    test.skipIf(!venvValid)("venvExists is true when venv valid", async () => {
      const result = await runHealthCheck();

      expect(result.venvExists).toBe(true);
    });

    test.skipIf(!venvValid)("pythonWorks is true when Python runs", async () => {
      const result = await runHealthCheck();

      expect(result.pythonWorks).toBe(true);
    });

    test.skipIf(!venvValid)("reports mlx-audio version when healthy", async () => {
      const result = await runHealthCheck();

      if (result.mlxAudioImports) {
        expect(result.mlxAudioVersion).toBeDefined();
        expect(typeof result.mlxAudioVersion).toBe("string");
        testLog.info(`mlx-audio version: ${result.mlxAudioVersion}`);
      }
    });

    test.skipIf(!venvValid)("missingPackages is empty when healthy", async () => {
      const result = await runHealthCheck();

      if (result.healthy) {
        expect(result.missingPackages.length).toBe(0);
      }
    });

    test.skipIf(!venvValid)("errors is empty when healthy", async () => {
      const result = await runHealthCheck();

      if (result.healthy) {
        expect(result.errors.length).toBe(0);
      }
    });

    test("returns venvExists false when venv missing", async () => {
      if (!venvValid) {
        const result = await runHealthCheck();

        expect(result.venvExists).toBe(false);
        expect(result.healthy).toBe(false);
      }
    });
  });

  describe("HealthCheckResult type", () => {
    test.skipIf(!venvValid)("has all required fields", async () => {
      const result: HealthCheckResult = await runHealthCheck();

      // Type check - all these should exist
      const _healthy: boolean = result.healthy;
      const _venvExists: boolean = result.venvExists;
      const _pythonWorks: boolean = result.pythonWorks;
      const _mlxAudioImports: boolean = result.mlxAudioImports;
      const _mlxAudioVersion: string | undefined = result.mlxAudioVersion;
      const _missingPackages: string[] = result.missingPackages;
      const _errors: string[] = result.errors;

      expect(true).toBe(true); // Type check passed
    });
  });

  describe("health check scenarios", () => {
    test.skipIf(!venvValid)("handles complete healthy environment", async () => {
      testLog.step(1, "Testing healthy environment scenario");

      const result = await runHealthCheck();

      if (result.healthy) {
        expect(result.venvExists).toBe(true);
        expect(result.pythonWorks).toBe(true);
        expect(result.mlxAudioImports).toBe(true);
        expect(result.missingPackages).toEqual([]);
        expect(result.errors).toEqual([]);

        testLog.info("Environment is completely healthy");
      } else {
        testLog.warn("Environment has issues - check errors:");
        for (const error of result.errors) {
          testLog.warn(`  - ${error}`);
        }
      }
    });
  });
});

describe("setup and health integration", () => {
  const venvValid = isVenvValid();

  test.skipIf(!venvValid)("health check validates setup", async () => {
    testLog.step(1, "Validating setup through health check");

    const health = await runHealthCheck();

    // If venv is valid, health check should at least pass venv check
    expect(health.venvExists).toBe(true);

    testLog.info(`Setup validation: venv=${health.venvExists}, python=${health.pythonWorks}, mlx=${health.mlxAudioImports}`);
  });

  test.skipIf(!venvValid)("package versions match health check", async () => {
    const versions = await getPackageVersions();
    const health = await runHealthCheck();

    if (health.mlxAudioVersion) {
      const mlxVersion = versions["mlx-audio"] || versions["mlx_audio"];
      expect(mlxVersion).toBe(health.mlxAudioVersion);
    }
  });

  test("missing venv causes health check failure", async () => {
    if (!venvValid) {
      const health = await runHealthCheck();

      expect(health.healthy).toBe(false);
      expect(health.venvExists).toBe(false);
      expect(health.errors.length).toBeGreaterThan(0);
    }
  });
});
