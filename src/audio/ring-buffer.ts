/**
 * Lock-free single-producer single-consumer ring buffer for audio samples.
 *
 * Design decisions:
 * - Fixed size (avoids allocation during playback)
 * - Float32 samples (matches mlx-audio output)
 * - Fills with silence on underrun (graceful degradation)
 * - Reports underruns for observability
 */
export class RingBuffer {
  private buffer: Float32Array;
  private writePos = 0;
  private readPos = 0;
  private _underrunSamples = 0;

  constructor(
    public readonly durationSeconds: number,
    public readonly sampleRate: number = 24000
  ) {
    // +1 sample to distinguish full from empty
    const capacity = Math.ceil(durationSeconds * sampleRate);
    this.buffer = new Float32Array(capacity + 1);
  }

  /**
   * Number of samples available to read
   */
  get availableRead(): number {
    const write = this.writePos;
    const read = this.readPos;

    if (write >= read) {
      return write - read;
    }
    return this.buffer.length - read + write;
  }

  /**
   * Number of samples that can be written
   */
  get availableWrite(): number {
    return this.capacity - this.availableRead;
  }

  /**
   * Total capacity in samples
   */
  get capacity(): number {
    return this.buffer.length - 1;
  }

  /**
   * Buffered audio duration in seconds
   */
  get bufferedSeconds(): number {
    return this.availableRead / this.sampleRate;
  }

  /**
   * Total samples lost to underrun (silence inserted)
   */
  get underrunSamples(): number {
    return this._underrunSamples;
  }

  /**
   * Whether buffer is completely full
   */
  get isFull(): boolean {
    return this.availableWrite === 0;
  }

  /**
   * Whether buffer is completely empty
   */
  get isEmpty(): boolean {
    return this.availableRead === 0;
  }

  /**
   * Write samples to buffer.
   * Returns number of samples actually written (may be less than input if full).
   */
  write(samples: Float32Array): number {
    const toWrite = Math.min(samples.length, this.availableWrite);

    for (let i = 0; i < toWrite; i++) {
      this.buffer[this.writePos] = samples[i]!;
      this.writePos = (this.writePos + 1) % this.buffer.length;
    }

    return toWrite;
  }

  /**
   * Read samples from buffer into output array.
   * Returns number of samples actually read.
   * Fills remainder with silence if buffer underruns.
   */
  read(output: Float32Array): number {
    const toRead = Math.min(output.length, this.availableRead);

    // Read available samples
    for (let i = 0; i < toRead; i++) {
      output[i] = this.buffer[this.readPos]!;
      this.readPos = (this.readPos + 1) % this.buffer.length;
    }

    // Fill remainder with silence (underrun)
    const silenceSamples = output.length - toRead;
    if (silenceSamples > 0) {
      for (let i = toRead; i < output.length; i++) {
        output[i] = 0;
      }
      this._underrunSamples += silenceSamples;
    }

    return toRead;
  }

  /**
   * Clear all data from buffer
   */
  clear(): void {
    this.writePos = 0;
    this.readPos = 0;
    this._underrunSamples = 0;
  }

  /**
   * Get buffer statistics for logging
   */
  getStats(): Record<string, number> {
    return {
      capacity_samples: this.capacity,
      capacity_seconds: this.capacity / this.sampleRate,
      available_read_samples: this.availableRead,
      available_read_seconds: this.bufferedSeconds,
      available_write_samples: this.availableWrite,
      underrun_samples: this._underrunSamples,
      underrun_seconds: this._underrunSamples / this.sampleRate,
    };
  }
}
