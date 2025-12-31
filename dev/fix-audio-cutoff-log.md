# STATE

## Current
step_id: STEP-01
status: IN_PROGRESS
objective: Fix audio cutoff bug in streaming mode

## Decisions (append-only)
(none yet)

## Blockers (append-only, mark resolved inline)
(none)

---

# IMPLEMENTATION PLAN

Fix streaming audio cutoff bug in `src/audio/stream-player.ts`.

**Problem:** Last chunk of audio data is discarded when drain completes.

**Fix:** Push chunk data BEFORE checking drain completion, not after.

**Verification:**
- Test with short text - should hear complete audio
- Test with long text - should hear all words including first and last

---

# STEP LOG (append-only)

## STEP-01
### Pre-Execution
**Objective:** Read current stream-player.ts code and identify exact lines to change

**Files to examine:**
- `/Users/jay/Documents/speak/src/audio/stream-player.ts`

**Initial Assumptions:**
- The bug is in the `read()` callback of the Readable stream
- Need to reorder: push chunk first, then check for drain completion

**Initial Hypotheses:**
- Fix will require restructuring the read callback logic

**Initial Questions:**
- What is the exact current code structure?
- Does `buffer.read()` return the number of samples read?

### Execution

**Current buggy code (lines 115-140):**
```typescript
this.readable = new Readable({
  read: () => {
    // Check if we should stop
    if (!this._playing) {
      this.readable!.push(null);
      return;
    }

    // Read from ring buffer
    this.buffer.read(chunk);

    // Check for draining completion
    if (this._draining && this.buffer.isEmpty) {
      logDecision("Audio playback complete", "Buffer drained and generation finished", {
        total_underrun_samples: this.buffer.underrunSamples,
      });
      this.readable!.push(null);  // BUG: doesn't push chunk first!
      this._playing = false;
      this._finished = true;
      return;
    }

    // Convert Float32Array to Buffer and push
    const buf = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    this.readable!.push(buf);
  },
});
```

**Confirmed:** `buffer.read()` returns number of samples read (from ring-buffer.ts line 95).

**Plan:** Restructure to always push chunk data before checking drain completion.

### Post-Execution
**Outcome:** PASS - understood the code structure
**Belief updates:** None
**Next:** Apply the fix

---

## STEP-02
### Pre-Execution
**Objective:** Apply fix to stream-player.ts

**Files to modify:**
- `/Users/jay/Documents/speak/src/audio/stream-player.ts`

**Initial Assumptions:**
- Need to push chunk before checking drain
- Should only end stream when buffer truly empty AND we've pushed all data

**Initial Hypotheses:**
- Reordering the logic will fix audio cutoff

**Initial Questions:**
- None

### Execution (STEP-02)

**Applied fix:**

Changed from:
```typescript
// Read from ring buffer
this.buffer.read(chunk);

// Check for draining completion
if (this._draining && this.buffer.isEmpty) {
  // ... log ...
  this.readable!.push(null);  // BUG: loses chunk data
  this._playing = false;
  this._finished = true;
  return;
}

// Convert Float32Array to Buffer and push
const buf = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
this.readable!.push(buf);
```

To:
```typescript
// Read from ring buffer
const samplesRead = this.buffer.read(chunk);

// Always push the chunk if we read any data (or if not draining yet)
if (samplesRead > 0 || !this._draining) {
  const buf = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  this.readable!.push(buf);
}

// Check for draining completion AFTER pushing data
if (this._draining && this.buffer.isEmpty) {
  logDecision("Audio playback complete", "Buffer drained and generation finished", {
    total_underrun_samples: this.buffer.underrunSamples,
  });
  this.readable!.push(null);
  this._playing = false;
  this._finished = true;
}
```

**Key changes:**
1. Capture `samplesRead` return value
2. Push chunk data BEFORE checking drain completion
3. Only skip push if draining AND no data read
4. Remove early `return` - let drain check happen after push

### Post-Execution
**Outcome:** PASS - fix applied
**Belief updates:** None
**Next:** Test the fix

---

## STEP-03
### Pre-Execution
**Objective:** Test with short text

**Test command:**
```bash
speak 'Short test' --stream
```

**Initial Assumptions:**
- Should now hear "Short test" clearly
- No truncation at beginning or end

**Initial Hypotheses:**
- Fix should resolve audio cutoff

**Initial Questions:**
- None

### Execution (STEP-03)

**Test result: FAILED** - Still no audio heard.

**New investigation:**
The issue is NOT just about pushing the last chunk. The real problem is timing:
1. We push data to the readable stream
2. Readable pipes to speaker
3. We set `_finished = true` immediately when readable ends
4. But speaker hasn't actually played the audio yet - it has internal buffers
5. `waitForFinish()` returns immediately because `_finished` is already true
6. Process exits before speaker plays audio

**Root cause:** Setting `_finished = true` in the read callback is wrong. We should wait for the speaker to emit 'finish' or 'close' event.

### Post-Execution
**Outcome:** FAIL - identified deeper root cause
**Belief updates:** The fix needs to wait for speaker to finish, not just readable stream
**Next:** Apply correct fix - listen for speaker 'finish' event

---

## STEP-04
### Pre-Execution
**Objective:** Fix the timing issue - wait for speaker to finish

**Files to modify:**
- `/Users/jay/Documents/speak/src/audio/stream-player.ts`

**Initial Assumptions:**
- Speaker (Writable) emits 'finish' when done processing all data
- We should set `_finished = true` when speaker finishes, not when readable ends

**Initial Hypotheses:**
- Need to add speaker.on('finish') handler to set _finished

**Initial Questions:**
- Does speaker emit 'finish' or 'close' or both?

### Execution (STEP-04)
