# Bug Report: speak v1 Testing

**Date:** December 31, 2025  
**Tester:** Claude (coding-agent)  
**Test Environment:** macOS (Apple Silicon)

---

## Issues Found

### Issue 1: SKILL.md Daemon Documentation Incorrect

**Severity:** Medium (documentation mismatch)

**Description:**  
SKILL.md documents daemon commands that don't exist in the actual CLI.

**Expected (from SKILL.md):**
```bash
speak daemon start
speak daemon stop
```

**Actual CLI:**
- No `speak daemon start` command exists
- No `speak daemon stop` command exists
- Only `speak daemon kill` exists
- The `--daemon` flag keeps server running after generation

**Root Cause:**  
Implementation Plan Phase 6.2 specified `speak daemon start/stop` but the implementation only added `speak daemon kill`. The daemon is started implicitly via `startDaemon()` when needed, not via explicit CLI command.

**Fix Required:**  
Either:
1. Update SKILL.md to document actual behavior (`--daemon` flag + `speak daemon kill`)
2. Or implement `speak daemon start` and `speak daemon stop` as CLI subcommands

---

### Issue 2: Streaming Returns success=false Despite Successful Playback

**Severity:** High (user-facing error on successful operations)

**Description:**  
The `--stream` option completes audio playback correctly but reports an error at the end with exit code 1.

**Output:**
```
✗ Streaming failed: undefined
```

**Root Cause Found (TWO ISSUES):**  

**Issue A: Player never starts for short text**

For short text that doesn't reach the 3-second initial buffer threshold:
- State goes `BUFFERING → DRAINING` directly (skips `PLAYING`)
- `handleStateChange` only starts player when transitioning TO `PLAYING`
- Player never starts, `waitForFinish()` returns immediately

**Issue B: No BUFFER_EMPTY event dispatched**

Even when player runs correctly:
- After `player.waitForFinish()` returns, state is still `DRAINING`
- No `BUFFER_EMPTY` event is dispatched to transition to `FINISHED`
- `buildResult()` checks `state === StreamState.FINISHED` → returns `success: false`

**Evidence from logs:**
```json
{"message":"State transition: BUFFERING → DRAINING",...}  // Skipped PLAYING!
{"message":"Starting audio drain",...}
// No "Starting audio playback" - player never started
// No transition to FINISHED
```

**Fixes Required in `orchestrator.ts`:**

**Fix A:** In `handleStateChange`, start player when entering DRAINING from BUFFERING:
```typescript
case StreamState.DRAINING:
  // For short text: BUFFERING → DRAINING, need to start player first
  if (prev === StreamState.BUFFERING && !this.player.isPlaying) {
    this.player.start();
  }
  this.player.startDraining();
  break;
```

**Fix B:** After `waitForFinish()`, dispatch BUFFER_EMPTY:
```typescript
// Wait for playback to finish
if (this.player.isPlaying) {
  await this.player.waitForFinish();
}

// Dispatch BUFFER_EMPTY to transition state machine to FINISHED
if (this.stateMachine.state === StreamState.DRAINING) {
  this.stateMachine.dispatch(
    { type: 'BUFFER_EMPTY' },
    { bufferedSeconds: 0 }
  );
}
```

---

### Issue 3: Daemon Mode Server Sometimes Dies After Requests

**Severity:** Medium (intermittent issue)

**Description:**  
Using `--daemon` flag should keep the server running for faster subsequent calls. In some tests the server dies, in others it persists correctly.

**Observed Behavior:**
- Sometimes: Server dies during second generation, socket removed, second call hangs
- Sometimes: Server persists correctly, second call is faster

**Investigation Results:**
1. Python server CAN handle multiple sequential connections correctly
2. Health check requests always work
3. Generation requests sometimes cause server death
4. Warning seen on shutdown: "resource_tracker: There appear to be 1 leaked semaphore objects to clean up at shutdown"

**Possible Causes:**
- Race condition in mlx-audio model state
- Semaphore leak from multiprocessing (see warning)
- Client connection timing issues

**Status:** Intermittent, needs more investigation. Not blocking for v1 launch but should be tracked.

---

### Issue 4: Default Model Documentation (Informational)

**Severity:** Low (not a bug)

**Description:**  
The original speak-tts skill mentioned "fp16 model (best quality)" as default, but actual default is `chatterbox-turbo-8bit` (fastest). The new SKILL.md v1 correctly doesn't specify a default model, letting users discover via `speak models`.

**No action required.**

---

## Summary

| Issue | Severity | Status | Fix Complexity |
|-------|----------|--------|----------------|
| 1: Daemon docs | Medium | Root cause found | Low (doc update) |
| 2: Streaming success=false | High | Root cause found | Medium (2 fixes needed) |
| 3: Daemon server dies | Medium | Intermittent, needs investigation | Unknown |
| 4: Model default | Low | Informational | N/A |

---

## Recommended Priority

1. **Issue 2** - Simple fix, high impact (users see failure on success)
2. **Issue 1** - Doc update to match actual behavior  
3. **Issue 3** - Investigate Python server stability

---

## Test Environment

```
macOS (Apple Silicon M-series)
speak v0.1.0
Bun v1.2.11
Python 3.x via venv
```
