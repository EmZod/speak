/**
 * Integration tests for StreamPlayer.
 * 
 * Note: These tests require the speaker native module to be built.
 * Skip if native bindings not available.
 */

import { describe, test, expect, beforeEach } from "bun:test";

// Check if speaker bindings are available
let StreamPlayer: typeof import("../../../src/audio/stream-player.ts").StreamPlayer;
let speakerAvailable = false;

try {
  const mod = await import("../../../src/audio/stream-player.ts");
  StreamPlayer = mod.StreamPlayer;
  speakerAvailable = true;
} catch {
  speakerAvailable = false;
}

const audioTestsEnabled = process.env.SPEAK_AUDIO_TESTS === "1";

describe.skipIf(!speakerAvailable)("StreamPlayer", () => {
  let player: InstanceType<typeof StreamPlayer>;

  beforeEach(() => {
    player = new StreamPlayer({
      sampleRate: 24000,
      bufferDurationSeconds: 5,
      chunkSamples: 1024,
    });
  });

  describe("initialization", () => {
    test("initializes with default config", () => {
      const defaultPlayer = new StreamPlayer();
      expect(defaultPlayer.bufferedSeconds).toBe(0);
      expect(defaultPlayer.isPlaying).toBe(false);
      expect(defaultPlayer.isFinished).toBe(false);
    });

    test("initializes with custom config", () => {
      expect(player.bufferedSeconds).toBe(0);
      expect(player.underrunSamples).toBe(0);
    });
  });

  describe("buffer operations", () => {
    test("write adds samples to buffer", () => {
      const samples = new Float32Array(24000); // 1 second
      const written = player.write(samples);

      expect(written).toBe(24000);
      expect(player.bufferedSeconds).toBeCloseTo(1.0, 1);
    });

    test("write handles partial writes when buffer full", () => {
      // Fill buffer (5 seconds = 120000 samples at 24kHz)
      const largeSamples = new Float32Array(120000);
      player.write(largeSamples);

      // Try to write more
      const moreSamples = new Float32Array(24000);
      const written = player.write(moreSamples);

      // Should write less than requested
      expect(written).toBeLessThan(24000);
    });

    test("bufferedSeconds updates correctly", () => {
      expect(player.bufferedSeconds).toBe(0);

      player.write(new Float32Array(12000)); // 0.5 seconds
      expect(player.bufferedSeconds).toBeCloseTo(0.5, 1);

      player.write(new Float32Array(12000)); // Another 0.5 seconds
      expect(player.bufferedSeconds).toBeCloseTo(1.0, 1);
    });
  });

  describe("state management", () => {
    test("isPlaying is false initially", () => {
      expect(player.isPlaying).toBe(false);
    });

    test("isFinished is false initially", () => {
      expect(player.isFinished).toBe(false);
    });

    test("underrunSamples is zero initially", () => {
      expect(player.underrunSamples).toBe(0);
    });
  });

  describe("draining", () => {
    test("startDraining can be called before start", () => {
      // Should not throw
      player.startDraining();
    });
  });

  describe("stop", () => {
    test("stop can be called without starting", async () => {
      // Should not throw - returns early if nothing to stop
      await player.stop();
      // isFinished remains false because nothing was playing
      expect(player.isPlaying).toBe(false);
    });

    test("stop is idempotent", async () => {
      await player.stop();
      await player.stop();
      await player.stop();
      // Multiple stops don't throw
      expect(player.isPlaying).toBe(false);
    });
  });

  describe("getStats", () => {
    test("returns stats object", () => {
      const stats = player.getStats();

      expect(stats).toHaveProperty("playing");
      expect(stats).toHaveProperty("draining");
      expect(stats).toHaveProperty("finished");
      expect(stats).toHaveProperty("buffer");
    });

    test("stats reflect current state", () => {
      player.write(new Float32Array(24000));
      const stats = player.getStats();

      expect(stats.playing).toBe(false);
      expect(stats.draining).toBe(false);
      expect(stats.finished).toBe(false);
      expect((stats.buffer as Record<string, number>).available_read_samples).toBe(24000);
    });
  });

  // Audio playback tests - require hardware
  describe.skipIf(!audioTestsEnabled)("audio playback", () => {
    test("start begins playback", async () => {
      // Add some samples first
      const samples = new Float32Array(48000); // 2 seconds
      for (let i = 0; i < samples.length; i++) {
        samples[i] = Math.sin(i * 0.1) * 0.3; // Quiet sine wave
      }
      player.write(samples);

      player.start();
      expect(player.isPlaying).toBe(true);

      // Let it play briefly
      await new Promise((r) => setTimeout(r, 100));

      await player.stop();
      expect(player.isPlaying).toBe(false);
    });

    test("draining completes when buffer empties", async () => {
      const samples = new Float32Array(12000); // 0.5 seconds
      for (let i = 0; i < samples.length; i++) {
        samples[i] = Math.sin(i * 0.1) * 0.3;
      }
      player.write(samples);

      player.start();
      player.startDraining();

      await player.waitForFinish();
      expect(player.isFinished).toBe(true);
    });
  });
});
