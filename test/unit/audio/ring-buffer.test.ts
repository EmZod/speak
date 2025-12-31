import { describe, it, expect } from "bun:test";
import { RingBuffer } from "../../../src/audio/ring-buffer.ts";

describe("RingBuffer", () => {
  it("reports correct initial state", () => {
    const buffer = new RingBuffer(1, 100); // 1 second at 100Hz = 100 samples

    expect(buffer.capacity).toBe(100);
    expect(buffer.availableRead).toBe(0);
    expect(buffer.availableWrite).toBe(100);
    expect(buffer.isEmpty).toBe(true);
    expect(buffer.isFull).toBe(false);
  });

  it("writes and reads samples correctly", () => {
    const buffer = new RingBuffer(1, 100);
    const input = new Float32Array([1, 2, 3, 4, 5]);

    const written = buffer.write(input);
    expect(written).toBe(5);
    expect(buffer.availableRead).toBe(5);

    const output = new Float32Array(5);
    const read = buffer.read(output);

    expect(read).toBe(5);
    expect(Array.from(output)).toEqual([1, 2, 3, 4, 5]);
    expect(buffer.isEmpty).toBe(true);
  });

  it("handles wrap-around correctly", () => {
    const buffer = new RingBuffer(0.05, 100); // 5 samples capacity

    // Write 3 samples
    buffer.write(new Float32Array([1, 2, 3]));

    // Read 2 samples
    const out1 = new Float32Array(2);
    buffer.read(out1);
    expect(Array.from(out1)).toEqual([1, 2]);

    // Write 4 more samples (wraps around)
    buffer.write(new Float32Array([4, 5, 6, 7]));

    // Read all 5 samples
    const out2 = new Float32Array(5);
    const read = buffer.read(out2);

    expect(read).toBe(5);
    expect(Array.from(out2)).toEqual([3, 4, 5, 6, 7]);
  });

  it("fills with silence on underrun", () => {
    const buffer = new RingBuffer(1, 100);
    buffer.write(new Float32Array([1, 2]));

    const output = new Float32Array(5);
    const read = buffer.read(output);

    expect(read).toBe(2);
    expect(Array.from(output)).toEqual([1, 2, 0, 0, 0]);
    expect(buffer.underrunSamples).toBe(3);
  });

  it("respects capacity limit", () => {
    const buffer = new RingBuffer(0.05, 100); // 5 samples
    const input = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]);

    const written = buffer.write(input);

    expect(written).toBe(5);
    expect(buffer.isFull).toBe(true);
  });

  it("calculates buffered seconds correctly", () => {
    const buffer = new RingBuffer(10, 24000); // 10 seconds at 24kHz
    buffer.write(new Float32Array(48000)); // 2 seconds worth

    expect(buffer.bufferedSeconds).toBeCloseTo(2.0, 5);
  });

  it("clears buffer correctly", () => {
    const buffer = new RingBuffer(1, 100);
    buffer.write(new Float32Array([1, 2, 3, 4, 5]));

    // Force some underruns
    const out = new Float32Array(10);
    buffer.read(out);

    expect(buffer.underrunSamples).toBe(5);

    buffer.clear();

    expect(buffer.isEmpty).toBe(true);
    expect(buffer.availableRead).toBe(0);
    expect(buffer.underrunSamples).toBe(0);
  });

  it("returns stats correctly", () => {
    const buffer = new RingBuffer(1, 100);
    buffer.write(new Float32Array(50));

    const stats = buffer.getStats();

    expect(stats.capacity_samples).toBe(100);
    expect(stats.capacity_seconds).toBe(1);
    expect(stats.available_read_samples).toBe(50);
    expect(stats.available_read_seconds).toBe(0.5);
    expect(stats.available_write_samples).toBe(50);
    expect(stats.underrun_samples).toBe(0);
  });
});
