# Bug Report: Audio Cut Off at Beginning and End in Streaming Mode

**Date:** December 31, 2025  
**Tester:** Claude (coding-agent)  
**Test Environment:** macOS (Apple Silicon)

---

## Issue: Streaming Audio Truncated

**Severity:** High (audio quality issue)

**Description:**  
When using `--stream` mode, audio is cut off at the beginning and end. Users report missing first and last words.

**Reproduction:**
```bash
speak 'Short test' --stream          # "Short test" not audible or truncated
speak 'This is a longer sentence' --stream  # First and last words cut off
```

**Symptoms:**
- "Underruns: 700 samples" or similar reported in output
- First word(s) missing or truncated
- Last word(s) missing or truncated
- Non-streaming mode (`--play`) works correctly

---

## Root Cause Analysis

**Two bugs found in `src/audio/stream-player.ts`:**

### Bug A: Last chunk not pushed before stream ends

In the `read()` callback (lines ~115-135):

```typescript
read: () => {
  if (!this._playing) {
    this.readable!.push(null);
    return;
  }

  // Read from ring buffer
  this.buffer.read(chunk);  // <-- Data read into chunk

  // Check for draining completion
  if (this._draining && this.buffer.isEmpty) {
    logDecision("Audio playback complete", ...);
    this.readable!.push(null);  // <-- BUG: pushes null WITHOUT pushing chunk first!
    this._playing = false;
    this._finished = true;
    return;  // <-- Last chunk of audio data is lost
  }

  // This line never reached for last chunk:
  const buf = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  this.readable!.push(buf);
}
```

**Problem:** When `this._draining && this.buffer.isEmpty` is true, the code:
1. Reads remaining data from buffer into `chunk`
2. Immediately pushes `null` to end the stream
3. Never pushes the actual audio data that was just read
4. Result: Last chunk of audio is lost

### Bug B: Checking isEmpty after read

The condition `this.buffer.isEmpty` is checked AFTER `this.buffer.read(chunk)`. But `read()` may have just consumed the last samples, making the buffer empty. The data is in `chunk` but we discard it.

---

## Fix Required

**Fix in `src/audio/stream-player.ts`:**

Change the read callback to push the chunk BEFORE checking for drain completion:

```typescript
read: () => {
  // Check if we should stop
  if (!this._playing) {
    this.readable!.push(null);
    return;
  }

  // Read from ring buffer
  const samplesRead = this.buffer.read(chunk);

  // Always push the chunk if we read any data
  if (samplesRead > 0 || !this._draining) {
    const buf = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    this.readable!.push(buf);
  }

  // Check for draining completion AFTER pushing
  if (this._draining && this.buffer.isEmpty) {
    logDecision("Audio playback complete", "Buffer drained and generation finished", {
      total_underrun_samples: this.buffer.underrunSamples,
    });
    this.readable!.push(null);
    this._playing = false;
    this._finished = true;
  }
}
```

**Key changes:**
1. Push the chunk data BEFORE checking drain completion
2. Only skip pushing if draining AND no data was read
3. Push `null` after the final data chunk, not instead of it

---

## Verification

After fix:
- `speak 'Short test' --stream` should play "Short test" clearly
- `speak 'This is a longer sentence' --stream` should play all words
- Underrun count should be minimal (only from timing, not lost data)

---

## Additional Notes

This bug is pre-existing in the streaming implementation, not caused by the Issue 2 fix (success=false bug). The streaming state machine fix was correct; this is a separate audio pipeline bug.
