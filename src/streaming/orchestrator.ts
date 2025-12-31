/**
 * Stream Orchestrator - coordinates streaming TTS generation and playback.
 *
 * Coordinates:
 * - Binary protocol reader (from Python)
 * - Ring buffer and audio player
 * - State machine for playback control
 * - Progress reporting and cancellation
 *
 * NO FILE I/O - samples come directly over socket via binary protocol.
 */

import { Socket, connect } from "net";
import { StreamPlayer } from "../audio/stream-player.ts";
import {
  StreamStateMachine,
  StreamState,
  DEFAULT_STREAM_CONFIG,
} from "./state-machine.ts";
import type { StreamConfig } from "./state-machine.ts";
import { readBinaryStream } from "../bridge/binary-reader.ts";
import type { StreamMessage } from "../bridge/binary-reader.ts";
import { checkKillswitch } from "../core/killswitch.ts";
import { logger, logDecision } from "../ui/logger.ts";
import { SOCKET_PATH } from "../core/config.ts";

export interface StreamOptions {
  text: string;
  model?: string;
  temperature?: number;
  speed?: number;
  voice?: string;
  onProgress?: (progress: StreamProgress) => void;
}

export interface StreamProgress {
  state: StreamState;
  chunksReceived: number;
  bufferedSeconds: number;
  totalSamplesReceived: number;
}

export interface StreamResult {
  success: boolean;
  totalChunks: number;
  totalSamples: number;
  totalDurationSeconds: number;
  underrunCount: number;
  rebufferCount: number;
  finalState: StreamState;
  error?: string;
}

/**
 * Orchestrates streaming TTS generation and playback.
 *
 * Coordinates:
 * - Binary protocol reader (from Python server)
 * - Ring buffer and audio player
 * - State machine for playback control
 * - Progress reporting and cancellation
 */
export class StreamOrchestrator {
  private player: StreamPlayer;
  private stateMachine: StreamStateMachine;
  private socket: Socket | null = null;
  private aborted = false;
  private rebufferCount = 0;
  private chunksReceived = 0;
  private totalSamples = 0;

  constructor(
    private readonly sampleRate: number = 24000,
    private readonly config: StreamConfig = DEFAULT_STREAM_CONFIG
  ) {
    this.player = new StreamPlayer({ sampleRate });
    this.stateMachine = new StreamStateMachine(config);

    // Wire up state machine to player
    this.stateMachine.onStateChange((state, prev) => {
      this.handleStateChange(state, prev);
    });
  }

  /**
   * Stream audio for the given text.
   */
  async stream(options: StreamOptions): Promise<StreamResult> {
    const { text, onProgress } = options;

    // Check killswitch at entry
    checkKillswitch("stream");

    logDecision("Starting stream orchestration", "User requested streaming playback", {
      text_length: text.length,
      config: this.config,
    });

    try {
      // Connect to Python server
      this.socket = await this.connectToServer();

      // Send stream request (binary protocol method)
      await this.sendStreamRequest(this.socket, options);

      // Start state machine
      this.stateMachine.dispatch({ type: "START" }, { bufferedSeconds: 0 });

      // Use producer-consumer pattern to read from socket while processing chunks
      // This prevents socket blocking while we wait for buffer to drain
      const chunkQueue: Array<{ id: number; samples: Float32Array; sampleRate: number }> = [];
      let streamEnded = false;
      let streamError: Error | null = null;
      let readerDone = false;

      // Producer: Read all chunks from socket into queue
      const readPromise = (async () => {
        try {
          for await (const message of readBinaryStream(this.socket)) {
            if (this.aborted) {
              break;
            }

            if (message.type === "chunk") {
              chunkQueue.push(message);
            } else if (message.type === "end") {
              streamEnded = true;
              break;
            } else if (message.type === "error") {
              streamError = new Error(message.message);
              break;
            }
          }
        } finally {
          readerDone = true;
        }
      })();

      // Consumer: Process chunks from queue as they arrive
      let totalChunks = 0;
      while (!readerDone || chunkQueue.length > 0) {
        if (this.aborted) {
          break;
        }

        if (chunkQueue.length > 0) {
          const chunk = chunkQueue.shift()!;
          await this.handleChunk(chunk);
          totalChunks++;

          // Report progress
          if (onProgress) {
            onProgress({
              state: this.stateMachine.state,
              chunksReceived: this.chunksReceived,
              bufferedSeconds: this.player.bufferedSeconds,
              totalSamplesReceived: this.totalSamples,
            });
          }
        } else {
          // Queue empty, wait a bit for more data
          await this.sleep(10);
        }
      }

      // Wait for reader to finish
      await readPromise;

      if (streamError) {
        throw streamError;
      }

      // Signal generation complete
      if (streamEnded) {
        this.stateMachine.dispatch(
          { type: "GENERATION_COMPLETE", totalChunks },
          { bufferedSeconds: this.player.bufferedSeconds }
        );
      }

      // Wait for playback to finish
      if (this.player.isPlaying) {
        await this.player.waitForFinish();
      }

      // Dispatch BUFFER_EMPTY to transition state machine to FINISHED
      if (this.stateMachine.state === StreamState.DRAINING) {
        this.stateMachine.dispatch(
          { type: "BUFFER_EMPTY" },
          { bufferedSeconds: 0 }
        );
      }

      return this.buildResult();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      logDecision("Stream orchestration failed", errorMessage, {
        chunks_received: this.chunksReceived,
      });

      this.stateMachine.dispatch(
        { type: "GENERATION_ERROR", error: error as Error },
        { bufferedSeconds: this.player.bufferedSeconds }
      );

      return {
        ...this.buildResult(),
        success: false,
        error: errorMessage,
      };
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Cancel streaming playback.
   */
  cancel(reason: string = "User cancelled"): void {
    logDecision("Cancelling stream", reason, {
      current_state: this.stateMachine.state,
      chunks_received: this.chunksReceived,
    });

    this.aborted = true;
    this.stateMachine.dispatch(
      { type: "CANCEL", reason },
      { bufferedSeconds: this.player.bufferedSeconds }
    );
  }

  private async connectToServer(): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = connect({ path: SOCKET_PATH });

      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error("Connection timeout"));
      }, 5000);

      socket.once("connect", () => {
        clearTimeout(timeout);
        resolve(socket);
      });

      socket.once("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  private async sendStreamRequest(socket: Socket, options: StreamOptions): Promise<void> {
    // Request binary streaming via stream-binary method
    const request = {
      id: `stream-${Date.now()}`,
      method: "stream-binary",
      params: {
        text: options.text,
        model: options.model,
        temperature: options.temperature,
        speed: options.speed,
        voice: options.voice,
      },
    };

    return new Promise((resolve, reject) => {
      socket.write(JSON.stringify(request) + "\n", (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private async handleMessage(message: StreamMessage): Promise<void> {
    switch (message.type) {
      case "chunk":
        await this.handleChunk(message);
        break;

      case "end":
        this.stateMachine.dispatch(
          { type: "GENERATION_COMPLETE", totalChunks: message.totalChunks },
          { bufferedSeconds: this.player.bufferedSeconds }
        );
        break;

      case "error":
        this.stateMachine.dispatch(
          { type: "GENERATION_ERROR", error: new Error(message.message) },
          { bufferedSeconds: this.player.bufferedSeconds }
        );
        break;
    }
  }

  private async handleChunk(chunk: {
    id: number;
    samples: Float32Array;
    sampleRate: number;
  }): Promise<void> {
    // Write samples to buffer with backpressure
    let written = 0;
    while (written < chunk.samples.length && !this.aborted) {
      const remaining = chunk.samples.subarray(written);
      const count = this.player.write(remaining);
      written += count;

      // Check if we should start playback (buffer reached threshold)
      // This prevents deadlock when chunk is larger than buffer
      if (
        this.stateMachine.state === StreamState.BUFFERING &&
        this.player.bufferedSeconds >= this.config.initialBufferSeconds
      ) {
        this.stateMachine.dispatch(
          { type: "CHUNK_RECEIVED", samples: written, chunkId: chunk.id },
          { bufferedSeconds: this.player.bufferedSeconds }
        );
      }

      if (count < remaining.length) {
        // Buffer full - wait a bit for playback to consume
        await this.sleep(10);
      }
    }

    this.chunksReceived++;
    this.totalSamples += chunk.samples.length;

    // Dispatch chunk received event (for state transitions and tracking)
    this.stateMachine.dispatch(
      { type: "CHUNK_RECEIVED", samples: chunk.samples.length, chunkId: chunk.id },
      { bufferedSeconds: this.player.bufferedSeconds }
    );

    // Check for buffer low condition while playing
    if (this.stateMachine.state === StreamState.PLAYING) {
      if (this.player.bufferedSeconds < this.config.minBufferSeconds) {
        this.stateMachine.dispatch(
          { type: "BUFFER_LOW", bufferedSeconds: this.player.bufferedSeconds },
          { bufferedSeconds: this.player.bufferedSeconds }
        );
      }
    }
  }

  private handleStateChange(state: StreamState, prev: StreamState): void {
    switch (state) {
      case StreamState.PLAYING:
        if (prev === StreamState.BUFFERING || prev === StreamState.REBUFFERING) {
          if (!this.player.isPlaying) {
            this.player.start();
          }
        }
        break;

      case StreamState.REBUFFERING:
        this.rebufferCount++;
        // Player continues playing (with potential underruns)
        // We just wait for more data
        break;

      case StreamState.DRAINING:
        // For short text: BUFFERING → DRAINING directly, need to start player first
        if (prev === StreamState.BUFFERING && !this.player.isPlaying) {
          this.player.start();
        }
        this.player.startDraining();
        break;

      case StreamState.FINISHED:
      case StreamState.ERROR:
        // Terminal states - cleanup handled in stream()
        break;
    }
  }

  private buildResult(): StreamResult {
    return {
      success: this.stateMachine.state === StreamState.FINISHED,
      totalChunks: this.chunksReceived,
      totalSamples: this.totalSamples,
      totalDurationSeconds: this.totalSamples / this.sampleRate,
      underrunCount: this.player.underrunSamples,
      rebufferCount: this.rebufferCount,
      finalState: this.stateMachine.state,
    };
  }

  private async cleanup(): Promise<void> {
    if (this.player.isPlaying) {
      await this.player.stop();
    }

    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
