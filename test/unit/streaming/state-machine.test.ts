import { describe, it, expect } from "bun:test";
import {
  StreamStateMachine,
  StreamState,
  DEFAULT_STREAM_CONFIG,
} from "../../../src/streaming/state-machine.ts";

describe("StreamStateMachine", () => {
  it("starts in IDLE state", () => {
    const sm = new StreamStateMachine();
    expect(sm.state).toBe(StreamState.IDLE);
  });

  it("transitions IDLE → BUFFERING on START", () => {
    const sm = new StreamStateMachine();
    sm.dispatch({ type: "START" }, { bufferedSeconds: 0 });
    expect(sm.state).toBe(StreamState.BUFFERING);
  });

  it("transitions BUFFERING → PLAYING when buffer threshold reached", () => {
    const config = { ...DEFAULT_STREAM_CONFIG, initialBufferSeconds: 2.0 };
    const sm = new StreamStateMachine(config);

    sm.dispatch({ type: "START" }, { bufferedSeconds: 0 });

    // Below threshold - stay in BUFFERING
    sm.dispatch({ type: "CHUNK_RECEIVED", samples: 24000, chunkId: 0 }, { bufferedSeconds: 1.0 });
    expect(sm.state).toBe(StreamState.BUFFERING);

    // At threshold - transition to PLAYING
    sm.dispatch({ type: "CHUNK_RECEIVED", samples: 24000, chunkId: 1 }, { bufferedSeconds: 2.0 });
    expect(sm.state).toBe(StreamState.PLAYING);
  });

  it("transitions PLAYING → REBUFFERING when buffer low", () => {
    const config = { ...DEFAULT_STREAM_CONFIG, minBufferSeconds: 1.0 };
    const sm = new StreamStateMachine(config);

    sm.dispatch({ type: "START" }, { bufferedSeconds: 0 });
    sm.dispatch({ type: "CHUNK_RECEIVED", samples: 24000, chunkId: 0 }, { bufferedSeconds: 3.0 });
    expect(sm.state).toBe(StreamState.PLAYING);

    sm.dispatch({ type: "BUFFER_LOW", bufferedSeconds: 0.5 }, { bufferedSeconds: 0.5 });
    expect(sm.state).toBe(StreamState.REBUFFERING);
  });

  it("transitions REBUFFERING → PLAYING when buffer recovered", () => {
    const config = {
      ...DEFAULT_STREAM_CONFIG,
      minBufferSeconds: 1.0,
      resumeBufferSeconds: 2.0,
    };
    const sm = new StreamStateMachine(config);

    // Get to REBUFFERING state
    sm.dispatch({ type: "START" }, { bufferedSeconds: 0 });
    sm.dispatch({ type: "CHUNK_RECEIVED", samples: 24000, chunkId: 0 }, { bufferedSeconds: 3.0 });
    sm.dispatch({ type: "BUFFER_LOW", bufferedSeconds: 0.5 }, { bufferedSeconds: 0.5 });
    expect(sm.state).toBe(StreamState.REBUFFERING);

    // Still below resume threshold
    sm.dispatch({ type: "CHUNK_RECEIVED", samples: 24000, chunkId: 1 }, { bufferedSeconds: 1.5 });
    expect(sm.state).toBe(StreamState.REBUFFERING);

    // At resume threshold
    sm.dispatch({ type: "CHUNK_RECEIVED", samples: 24000, chunkId: 2 }, { bufferedSeconds: 2.0 });
    expect(sm.state).toBe(StreamState.PLAYING);
  });

  it("transitions to DRAINING when generation complete", () => {
    const sm = new StreamStateMachine();

    sm.dispatch({ type: "START" }, { bufferedSeconds: 0 });
    sm.dispatch({ type: "CHUNK_RECEIVED", samples: 24000, chunkId: 0 }, { bufferedSeconds: 3.0 });
    sm.dispatch({ type: "GENERATION_COMPLETE", totalChunks: 1 }, { bufferedSeconds: 3.0 });

    expect(sm.state).toBe(StreamState.DRAINING);
  });

  it("transitions DRAINING → FINISHED when buffer empty", () => {
    const sm = new StreamStateMachine();

    sm.dispatch({ type: "START" }, { bufferedSeconds: 0 });
    sm.dispatch({ type: "CHUNK_RECEIVED", samples: 24000, chunkId: 0 }, { bufferedSeconds: 3.0 });
    sm.dispatch({ type: "GENERATION_COMPLETE", totalChunks: 1 }, { bufferedSeconds: 3.0 });
    sm.dispatch({ type: "BUFFER_EMPTY" }, { bufferedSeconds: 0 });

    expect(sm.state).toBe(StreamState.FINISHED);
    expect(sm.isTerminal()).toBe(true);
  });

  it("handles CANCEL from any state", () => {
    const sm = new StreamStateMachine();

    sm.dispatch({ type: "START" }, { bufferedSeconds: 0 });
    sm.dispatch({ type: "CANCEL", reason: "User pressed Ctrl+C" }, { bufferedSeconds: 0 });

    expect(sm.state).toBe(StreamState.FINISHED);
  });

  it("transitions to ERROR on generation error during buffering", () => {
    const sm = new StreamStateMachine();

    sm.dispatch({ type: "START" }, { bufferedSeconds: 0 });
    sm.dispatch(
      { type: "GENERATION_ERROR", error: new Error("Model OOM") },
      { bufferedSeconds: 0.5 }
    );

    expect(sm.state).toBe(StreamState.ERROR);
    expect(sm.isTerminal()).toBe(true);
  });

  it("transitions to DRAINING on generation error during playing (graceful)", () => {
    const sm = new StreamStateMachine();

    sm.dispatch({ type: "START" }, { bufferedSeconds: 0 });
    sm.dispatch({ type: "CHUNK_RECEIVED", samples: 24000, chunkId: 0 }, { bufferedSeconds: 3.0 });
    expect(sm.state).toBe(StreamState.PLAYING);

    sm.dispatch(
      { type: "GENERATION_ERROR", error: new Error("Model OOM") },
      { bufferedSeconds: 2.0 }
    );

    // Should drain remaining buffer, not error out
    expect(sm.state).toBe(StreamState.DRAINING);
  });

  it("calls listeners on state change", () => {
    const sm = new StreamStateMachine();
    const transitions: [StreamState, StreamState][] = [];

    sm.onStateChange((state, prev) => {
      transitions.push([prev, state]);
    });

    sm.dispatch({ type: "START" }, { bufferedSeconds: 0 });
    sm.dispatch({ type: "CHUNK_RECEIVED", samples: 24000, chunkId: 0 }, { bufferedSeconds: 3.0 });

    expect(transitions).toEqual([
      [StreamState.IDLE, StreamState.BUFFERING],
      [StreamState.BUFFERING, StreamState.PLAYING],
    ]);
  });

  it("allows unsubscribing from state changes", () => {
    const sm = new StreamStateMachine();
    let callCount = 0;

    const unsubscribe = sm.onStateChange(() => {
      callCount++;
    });

    sm.dispatch({ type: "START" }, { bufferedSeconds: 0 });
    expect(callCount).toBe(1);

    unsubscribe();

    sm.dispatch({ type: "CHUNK_RECEIVED", samples: 24000, chunkId: 0 }, { bufferedSeconds: 3.0 });
    expect(callCount).toBe(1); // Should not increase
  });

  it("tracks transition count", () => {
    const sm = new StreamStateMachine();

    expect(sm.transitions).toBe(0);

    sm.dispatch({ type: "START" }, { bufferedSeconds: 0 });
    expect(sm.transitions).toBe(1);

    sm.dispatch({ type: "CHUNK_RECEIVED", samples: 24000, chunkId: 0 }, { bufferedSeconds: 3.0 });
    expect(sm.transitions).toBe(2);
  });

  it("returns stats correctly", () => {
    const sm = new StreamStateMachine();

    sm.dispatch({ type: "START" }, { bufferedSeconds: 0 });

    const stats = sm.getStats();

    expect(stats.current_state).toBe(StreamState.BUFFERING);
    expect(stats.transition_count).toBe(1);
    expect(stats.is_terminal).toBe(false);
    expect(stats.config).toEqual(DEFAULT_STREAM_CONFIG);
  });

  it("handles short text (BUFFERING → DRAINING without PLAYING)", () => {
    const sm = new StreamStateMachine();

    sm.dispatch({ type: "START" }, { bufferedSeconds: 0 });

    // Generation completes before buffer threshold reached
    sm.dispatch({ type: "CHUNK_RECEIVED", samples: 12000, chunkId: 0 }, { bufferedSeconds: 0.5 });
    expect(sm.state).toBe(StreamState.BUFFERING);

    sm.dispatch({ type: "GENERATION_COMPLETE", totalChunks: 1 }, { bufferedSeconds: 0.5 });
    expect(sm.state).toBe(StreamState.DRAINING);
  });
});
