/**
 * State machine for streaming audio playback.
 *
 * Coordinates buffering, playback, and error handling with explicit state transitions.
 * Every transition is logged with full context for debugging.
 */

import { logDecision } from "../ui/logger.ts";

/**
 * Streaming states
 */
export enum StreamState {
  /** Initial state, waiting to start */
  IDLE = "IDLE",

  /** Accumulating initial buffer before playback */
  BUFFERING = "BUFFERING",

  /** Actively playing audio */
  PLAYING = "PLAYING",

  /** Paused playback due to low buffer, waiting for more data */
  REBUFFERING = "REBUFFERING",

  /** Generation complete, playing remaining buffer */
  DRAINING = "DRAINING",

  /** Playback complete */
  FINISHED = "FINISHED",

  /** Error occurred */
  ERROR = "ERROR",
}

/**
 * Events that trigger state transitions
 */
export type StreamEvent =
  | { type: "START" }
  | { type: "CHUNK_RECEIVED"; samples: number; chunkId: number }
  | { type: "GENERATION_COMPLETE"; totalChunks: number }
  | { type: "GENERATION_ERROR"; error: Error }
  | { type: "BUFFER_LOW"; bufferedSeconds: number }
  | { type: "BUFFER_OK"; bufferedSeconds: number }
  | { type: "BUFFER_EMPTY" }
  | { type: "CANCEL"; reason: string };

/**
 * Configuration for buffer thresholds
 */
export interface StreamConfig {
  /** Seconds of audio to buffer before starting playback */
  initialBufferSeconds: number;

  /** Pause playback if buffer drops below this */
  minBufferSeconds: number;

  /** Resume playback when buffer reaches this level */
  resumeBufferSeconds: number;
}

export const DEFAULT_STREAM_CONFIG: StreamConfig = {
  initialBufferSeconds: 3.0,
  minBufferSeconds: 1.0,
  resumeBufferSeconds: 2.0,
};

/**
 * State change listener type
 */
export type StateChangeListener = (
  state: StreamState,
  prev: StreamState,
  event: StreamEvent
) => void;

/**
 * State machine for streaming audio playback.
 *
 * Guarantees:
 * - Every state transition is logged with context
 * - Invalid transitions are logged as errors but don't throw
 * - Terminal states (FINISHED, ERROR) cannot transition
 */
export class StreamStateMachine {
  private _state: StreamState = StreamState.IDLE;
  private readonly listeners = new Set<StateChangeListener>();
  private transitionCount = 0;

  constructor(private readonly config: StreamConfig = DEFAULT_STREAM_CONFIG) {}

  get state(): StreamState {
    return this._state;
  }

  get transitions(): number {
    return this.transitionCount;
  }

  /**
   * Subscribe to state changes.
   * Returns unsubscribe function.
   */
  onStateChange(fn: StateChangeListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * Dispatch an event and potentially transition state
   */
  dispatch(event: StreamEvent, context: { bufferedSeconds: number }): StreamState {
    const { bufferedSeconds } = context;
    const prevState = this._state;

    // Determine new state based on current state and event
    const newState = this.computeNextState(event, bufferedSeconds);

    // Log the event regardless of whether it caused a transition
    if (newState !== prevState) {
      this.transition(newState, event, bufferedSeconds);
    }

    return this._state;
  }

  private computeNextState(event: StreamEvent, bufferedSeconds: number): StreamState {
    switch (this._state) {
      case StreamState.IDLE:
        if (event.type === "START") {
          return StreamState.BUFFERING;
        }
        break;

      case StreamState.BUFFERING:
        if (event.type === "CHUNK_RECEIVED") {
          if (bufferedSeconds >= this.config.initialBufferSeconds) {
            return StreamState.PLAYING;
          }
        } else if (event.type === "GENERATION_COMPLETE") {
          // Short text - didn't reach buffer threshold, play what we have
          return StreamState.DRAINING;
        } else if (event.type === "GENERATION_ERROR") {
          return StreamState.ERROR;
        } else if (event.type === "CANCEL") {
          return StreamState.FINISHED;
        }
        break;

      case StreamState.PLAYING:
        if (event.type === "BUFFER_LOW") {
          if (bufferedSeconds < this.config.minBufferSeconds) {
            return StreamState.REBUFFERING;
          }
        } else if (event.type === "GENERATION_COMPLETE") {
          return StreamState.DRAINING;
        } else if (event.type === "GENERATION_ERROR") {
          // Keep playing what we have
          return StreamState.DRAINING;
        } else if (event.type === "CANCEL") {
          return StreamState.FINISHED;
        }
        break;

      case StreamState.REBUFFERING:
        if (event.type === "CHUNK_RECEIVED" || event.type === "BUFFER_OK") {
          if (bufferedSeconds >= this.config.resumeBufferSeconds) {
            return StreamState.PLAYING;
          }
        } else if (event.type === "GENERATION_COMPLETE") {
          // Can't get more data, play what we have
          return StreamState.DRAINING;
        } else if (event.type === "GENERATION_ERROR") {
          return StreamState.DRAINING;
        } else if (event.type === "CANCEL") {
          return StreamState.FINISHED;
        }
        break;

      case StreamState.DRAINING:
        if (event.type === "BUFFER_EMPTY") {
          return StreamState.FINISHED;
        } else if (event.type === "CANCEL") {
          return StreamState.FINISHED;
        }
        break;

      // Terminal states - no transitions
      case StreamState.FINISHED:
      case StreamState.ERROR:
        break;
    }

    return this._state; // No transition
  }

  private transition(
    newState: StreamState,
    event: StreamEvent,
    bufferedSeconds: number
  ): void {
    const prevState = this._state;
    this._state = newState;
    this.transitionCount++;

    // Log every transition with full context
    logDecision(`State transition: ${prevState} → ${newState}`, `Event: ${event.type}`, {
      transition_number: this.transitionCount,
      from_state: prevState,
      to_state: newState,
      event_type: event.type,
      event_details: event,
      buffered_seconds: bufferedSeconds,
      config: this.config,
    });

    // Notify listeners
    this.listeners.forEach((fn) => fn(newState, prevState, event));
  }

  /**
   * Check if current state is terminal
   */
  isTerminal(): boolean {
    return this._state === StreamState.FINISHED || this._state === StreamState.ERROR;
  }

  /**
   * Get state machine statistics for logging
   */
  getStats(): Record<string, unknown> {
    return {
      current_state: this._state,
      transition_count: this.transitionCount,
      is_terminal: this.isTerminal(),
      config: this.config,
    };
  }
}
