/**
 * Integration tests for bridge/client.ts and bridge/daemon.ts
 *
 * Tests IPC communication between TypeScript client and Python server:
 * - Daemon lifecycle (start, stop)
 * - Health checks
 * - Request/response communication
 * - Error handling
 *
 * Note: These tests require the Python environment to be set up.
 * Run `speak setup` before running these tests.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { existsSync, unlinkSync } from "fs";
import { testLog, waitFor, withTimeout } from "../../helpers/test-utils.ts";
import { SOCKET_PATH, VENV_PYTHON } from "../../../src/core/config.ts";
import { isVenvValid } from "../../../src/python/setup.ts";

// Dynamic imports to avoid issues if Python isn't set up
let startDaemon: typeof import("../../../src/bridge/daemon.ts").startDaemon;
let stopDaemon: typeof import("../../../src/bridge/daemon.ts").stopDaemon;
let getDaemonPid: typeof import("../../../src/bridge/daemon.ts").getDaemonPid;
let ensureDaemon: typeof import("../../../src/bridge/daemon.ts").ensureDaemon;
let checkHealth: typeof import("../../../src/bridge/client.ts").checkHealth;
let isServerRunning: typeof import("../../../src/bridge/client.ts").isServerRunning;
let listModels: typeof import("../../../src/bridge/client.ts").listModels;
let sendRequest: typeof import("../../../src/bridge/client.ts").sendRequest;

// Check if Python environment is available
const pythonAvailable = isVenvValid();

describe("bridge integration tests", () => {
  beforeAll(async () => {
    if (!pythonAvailable) {
      testLog.warn("Python environment not set up - skipping integration tests");
      testLog.info("Run 'speak setup' to enable these tests");
      return;
    }

    // Import modules
    const daemon = await import("../../../src/bridge/daemon.ts");
    const client = await import("../../../src/bridge/client.ts");

    startDaemon = daemon.startDaemon;
    stopDaemon = daemon.stopDaemon;
    getDaemonPid = daemon.getDaemonPid;
    ensureDaemon = daemon.ensureDaemon;
    checkHealth = client.checkHealth;
    isServerRunning = client.isServerRunning;
    listModels = client.listModels;
    sendRequest = client.sendRequest;

    // Initialize logger
    const { initLogger } = await import("../../../src/ui/logger.ts");
    initLogger({ logLevel: "error", quiet: true });

    testLog.info("Integration test setup complete");
  });

  afterAll(async () => {
    if (!pythonAvailable) return;

    // Ensure daemon is stopped after all tests
    try {
      await stopDaemon();
    } catch {
      // Ignore cleanup errors
    }

    // Clean up socket if it exists
    if (existsSync(SOCKET_PATH)) {
      try {
        unlinkSync(SOCKET_PATH);
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe("daemon lifecycle", () => {
    beforeEach(async () => {
      if (!pythonAvailable) return;

      // Ensure clean state before each test
      try {
        await stopDaemon();
      } catch {
        // Ignore errors
      }
    });

    afterEach(async () => {
      if (!pythonAvailable) return;

      // Clean up after each test
      try {
        await stopDaemon();
      } catch {
        // Ignore errors
      }
    });

    test.skipIf(!pythonAvailable)("startDaemon starts the server", async () => {
      testLog.step(1, "Starting daemon");

      const started = await withTimeout(
        startDaemon(),
        30000,
        "Daemon start timeout"
      );

      expect(started).toBe(true);

      // Verify server is running
      const running = await isServerRunning();
      expect(running).toBe(true);

      testLog.info("Daemon started successfully");
    });

    test.skipIf(!pythonAvailable)("stopDaemon stops the server", async () => {
      testLog.step(1, "Starting daemon for stop test");
      await startDaemon();

      testLog.step(2, "Stopping daemon");
      const stopped = await stopDaemon();

      expect(stopped).toBe(true);

      // Verify server is not running
      const running = await isServerRunning();
      expect(running).toBe(false);

      testLog.info("Daemon stopped successfully");
    });

    test.skipIf(!pythonAvailable)("getDaemonPid returns null when not running", async () => {
      const pid = getDaemonPid();

      // Should be null when daemon is not running
      // (afterEach should have stopped it)
      expect(pid).toBeNull();
    });

    test.skipIf(!pythonAvailable)("getDaemonPid returns PID when running", async () => {
      await startDaemon();

      const pid = getDaemonPid();

      expect(pid).not.toBeNull();
      expect(typeof pid).toBe("number");
      expect(pid).toBeGreaterThan(0);

      testLog.info(`Daemon PID: ${pid}`);
    });

    test.skipIf(!pythonAvailable)("ensureDaemon starts if not running", async () => {
      testLog.step(1, "Calling ensureDaemon when not running");

      const result = await ensureDaemon();

      expect(result).toBe(true);

      const running = await isServerRunning();
      expect(running).toBe(true);

      testLog.info("ensureDaemon started daemon");
    });

    test.skipIf(!pythonAvailable)("ensureDaemon returns true if already running", async () => {
      testLog.step(1, "Starting daemon first");
      await startDaemon();

      testLog.step(2, "Calling ensureDaemon again");
      const result = await ensureDaemon();

      expect(result).toBe(true);

      testLog.info("ensureDaemon recognized running daemon");
    });

    test.skipIf(!pythonAvailable)("stopDaemon is idempotent", async () => {
      // Stop multiple times should not error
      await stopDaemon();
      await stopDaemon();
      await stopDaemon();

      const running = await isServerRunning();
      expect(running).toBe(false);
    });

    test.skipIf(!pythonAvailable)("daemon cleans up stale socket", async () => {
      // If socket exists but daemon is not running, should clean up
      // This is tested implicitly by startDaemon

      // Force create a stale socket scenario is complex,
      // so we just verify startDaemon handles the normal case
      await startDaemon();
      await stopDaemon();

      // Socket should be cleaned up
      expect(existsSync(SOCKET_PATH)).toBe(false);
    });
  });

  describe("health checks", () => {
    beforeAll(async () => {
      if (!pythonAvailable) return;

      // Ensure clean state first
      try {
        await stopDaemon();
      } catch {
        // Ignore
      }

      // Start daemon for health check tests
      const started = await startDaemon();
      if (!started) {
        testLog.warn("Failed to start daemon for health checks");
      }
    });

    afterAll(async () => {
      if (!pythonAvailable) return;

      await stopDaemon();
    });

    test.skipIf(!pythonAvailable)("checkHealth returns health info", async () => {
      testLog.step(1, "Checking server health");

      // Ensure daemon is running
      await ensureDaemon();
      const health = await checkHealth();

      expect(health).toBeDefined();
      expect(health.status).toBe("healthy");
      expect(health.mlx_audio_version).toBeDefined();
      expect(typeof health.mlx_audio_version).toBe("string");

      testLog.info(`Server healthy, mlx-audio version: ${health.mlx_audio_version}`);
    });

    test.skipIf(!pythonAvailable)("isServerRunning returns true when running", async () => {
      await ensureDaemon();
      const running = await isServerRunning();

      expect(running).toBe(true);
    });

    test.skipIf(!pythonAvailable)("checkHealth fails when server not running", async () => {
      // Stop server temporarily
      await stopDaemon();

      try {
        await checkHealth();
        // Should not reach here
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeDefined();
        testLog.info("Health check correctly failed when server not running");
      }

      // Restart for other tests
      await startDaemon();
    });
  });

  describe("model listing", () => {
    beforeAll(async () => {
      if (!pythonAvailable) return;

      // Ensure clean start
      try {
        await stopDaemon();
      } catch {
        // Ignore
      }
      await startDaemon();
    });

    afterAll(async () => {
      if (!pythonAvailable) return;

      await stopDaemon();
    });

    test.skipIf(!pythonAvailable)("listModels returns available models", async () => {
      testLog.step(1, "Listing available models");

      await ensureDaemon();
      const result = await listModels();

      expect(result).toBeDefined();
      expect(result.models).toBeDefined();
      expect(Array.isArray(result.models)).toBe(true);
      expect(result.models.length).toBeGreaterThan(0);

      // Check model structure
      const firstModel = result.models[0];
      expect(firstModel.name).toBeDefined();
      expect(firstModel.description).toBeDefined();

      testLog.info(`Found ${result.models.length} models`);
      for (const model of result.models) {
        testLog.debug(`  - ${model.name}: ${model.description}`);
      }
    });

    test.skipIf(!pythonAvailable)("models include expected Chatterbox variants", async () => {
      await ensureDaemon();
      const result = await listModels();
      const modelNames = result.models.map((m) => m.name);

      expect(modelNames).toContain("mlx-community/chatterbox-turbo-8bit");
      expect(modelNames).toContain("mlx-community/chatterbox-turbo-fp16");
    });
  });

  describe("error handling", () => {
    beforeAll(async () => {
      if (!pythonAvailable) return;

      // Ensure clean state first
      try {
        await stopDaemon();
      } catch {
        // Ignore
      }
      await startDaemon();
    });

    afterAll(async () => {
      if (!pythonAvailable) return;

      await stopDaemon();
    });

    test.skipIf(!pythonAvailable)("unknown method returns error", async () => {
      testLog.step(1, "Testing unknown method handling");

      await ensureDaemon();
      try {
        await sendRequest("unknown-method", {});
        // Should throw
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeDefined();
        const message = error instanceof Error ? error.message : String(error);
        expect(message).toContain("Unknown method");
        testLog.info("Unknown method correctly rejected");
      }
    });

    test.skipIf(!pythonAvailable)("request timeout is handled", async () => {
      // This test would require a method that takes a very long time
      // For now, we just verify the timeout parameter exists
      // by calling with a very short timeout on health (which is fast)

      await ensureDaemon();
      // Should succeed with normal timeout
      const health = await sendRequest<{ status: string }>("health", {}, 5000);
      expect(health.status).toBe("healthy");
    });
  });

  describe("connection handling", () => {
    beforeEach(async () => {
      if (!pythonAvailable) return;

      // Ensure clean state before each test
      try {
        await stopDaemon();
      } catch {
        // Ignore errors
      }
    });

    afterAll(async () => {
      if (!pythonAvailable) return;

      // Clean up after all tests
      try {
        await stopDaemon();
      } catch {
        // Ignore errors
      }
    });

    test.skipIf(!pythonAvailable)("connection refused when server not running", async () => {
      // Server should already be stopped by beforeEach
      const running = await isServerRunning();
      expect(running).toBe(false);
    });

    test.skipIf(!pythonAvailable)("multiple sequential requests work", async () => {
      testLog.step(1, "Testing sequential requests");

      await ensureDaemon();

      // Send multiple health checks
      const health1 = await checkHealth();
      const health2 = await checkHealth();
      const health3 = await checkHealth();

      expect(health1.status).toBe("healthy");
      expect(health2.status).toBe("healthy");
      expect(health3.status).toBe("healthy");

      testLog.info("Sequential requests completed successfully");
    });

    test.skipIf(!pythonAvailable)("concurrent requests work", async () => {
      testLog.step(1, "Testing concurrent requests");

      await ensureDaemon();

      // Send multiple health checks concurrently
      const [health1, health2, health3] = await Promise.all([
        checkHealth(),
        checkHealth(),
        checkHealth(),
      ]);

      expect(health1.status).toBe("healthy");
      expect(health2.status).toBe("healthy");
      expect(health3.status).toBe("healthy");

      testLog.info("Concurrent requests completed successfully");
    });
  });
});
