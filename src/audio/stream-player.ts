/**
 * Streaming audio player using node-speaker.
 *
 * Design decisions:
 * - Pull-based: Audio system requests samples when needed
 * - Ring buffer: Decouples generation from playback
 * - Graceful underrun: Inserts silence instead of crashing
 * - Observable: Exposes metrics for debugging
 */

import Speaker from "speaker";
import { Readable } from "stream";
import { RingBuffer } from "./ring-buffer.ts";
import { logDecision, logger } from "../ui/logger.ts";

export interface StreamPlayerConfig {
  sampleRate: number;
  bufferDurationSeconds: number;
  chunkSamples: number; // Samples per audio callback
}

export const DEFAULT_PLAYER_CONFIG: StreamPlayerConfig = {
  sampleRate: 24000,
  bufferDurationSeconds: 10,
  chunkSamples: 1024, // ~42ms at 24kHz
};

/**
 * Streaming audio player using node-speaker.
 *
 * Design decisions:
 * - Pull-based: Audio system requests samples when needed
 * - Ring buffer: Decouples generation from playback
 * - Graceful underrun: Inserts silence instead of crashing
 * - Observable: Exposes metrics for debugging
 */
export class StreamPlayer {
  private speaker: Speaker | null = null;
  private readable: Readable | null = null;
  private buffer: RingBuffer;
  private config: StreamPlayerConfig;

  private _playing = false;
  private _draining = false;
  private _finished = false;
  private _totalWritten = 0;
  private _totalPushed = 0;

  constructor(config: Partial<StreamPlayerConfig> = {}) {
    this.config = { ...DEFAULT_PLAYER_CONFIG, ...config };
    this.buffer = new RingBuffer(this.config.bufferDurationSeconds, this.config.sampleRate);
  }

  /**
   * Current buffer level in seconds
   */
  get bufferedSeconds(): number {
    return this.buffer.bufferedSeconds;
  }

  /**
   * Total samples lost to underrun
   */
  get underrunSamples(): number {
    return this.buffer.underrunSamples;
  }

  /**
   * Whether playback is active
   */
  get isPlaying(): boolean {
    return this._playing;
  }

  /**
   * Whether player has finished
   */
  get isFinished(): boolean {
    return this._finished;
  }

  /**
   * Write samples to the buffer.
   * Returns number of samples written (may be less if buffer full).
   */
  write(samples: Float32Array): number {
    const written = this.buffer.write(samples);
    this._totalWritten += written;
    return written;
  }

  /**
   * Start audio playback.
   * Pulls samples from buffer and sends to audio device.
   */
  start(): void {
    if (this._playing) {
      logger.warn("StreamPlayer.start() called while already playing");
      return;
    }

    logDecision("Starting audio playback", "Buffer reached initial threshold", {
      buffered_seconds: this.buffer.bufferedSeconds,
      sample_rate: this.config.sampleRate,
    });

    this.speaker = new Speaker({
      channels: 1,
      bitDepth: 32,
      sampleRate: this.config.sampleRate,
      float: true,
    });

    const chunkSamples = this.config.chunkSamples;
    const chunk = new Float32Array(chunkSamples);

    this.readable = new Readable({
      read: () => {
        // Check if we should stop
        if (!this._playing) {
          this.readable!.push(null);
          return;
        }

        // Read from ring buffer
        const samplesRead = this.buffer.read(chunk);

        // Push the data if we read anything
        if (samplesRead > 0) {
          // MUST copy to new buffer - Buffer.from() creates a view that gets
          // corrupted when we reuse the chunk Float32Array on next read
          const buf = Buffer.alloc(samplesRead * 4);
          for (let i = 0; i < samplesRead; i++) {
            buf.writeFloatLE(chunk[i]!, i * 4);
          }
          this.readable!.push(buf);
          this._totalPushed += samplesRead;
        }

        // Only end the stream when:
        // 1. We're draining (generation complete)
        // 2. Buffer is empty
        // 3. We've pushed all written samples (nothing lost in buffer)
        const allDataPushed = this._totalPushed >= this._totalWritten;
        if (this._draining && this.buffer.isEmpty && allDataPushed) {
          logDecision("Audio playback complete", "All audio data sent to speaker", {
            total_underrun_samples: this.buffer.underrunSamples,
            total_written: this._totalWritten,
            total_pushed: this._totalPushed,
          });
          this.readable!.push(null);
          // Don't set _playing = false here - wait for speaker 'close' event
          // so audio actually plays before we signal completion
        } else if (samplesRead === 0 && !this._draining) {
          // Buffer underrun while still generating - push silence
          const silenceBuf = Buffer.alloc(chunkSamples * 4); // Already zeros
          this.readable!.push(silenceBuf);
        }
      },
    });

    // Handle speaker events
    this.speaker.on("error", (err) => {
      logger.error("Speaker error", { error: err.message });
      this._playing = false;
      this._finished = true;
    });

    // 'flush' fires after audio data has been flushed to speakers
    this.speaker.on("flush", () => {
      logDecision("Speaker flushed", "Audio data flushed to speakers", {});
    });

    // 'close' fires after flush, when backend is closed
    this.speaker.on("close", () => {
      logDecision("Speaker closed", "Audio device released", {});
      this._playing = false;
      this._finished = true;
    });

    // Start the audio pipeline
    this.readable.pipe(this.speaker);
    this._playing = true;
  }

  /**
   * Signal that no more data will be written.
   * Player will finish when buffer is empty.
   */
  startDraining(): void {
    logDecision("Starting audio drain", "Generation complete, playing remaining buffer", {
      remaining_seconds: this.buffer.bufferedSeconds,
    });
    this._draining = true;
  }

  /**
   * Stop playback immediately.
   */
  async stop(): Promise<void> {
    if (!this._playing && !this.speaker) {
      return;
    }

    logDecision("Stopping audio playback", "Stop requested", {
      was_draining: this._draining,
      remaining_seconds: this.buffer.bufferedSeconds,
    });

    this._playing = false;
    this._draining = false;

    return new Promise((resolve) => {
      if (this.speaker) {
        this.speaker.once("close", () => {
          this.speaker = null;
          this.readable = null;
          this._finished = true;
          resolve();
        });
        this.speaker.close();
      } else {
        this._finished = true;
        resolve();
      }
    });
  }

  /**
   * Wait for playback to finish (after draining).
   */
  async waitForFinish(): Promise<void> {
    if (this._finished) return;

    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (this._finished) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 50);
    });
  }

  /**
   * Get player statistics for logging
   */
  getStats(): Record<string, unknown> {
    return {
      playing: this._playing,
      draining: this._draining,
      finished: this._finished,
      buffer: this.buffer.getStats(),
    };
  }
}
