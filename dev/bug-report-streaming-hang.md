# Bug Report: Streaming Hangs on Long Content

**Date:** December 31, 2025  
**Issue:** #13 on GitHub
**Severity:** High
**Status:** FIXED

## Problem

When using `--stream` mode with long content (2.5KB+ markdown), the process hung indefinitely. Audio never started playing, or played briefly then stopped.

## Root Cause

The streaming orchestrator had a flawed architecture that caused a deadlock between socket reading and buffer writes.

### Original (Broken) Code

```typescript
// Original flow in orchestrator.ts:

// Read chunks from socket - BLOCKS until handleChunk returns
for await (const message of readBinaryStream(this.socket)) {
  if (message.type === "chunk") {
    // Process chunk - BLOCKS when buffer is full waiting for playback to drain
    await this.handleChunk(message);
  } else if (message.type === "end") {
    break;
  }
}
```

### The Deadlock Sequence

1. Python server generates audio chunk 0 (~10 seconds) and sends it
2. TypeScript receives chunk 0, starts processing via `handleChunk()`
3. `handleChunk()` fills the 10-second buffer, then blocks waiting for playback to drain
4. Meanwhile, Python generates chunk 1 and sends it to socket
5. Python sends the end marker and completes
6. TypeScript is still blocked in `handleChunk()`, can't read from socket
7. Socket times out or Python closes connection
8. TypeScript gets "Socket closed before receiving complete message" error

### Evidence from Logs

```
[server] Sent binary chunk 0: 262020 samples, 10.92s
[ts] State transition: BUFFERING → PLAYING
[ts] Starting audio playback

[server] Sent binary chunk 1: 137220 samples, 5.72s  
[server] Binary stream complete: 2 chunks, 399240 samples

# TypeScript still blocked processing chunk 0...

[ts] Socket closed during stream
[ts] Stream orchestration failed: Socket closed before receiving complete message
```

## Solution

Implemented a producer-consumer pattern that reads from socket concurrently with chunk processing:

```typescript
// Fixed flow:

// Producer: Read all chunks from socket into queue (runs concurrently)
const readPromise = (async () => {
  for await (const message of readBinaryStream(this.socket)) {
    if (message.type === "chunk") {
      chunkQueue.push(message);  // Non-blocking push to queue
    } else if (message.type === "end") {
      streamEnded = true;
      break;
    }
  }
  readerDone = true;
})();

// Consumer: Process chunks from queue (can block on buffer writes)
while (!readerDone || chunkQueue.length > 0) {
  if (chunkQueue.length > 0) {
    const chunk = chunkQueue.shift()!;
    await this.handleChunk(chunk);  // May block, but socket read continues
  } else {
    await this.sleep(10);  // Wait for more chunks
  }
}

await readPromise;  // Ensure reader completes
```

### Why This Works

- The socket reader runs in its own async "thread" and never blocks
- Chunks are queued as they arrive from the server
- The consumer processes chunks at its own pace, blocking on buffer writes as needed
- Socket never times out because we're always ready to receive data

## Test Results

### Before Fix
```bash
speak /tmp/long-test.md --stream
# Hangs indefinitely, eventually errors with "Socket closed"
```

### After Fix
```bash
speak /tmp/long-test.md --stream

# Output:
✓ Streamed 14 chunks
  Duration: 149.0s
  Underruns: 776 samples
# Completed in ~160s (generation + playback time)
```

### Performance

| Content Size | Audio Duration | Total Time | Status |
|--------------|----------------|------------|--------|
| Short (21 chars) | 0.9s | ~4s | ✓ Works |
| Medium (329 chars) | 17.0s | ~30s | ✓ Works |
| Long (2.5KB) | 149.0s | ~160s | ✓ Works |

## Files Modified

- `src/streaming/orchestrator.ts` - Refactored `stream()` method to use producer-consumer pattern

## Lessons Learned

1. **Async generators block on yield**: `for await` blocks until the current iteration's promise resolves before reading the next value
2. **Socket reads and writes must be decoupled**: When processing may block, reading must happen concurrently
3. **Producer-consumer is the right pattern**: Separating socket reading from chunk processing prevents deadlocks

## Related Issues

- This same bug was reported as #13 on GitHub: "Generation hangs indefinitely at 'finalizing...' for long content"
- The `--play` mode was unaffected because it doesn't use streaming playback
