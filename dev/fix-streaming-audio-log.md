# Fix Log: Streaming Audio Not Playing

**Date:** December 31, 2025  
**Status:** FIXED

## Problem
Audio played for only a brief moment ("my friend" instead of "Hello there my friend") when using `--stream` mode. Non-streaming mode (`--play`) worked correctly.

## Root Cause
Two issues were found:

### Issue 1: Buffer View Corruption (MAIN ISSUE)
In `src/audio/stream-player.ts`, the `read()` callback was creating a Buffer view into a reused Float32Array:

```typescript
const chunk = new Float32Array(chunkSamples);  // Reused across reads

read: () => {
  this.buffer.read(chunk);
  const buf = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);  // VIEW, not copy!
  this.readable!.push(buf);
}
```

`Buffer.from(arrayBuffer, offset, length)` creates a **view** into the underlying ArrayBuffer, not a copy. When the next `read()` call filled `chunk` with new data, it corrupted the buffer that was still queued in the speaker's internal buffer waiting to be played.

**Fix:** Allocate a new buffer and copy data for each push:

```typescript
read: () => {
  const samplesRead = this.buffer.read(chunk);
  if (samplesRead > 0) {
    const buf = Buffer.alloc(samplesRead * 4);
    for (let i = 0; i < samplesRead; i++) {
      buf.writeFloatLE(chunk[i]!, i * 4);
    }
    this.readable!.push(buf);
  }
}
```

### Issue 2: Binary Protocol Buffer Corruption
In `src/bridge/binary-reader.ts`, similar issue with socket data buffers. Bun may reuse the buffer passed to the `data` event callback.

**Fix:** Copy the buffer immediately in the `onData` callback:

```typescript
const onData = (data: Buffer) => {
  cleanup();
  resolve(Buffer.from(data));  // Copy immediately
};
```

And when slicing the buffer:
```typescript
const result = Buffer.alloc(n);
buffer.copy(result, 0, 0, n);

const remaining = Buffer.alloc(buffer.length - n);
buffer.copy(remaining, 0, n);
buffer = remaining;
```

## Files Modified
- `src/audio/stream-player.ts` - Fixed buffer view corruption in read callback
- `src/bridge/binary-reader.ts` - Fixed socket buffer reuse issue
- `src/streaming/orchestrator.ts` - Added player.start() when BUFFERING→DRAINING for short text

## Verification
```bash
speak 'Hello there my friend' --stream  # Now plays full phrase
speak 'Testing the speak tool' --play   # Still works
```

## Lesson Learned
When working with streaming audio in Node.js/Bun:
1. Never create Buffer views (`Buffer.from(arrayBuffer)`) for data that will be pushed to streams
2. Always copy socket data immediately in event callbacks
3. The speaker module pre-buffers ~1.3 seconds of audio before playback starts
