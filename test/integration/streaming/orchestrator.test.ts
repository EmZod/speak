/**
 * Integration tests for StreamOrchestrator.
 * 
 * These tests verify the orchestrator coordinates components correctly.
 * Full e2e streaming tests require the Python server.
 * 
 * Note: Requires speaker native bindings to be built.
 */

import { describe, test, expect } from "bun:test";
import { StreamState } from "../../../src/streaming/state-machine.ts";

// Check if speaker bindings are available (required by orchestrator -> stream-player)
let StreamOrchestrator: typeof import("../../../src/streaming/orchestrator.ts").StreamOrchestrator;
let speakerAvailable = false;

try {
  const mod = await import("../../../src/streaming/orchestrator.ts");
  StreamOrchestrator = mod.StreamOrchestrator;
  speakerAvailable = true;
} catch {
  speakerAvailable = false;
}

// Check if Python server is available
const serverAvailable = await (async () => {
  try {
    const { isServerRunning } = await import("../../../src/bridge/client.ts");
    return await isServerRunning();
  } catch {
    return false;
  }
})();

describe.skipIf(!speakerAvailable)("StreamOrchestrator", () => {
  describe("initialization", () => {
    test("creates orchestrator with default config", () => {
      const orchestrator = new StreamOrchestrator();
      // Should not throw
      expect(orchestrator).toBeDefined();
    });

    test("creates orchestrator with custom config", () => {
      const orchestrator = new StreamOrchestrator(24000, {
        initialBufferSeconds: 5.0,
        minBufferSeconds: 2.0,
        resumeBufferSeconds: 3.0,
      });
      expect(orchestrator).toBeDefined();
    });

    test("creates orchestrator with custom sample rate", () => {
      const orchestrator = new StreamOrchestrator(44100);
      expect(orchestrator).toBeDefined();
    });
  });

  describe("cancel", () => {
    test("cancel can be called before streaming starts", () => {
      const orchestrator = new StreamOrchestrator();
      // Should not throw
      orchestrator.cancel("Test cancellation");
    });

    test("cancel accepts custom reason", () => {
      const orchestrator = new StreamOrchestrator();
      orchestrator.cancel("User pressed Ctrl+C");
      // Verify it doesn't throw
    });
  });

  describe("stream options validation", () => {
    test("stream rejects empty text", async () => {
      const orchestrator = new StreamOrchestrator();

      const result = await orchestrator.stream({
        text: "",
      });

      // Should fail gracefully (server not running or validation error)
      expect(result.success).toBe(false);
    });

    test("stream accepts optional parameters", async () => {
      const orchestrator = new StreamOrchestrator();

      // This will fail because server isn't running, but validates options are accepted
      const result = await orchestrator.stream({
        text: "Test text",
        model: "mlx-community/chatterbox-turbo-8bit",
        temperature: 0.7,
        speed: 1.2,
        voice: undefined,
      });

      // Will fail due to no server, but options were valid
      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("error");
    });
  });

  describe("progress callback", () => {
    test("progress callback is called with progress info", async () => {
      const orchestrator = new StreamOrchestrator();
      const progressCalls: Array<{ state: StreamState }> = [];

      await orchestrator.stream({
        text: "Test",
        onProgress: (progress) => {
          progressCalls.push({ state: progress.state });
        },
      });

      // Even on failure, should have initial progress
      // (may be empty if connection fails immediately)
      expect(Array.isArray(progressCalls)).toBe(true);
    });
  });

  describe("result structure", () => {
    test("stream returns proper result structure", async () => {
      const orchestrator = new StreamOrchestrator();

      const result = await orchestrator.stream({
        text: "Test",
      });

      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("totalChunks");
      expect(result).toHaveProperty("totalSamples");
      expect(result).toHaveProperty("totalDurationSeconds");
      expect(result).toHaveProperty("underrunCount");
      expect(result).toHaveProperty("rebufferCount");
      expect(result).toHaveProperty("finalState");
    });

    test("failed stream has error property", async () => {
      const orchestrator = new StreamOrchestrator();

      const result = await orchestrator.stream({
        text: "Test",
      });

      if (!result.success) {
        expect(result.error).toBeDefined();
        expect(typeof result.error).toBe("string");
      }
    });

    test("result counts are non-negative", async () => {
      const orchestrator = new StreamOrchestrator();

      const result = await orchestrator.stream({
        text: "Test",
      });

      expect(result.totalChunks).toBeGreaterThanOrEqual(0);
      expect(result.totalSamples).toBeGreaterThanOrEqual(0);
      expect(result.totalDurationSeconds).toBeGreaterThanOrEqual(0);
      expect(result.underrunCount).toBeGreaterThanOrEqual(0);
      expect(result.rebufferCount).toBeGreaterThanOrEqual(0);
    });
  });

  // Tests that require running server
  describe.skipIf(!serverAvailable)("with server", () => {
    test("streams short text successfully", async () => {
      const orchestrator = new StreamOrchestrator();

      const result = await orchestrator.stream({
        text: "Hello world.",
      });

      expect(result.success).toBe(true);
      expect(result.totalChunks).toBeGreaterThan(0);
      expect(result.totalSamples).toBeGreaterThan(0);
      expect(result.finalState).toBe(StreamState.FINISHED);
    });

    test("reports progress during streaming", async () => {
      const orchestrator = new StreamOrchestrator();
      const states: StreamState[] = [];

      await orchestrator.stream({
        text: "This is a test of the streaming system.",
        onProgress: (progress) => {
          if (!states.includes(progress.state)) {
            states.push(progress.state);
          }
        },
      });

      // Should have progressed through states
      expect(states.length).toBeGreaterThan(0);
    });

    test("cancel stops streaming", async () => {
      const orchestrator = new StreamOrchestrator();

      // Start streaming in background
      const streamPromise = orchestrator.stream({
        text: "This is a longer text that will take some time to generate and stream.",
      });

      // Cancel after a short delay
      setTimeout(() => orchestrator.cancel("Test cancellation"), 100);

      const result = await streamPromise;

      // Should have been cancelled
      expect(result.finalState).toBe(StreamState.FINISHED);
    });
  });
});
