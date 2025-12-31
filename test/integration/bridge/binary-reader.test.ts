/**
 * Integration tests for binary protocol reader.
 * 
 * Tests message parsing with the helper functions.
 * The async generator (readBinaryStream) is tested indirectly through
 * orchestrator integration tests since it requires real socket behavior.
 */

import { describe, test, expect } from "bun:test";
import {
  parseMessage,
  buildChunkMessage,
  buildEndMessage,
  buildErrorMessage,
  type StreamMessage,
} from "../../../src/bridge/binary-reader.ts";

describe("binary-reader", () => {
  describe("message stream parsing", () => {
    test("parses stream of multiple chunks", () => {
      // Build a buffer with multiple messages
      const chunk1 = buildChunkMessage(0, new Float32Array([0.1, 0.2]), 24000);
      const chunk2 = buildChunkMessage(1, new Float32Array([0.3, 0.4]), 24000);
      const chunk3 = buildChunkMessage(2, new Float32Array([0.5, 0.6]), 24000);
      const endMsg = buildEndMessage(3);

      let buffer = Buffer.concat([chunk1, chunk2, chunk3, endMsg]);
      const messages: StreamMessage[] = [];

      // Parse all messages from buffer
      while (buffer.length > 0) {
        const result = parseMessage(buffer);
        if (result === null) break;
        messages.push(result.message);
        buffer = result.remaining;
      }

      expect(messages.length).toBe(4);
      expect(messages[0]!.type).toBe("chunk");
      expect(messages[1]!.type).toBe("chunk");
      expect(messages[2]!.type).toBe("chunk");
      expect(messages[3]!.type).toBe("end");

      // Verify chunk IDs
      if (messages[0]!.type === "chunk") expect(messages[0]!.id).toBe(0);
      if (messages[1]!.type === "chunk") expect(messages[1]!.id).toBe(1);
      if (messages[2]!.type === "chunk") expect(messages[2]!.id).toBe(2);
      if (messages[3]!.type === "end") expect(messages[3]!.totalChunks).toBe(3);
    });

    test("parses stream ending with error", () => {
      const chunk1 = buildChunkMessage(0, new Float32Array([0.1]), 24000);
      const errorMsg = buildErrorMessage("Generation failed: OOM");

      let buffer = Buffer.concat([chunk1, errorMsg]);
      const messages: StreamMessage[] = [];

      while (buffer.length > 0) {
        const result = parseMessage(buffer);
        if (result === null) break;
        messages.push(result.message);
        buffer = result.remaining;
      }

      expect(messages.length).toBe(2);
      expect(messages[0]!.type).toBe("chunk");
      expect(messages[1]!.type).toBe("error");

      if (messages[1]!.type === "error") {
        expect(messages[1]!.message).toBe("Generation failed: OOM");
      }
    });

    test("handles incremental buffer accumulation", () => {
      // Simulate receiving data in fragments
      const fullMessage = buildChunkMessage(0, new Float32Array([0.1, 0.2, 0.3]), 24000);
      
      let buffer = Buffer.alloc(0);
      const messages: StreamMessage[] = [];

      // Fragment 1: partial header
      buffer = Buffer.concat([buffer, fullMessage.subarray(0, 8)]);
      let result = parseMessage(buffer);
      expect(result).toBeNull(); // Not enough data

      // Fragment 2: rest of header
      buffer = Buffer.concat([buffer, fullMessage.subarray(8, 16)]);
      result = parseMessage(buffer);
      expect(result).toBeNull(); // Have header but no samples

      // Fragment 3: partial samples
      buffer = Buffer.concat([buffer, fullMessage.subarray(16, 24)]);
      result = parseMessage(buffer);
      expect(result).toBeNull(); // Still not complete

      // Fragment 4: rest of samples
      buffer = Buffer.concat([buffer, fullMessage.subarray(24)]);
      result = parseMessage(buffer);
      expect(result).not.toBeNull();
      expect(result!.message.type).toBe("chunk");
    });
  });

  describe("sample data handling", () => {
    test("preserves sample precision through parse", () => {
      const testValues = [
        0.0,
        1.0,
        -1.0,
        0.5,
        -0.5,
        0.123456789,
        -0.987654321,
        1e-10,
        -1e-10,
      ];
      const samples = new Float32Array(testValues);
      const message = buildChunkMessage(0, samples, 24000);
      
      const result = parseMessage(message);
      expect(result).not.toBeNull();
      
      if (result!.message.type === "chunk") {
        for (let i = 0; i < testValues.length; i++) {
          // Float32 has ~7 decimal digits of precision
          expect(result!.message.samples[i]).toBeCloseTo(testValues[i]!, 5);
        }
      }
    });

    test("handles maximum sample values", () => {
      const samples = new Float32Array([
        3.4028235e38,  // Near max float32
        -3.4028235e38, // Near min float32
        1.17549435e-38, // Near smallest positive
      ]);
      const message = buildChunkMessage(0, samples, 24000);
      
      const result = parseMessage(message);
      expect(result).not.toBeNull();
      
      if (result!.message.type === "chunk") {
        expect(result!.message.samples.length).toBe(3);
        expect(Math.abs(result!.message.samples[0]!)).toBeGreaterThan(1e30);
      }
    });

    test("handles realistic audio data", () => {
      // Generate 1 second of 440Hz sine wave at 24kHz
      const sampleRate = 24000;
      const frequency = 440;
      const duration = 1.0;
      const numSamples = Math.floor(sampleRate * duration);
      
      const samples = new Float32Array(numSamples);
      for (let i = 0; i < numSamples; i++) {
        samples[i] = Math.sin(2 * Math.PI * frequency * i / sampleRate) * 0.8;
      }

      const message = buildChunkMessage(0, samples, sampleRate);
      const result = parseMessage(message);

      expect(result).not.toBeNull();
      if (result!.message.type === "chunk") {
        expect(result!.message.samples.length).toBe(numSamples);
        expect(result!.message.sampleRate).toBe(sampleRate);
        
        // Verify a few sample values
        expect(result!.message.samples[0]).toBeCloseTo(0, 5); // sin(0) = 0
        // At 1/4 period: sin(π/2) = 1
        const quarterPeriod = Math.floor(sampleRate / frequency / 4);
        expect(result!.message.samples[quarterPeriod]).toBeCloseTo(0.8, 2);
      }
    });
  });

  describe("error handling", () => {
    test("rejects corrupted magic bytes", () => {
      const message = buildChunkMessage(0, new Float32Array([0.1]), 24000);
      // Corrupt the magic
      message[0] = 0x00;
      message[1] = 0x00;

      expect(() => parseMessage(message)).toThrow("Invalid protocol magic");
    });

    test("handles zero-length chunk gracefully", () => {
      const message = buildChunkMessage(0, new Float32Array([]), 24000);
      const result = parseMessage(message);

      expect(result).not.toBeNull();
      if (result!.message.type === "chunk") {
        expect(result!.message.samples.length).toBe(0);
      }
    });

    test("handles empty error message", () => {
      const message = buildErrorMessage("");
      const result = parseMessage(message);

      expect(result).not.toBeNull();
      if (result!.message.type === "error") {
        expect(result!.message.message).toBe("");
      }
    });
  });

  describe("different sample rates", () => {
    test("preserves 24kHz sample rate", () => {
      const message = buildChunkMessage(0, new Float32Array([0.1]), 24000);
      const result = parseMessage(message);
      
      if (result!.message.type === "chunk") {
        expect(result!.message.sampleRate).toBe(24000);
      }
    });

    test("preserves 44.1kHz sample rate", () => {
      const message = buildChunkMessage(0, new Float32Array([0.1]), 44100);
      const result = parseMessage(message);
      
      if (result!.message.type === "chunk") {
        expect(result!.message.sampleRate).toBe(44100);
      }
    });

    test("preserves 48kHz sample rate", () => {
      const message = buildChunkMessage(0, new Float32Array([0.1]), 48000);
      const result = parseMessage(message);
      
      if (result!.message.type === "chunk") {
        expect(result!.message.sampleRate).toBe(48000);
      }
    });
  });
});
