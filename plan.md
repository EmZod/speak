# Bug Fix Plan: Daemon Persistence Issue

## Issue
[#9](https://github.com/EmZod/speak/issues/9) - Daemon mode server dies unexpectedly between calls

## Root Cause Analysis

### The Problem
When using `--daemon` mode, the Python TTS server terminates silently after the first call completes, causing subsequent calls to hang.

### Investigation Findings

**1. Process Spawning (src/bridge/daemon.ts:72-80)**
```typescript
const serverProcess = spawn(VENV_PYTHON, [SERVER_SCRIPT], {
  detached: true,
  stdio: ["ignore", "pipe", "pipe"],  // <-- stdout/stderr are PIPED
});
```

The server is spawned with:
- `detached: true` - allows the process to survive parent exit
- `stdio: ["ignore", "pipe", "pipe"]` - stdin ignored, but **stdout/stderr are connected via pipes**

**2. Pipe Detachment Attempt (src/bridge/daemon.ts:86-100)**
```typescript
const detachProcess = () => {
  serverProcess.stdout?.removeAllListeners();
  serverProcess.stderr?.removeAllListeners();
  serverProcess.removeAllListeners();
  // ... unref() calls
  serverProcess.unref();
};
```

The code attempts to detach by:
- Removing event listeners
- Calling `unref()` on streams and process

**However**, `unref()` only prevents these handles from keeping the Node.js event loop alive. It does NOT close the pipes. The pipes remain open until the Node.js process exits.

**3. Process Exit (src/index.ts:165-166)**
```typescript
// Exit cleanly - don't leave event loop hanging
process.exit(0);
```

This is called unconditionally after generation completes, even in daemon mode.

**4. Python Logging (src/python/server.py)**
```python
def log(level: str, message: str, **data):
    print(json.dumps(entry), file=sys.stderr, flush=True)
```

The Python server writes to stderr for every significant event: "Client connected", "Client disconnected", debug messages, etc.

### The Kill Chain

1. First `speak` call with `--daemon` starts Python server with piped stdout/stderr
2. Generation completes, `process.exit(0)` is called
3. Node.js process exits, **closing its end of the stdout/stderr pipes**
4. Python server continues running, accepts next connection
5. Python calls `log("debug", "Client connected")` → writes to stderr
6. **Write to closed pipe raises `BrokenPipeError` in Python**
7. Exception is unhandled → Python process crashes
8. Second `speak` call hangs waiting for a dead server

The comment in daemon.ts acknowledges part of this:
```typescript
// Note: Don't destroy() the pipes - that sends SIGPIPE to the Python process
```

But the current approach still fails because `process.exit()` closes the pipes anyway.

## Solution Options

### Option A: Handle SIGPIPE in Python (Recommended)
Make Python resilient to broken pipes by:
1. Ignoring SIGPIPE signal
2. Catching BrokenPipeError in logging

**Pros**: Simple, non-breaking, Python becomes truly independent  
**Cons**: None significant

### Option B: Redirect Python stdout/stderr After Startup
After sending the "ready" signal, redirect stdout/stderr to /dev/null or a log file.

**Pros**: Clean separation  
**Cons**: Loses logging capability for debugging

### Option C: Use stdio: "ignore" with Socket-Based Ready Signal
Change spawn to `stdio: "ignore"` and poll the socket for readiness instead of reading stdout.

**Pros**: Completely detached from start  
**Cons**: More complex, requires timeout-based polling

## Chosen Approach: Option A (Extended)

The fix has two parts:
1. Make Python handle SIGPIPE gracefully for server logging
2. Redirect stderr during generation to prevent mlx_audio library writes from causing BrokenPipeError

### Implementation

**File: src/python/server.py**

1. Add SIGPIPE handler at module level:
```python
import signal

# Ignore SIGPIPE to prevent crashes when parent process exits
signal.signal(signal.SIGPIPE, signal.SIG_IGN)
```

2. Wrap logging to catch BrokenPipeError:
```python
def log(level: str, message: str, **data):
    """Simple logging to stderr"""
    entry = {"level": level, "message": message, "timestamp": time.time(), **data}
    try:
        print(json.dumps(entry), file=sys.stderr, flush=True)
    except BrokenPipeError:
        # Parent process exited, stderr is closed - continue silently
        pass
```

3. Protect the initial ready signal:
```python
try:
    print(json.dumps({"status": "ready", "socket": SOCKET_PATH}), flush=True)
except BrokenPipeError:
    pass
```

4. Redirect both stdout AND stderr during generate_audio calls (mlx_audio writes to stderr):
```python
from contextlib import redirect_stdout, redirect_stderr

with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
    generate_audio(...)
```

### Testing Plan

1. Run `speak "test" --daemon --stream` 
2. Immediately run `speak "second test" --daemon --stream`
3. Verify second call works without "Starting TTS server" message
4. Verify `speak daemon kill` cleanly stops the server
5. Run existing integration tests: `bun test test/integration/bridge/client-daemon.test.ts`

## Files to Modify

1. `src/python/server.py` - Add SIGPIPE handling and BrokenPipeError protection

## Estimated Complexity

Low - approximately 10 lines of changes in one file.
