/**
 * Unit tests for binary protocol message building and parsing.
 */

import { describe, test, expect } from "bun:test";
import {
  parseMessage,
  buildChunkMessage,
  buildEndMessage,
  buildErrorMessage,
} from "../../../src/bridge/binary-reader.ts";

describe("binary-protocol", () => {
  describe("buildChunkMessage", () => {
    test("builds valid chunk message with correct header", () => {
      const samples = new Float32Array([0.5, -0.5, 0.25, -0.25]);
      const message = buildChunkMessage(0, samples, 24000);

      // Header: magic(4) + id(4) + count(4) + rate(4) = 16 bytes
      // Payload: 4 samples * 4 bytes = 16 bytes
      expect(message.length).toBe(32);

      // Check magic
      expect(message.toString("ascii", 0, 4)).toBe("SPKR");

      // Check id
      expect(message.readUInt32LE(4)).toBe(0);

      // Check sample count
      expect(message.readUInt32LE(8)).toBe(4);

      // Check sample rate
      expect(message.readUInt32LE(12)).toBe(24000);
    });

    test("builds chunk with correct sample data", () => {
      const samples = new Float32Array([1.0, -1.0, 0.0]);
      const message = buildChunkMessage(5, samples, 44100);

      // Parse samples back
      const sample0 = message.readFloatLE(16);
      const sample1 = message.readFloatLE(20);
      const sample2 = message.readFloatLE(24);

      expect(sample0).toBeCloseTo(1.0, 5);
      expect(sample1).toBeCloseTo(-1.0, 5);
      expect(sample2).toBeCloseTo(0.0, 5);
    });

    test("handles empty samples array", () => {
      const samples = new Float32Array([]);
      const message = buildChunkMessage(0, samples, 24000);

      expect(message.length).toBe(16); // Header only
      expect(message.readUInt32LE(8)).toBe(0); // Count = 0
    });

    test("handles large chunk id", () => {
      const samples = new Float32Array([0.1]);
      const message = buildChunkMessage(999999, samples, 24000);

      expect(message.readUInt32LE(4)).toBe(999999);
    });
  });

  describe("buildEndMessage", () => {
    test("builds valid end message", () => {
      const message = buildEndMessage(10);

      expect(message.length).toBe(16);
      expect(message.toString("ascii", 0, 4)).toBe("SPKR");
      expect(message.readUInt32LE(4)).toBe(0xffffffff); // End marker
      expect(message.readUInt32LE(8)).toBe(10); // Total chunks
      expect(message.readUInt32LE(12)).toBe(0); // Unused
    });

    test("handles zero total chunks", () => {
      const message = buildEndMessage(0);

      expect(message.readUInt32LE(8)).toBe(0);
    });
  });

  describe("buildErrorMessage", () => {
    test("builds valid error message", () => {
      const message = buildErrorMessage("Something went wrong");

      expect(message.toString("ascii", 0, 4)).toBe("SPKR");
      expect(message.readUInt32LE(4)).toBe(0xfffffffe); // Error marker
      expect(message.readUInt32LE(8)).toBe(20); // Message length
      expect(message.readUInt32LE(12)).toBe(0); // Unused

      const errorText = message.toString("utf-8", 16);
      expect(errorText).toBe("Something went wrong");
    });

    test("handles empty error message", () => {
      const message = buildErrorMessage("");

      expect(message.length).toBe(16); // Header only
      expect(message.readUInt32LE(8)).toBe(0); // Length = 0
    });

    test("handles unicode in error message", () => {
      const message = buildErrorMessage("Error: 日本語テスト");

      const msgLen = message.readUInt32LE(8);
      const errorText = message.toString("utf-8", 16, 16 + msgLen);
      expect(errorText).toBe("Error: 日本語テスト");
    });
  });

  describe("parseMessage", () => {
    test("parses chunk message correctly", () => {
      const samples = new Float32Array([0.1, 0.2, 0.3]);
      const buffer = buildChunkMessage(7, samples, 24000);

      const result = parseMessage(buffer);
      expect(result).not.toBeNull();
      expect(result!.message.type).toBe("chunk");

      if (result!.message.type === "chunk") {
        expect(result!.message.id).toBe(7);
        expect(result!.message.sampleRate).toBe(24000);
        expect(result!.message.samples.length).toBe(3);
        expect(result!.message.samples[0]).toBeCloseTo(0.1, 5);
        expect(result!.message.samples[1]).toBeCloseTo(0.2, 5);
        expect(result!.message.samples[2]).toBeCloseTo(0.3, 5);
      }
    });

    test("parses end message correctly", () => {
      const buffer = buildEndMessage(42);

      const result = parseMessage(buffer);
      expect(result).not.toBeNull();
      expect(result!.message.type).toBe("end");

      if (result!.message.type === "end") {
        expect(result!.message.totalChunks).toBe(42);
      }
    });

    test("parses error message correctly", () => {
      const buffer = buildErrorMessage("Test error");

      const result = parseMessage(buffer);
      expect(result).not.toBeNull();
      expect(result!.message.type).toBe("error");

      if (result!.message.type === "error") {
        expect(result!.message.message).toBe("Test error");
      }
    });

    test("returns null for incomplete header", () => {
      const buffer = Buffer.from("SPK"); // Only 3 bytes

      const result = parseMessage(buffer);
      expect(result).toBeNull();
    });

    test("returns null for incomplete chunk payload", () => {
      const samples = new Float32Array([0.1, 0.2, 0.3]);
      const fullBuffer = buildChunkMessage(0, samples, 24000);
      const incompleteBuffer = fullBuffer.subarray(0, 20); // Missing some samples

      const result = parseMessage(incompleteBuffer);
      expect(result).toBeNull();
    });

    test("throws on invalid magic", () => {
      const buffer = Buffer.alloc(16);
      buffer.write("XXXX", 0, "ascii"); // Wrong magic

      expect(() => parseMessage(buffer)).toThrow("Invalid protocol magic");
    });

    test("returns remaining buffer after parsing", () => {
      const chunk1 = buildChunkMessage(0, new Float32Array([0.1]), 24000);
      const chunk2 = buildChunkMessage(1, new Float32Array([0.2]), 24000);
      const combined = Buffer.concat([chunk1, chunk2]);

      const result = parseMessage(combined);
      expect(result).not.toBeNull();
      expect(result!.remaining.length).toBe(chunk2.length);

      // Parse the remaining buffer
      const result2 = parseMessage(result!.remaining);
      expect(result2).not.toBeNull();
      expect(result2!.message.type).toBe("chunk");
      if (result2!.message.type === "chunk") {
        expect(result2!.message.id).toBe(1);
      }
    });
  });

  describe("round-trip encoding/decoding", () => {
    test("chunk survives round-trip", () => {
      const originalSamples = new Float32Array(1000);
      for (let i = 0; i < 1000; i++) {
        originalSamples[i] = Math.sin(i * 0.1) * 0.5;
      }

      const encoded = buildChunkMessage(123, originalSamples, 48000);
      const decoded = parseMessage(encoded);

      expect(decoded).not.toBeNull();
      expect(decoded!.message.type).toBe("chunk");

      if (decoded!.message.type === "chunk") {
        expect(decoded!.message.id).toBe(123);
        expect(decoded!.message.sampleRate).toBe(48000);
        expect(decoded!.message.samples.length).toBe(1000);

        for (let i = 0; i < 1000; i++) {
          expect(decoded!.message.samples[i]).toBeCloseTo(originalSamples[i]!, 5);
        }
      }
    });

    test("end message survives round-trip", () => {
      const encoded = buildEndMessage(999);
      const decoded = parseMessage(encoded);

      expect(decoded).not.toBeNull();
      expect(decoded!.message.type).toBe("end");
      if (decoded!.message.type === "end") {
        expect(decoded!.message.totalChunks).toBe(999);
      }
    });

    test("error message survives round-trip", () => {
      const errorMsg = "Connection failed: timeout after 30s";
      const encoded = buildErrorMessage(errorMsg);
      const decoded = parseMessage(encoded);

      expect(decoded).not.toBeNull();
      expect(decoded!.message.type).toBe("error");
      if (decoded!.message.type === "error") {
        expect(decoded!.message.message).toBe(errorMsg);
      }
    });
  });
});
