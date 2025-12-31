# Distinguish model loading vs generating in output

## Type
Feature Request

## Severity
Low

## Description
The progress output doesn't clearly distinguish between model loading (cold start) and actual audio generation. Both show similar spinner/waiting states.

## Current Behavior
```
→ Starting TTS server...
✓ TTS server started
⠋ Generating audio...  # Could be loading model OR generating
```

## Proposed Behavior
```
→ Starting TTS server...
✓ TTS server started
⠋ Loading model... (first run only)
✓ Model loaded (2.3s)
⠋ Generating audio...
  Chunk 1/3 complete
✓ Generated 45.2s of audio
```

## Why It Matters
- Cold start: 4-8s (model loading + generation)
- Warm start: 3-8s (generation only)
- Users can't tell if slow start is model loading or a problem
- Helps diagnose performance issues

---

## Investigation

### Current Architecture

Looking at `src/bridge/daemon.ts` and `src/bridge/client.ts`:

1. **Daemon start** — Python server starts, loads model on first request
2. **First generation** — Model load + generation time combined
3. **Subsequent generations** — Only generation time (model warm)

The Python server doesn't report model loading status separately. The client sees one request-response cycle.

### Server Protocol

Current flow:
```
Client → Server: generate request
Server (internally): load model if needed, generate audio
Server → Client: result
```

Need to add:
```
Client → Server: generate request
Server → Client: status: loading_model
Server → Client: status: model_loaded (time: 2.3s)
Server → Client: status: generating
Server → Client: progress: chunk 1/3
Server → Client: result
```

### Related Issues

- **Issue #002** (progress) — Status messages could be part of progress reporting
- Implementing status messages provides foundation for #002

---

## Implementation Plan

### Design Principles Applied

1. **Log the decisions** — Each phase logged with timing
2. **Hot paths first** — Status messages should not slow generation
3. **Simple and boring** — Use existing protocol, add status events

### Approach

1. Add status events to Python server
2. Update client to handle status events
3. Display status transitions in spinner

### Protocol Extension

```json
// Status events (in addition to progress and result)
{ "id": "1", "status": { "phase": "loading_model", "model": "..." } }
{ "id": "1", "status": { "phase": "model_loaded", "load_time_ms": 2300 } }
{ "id": "1", "status": { "phase": "generating" } }
{ "id": "1", "progress": { ... } }
{ "id": "1", "result": { ... } }
```

### Code Changes

**File: `src/python/server.py`** (add status events)

```python
# Track model load state
_model_loaded = False
_model_load_time = 0

def ensure_model_loaded(model_name: str) -> float:
    """
    Load model if needed, return load time in seconds.
    Returns 0 if model was already loaded.
    """
    global _model_loaded, _model_load_time
    
    if _model_loaded:
        return 0.0
    
    start = time.time()
    # ... existing model loading code ...
    _model_load_time = time.time() - start
    _model_loaded = True
    
    return _model_load_time


def handle_generate(conn, request):
    """Handle generate with status reporting."""
    request_id = request.get('id')
    params = request.get('params', {})
    model_name = params.get('model', DEFAULT_MODEL)
    
    # Check if model needs loading
    if not _model_loaded:
        send_status(conn, request_id, 'loading_model', {'model': model_name})
        load_time = ensure_model_loaded(model_name)
        send_status(conn, request_id, 'model_loaded', {'load_time_ms': int(load_time * 1000)})
    
    # Send generating status
    send_status(conn, request_id, 'generating', {})
    
    # ... rest of generation ...


def send_status(conn, request_id: str, phase: str, data: dict):
    """Send a status event."""
    message = {
        'id': request_id,
        'status': {
            'phase': phase,
            **data,
        }
    }
    send_json(conn, message)
```

**File: `src/bridge/client.ts`** (handle status events)

```typescript
export interface StatusEvent {
  phase: "loading_model" | "model_loaded" | "generating";
  model?: string;
  loadTimeMs?: number;
}

export interface GenerateOptions {
  // ... existing options ...
  onStatus?: (status: StatusEvent) => void;
}

export async function generate(options: GenerateOptions): Promise<GenerateResult> {
  const { onStatus, onProgress, ...params } = options;
  
  // ... existing setup ...
  
  for await (const message of readJsonLines(socket)) {
    if (message.id !== requestId) continue;
    
    // Handle status events
    if (message.status && onStatus) {
      onStatus({
        phase: message.status.phase,
        model: message.status.model,
        loadTimeMs: message.status.load_time_ms,
      });
    }
    
    // Handle progress events
    if (message.progress && onProgress) {
      onProgress(message.progress);
    }
    
    // Handle result
    if (message.result) {
      socket.destroy();
      return message.result;
    }
    
    if (message.error) {
      socket.destroy();
      throw new Error(message.error.message);
    }
  }
  
  throw new Error('Connection closed without result');
}
```

**File: `src/ui/progress.ts`** (update spinner with status)

```typescript
export interface SpinnerOptions {
  text: string;
  showEta: boolean;
  quiet: boolean;
}

export interface Spinner {
  start(): void;
  stop(success: boolean): void;
  updateStatus(status: StatusEvent): void;
  updateProgress(progress: GenerateProgress): void;
}

export function createSpinner(options: SpinnerOptions): Spinner {
  const { quiet } = options;
  let startTime: number;
  let interval: Timer | null = null;
  let currentPhase: string = "starting";
  let modelLoadTime: number | null = null;
  let lastProgress: GenerateProgress | null = null;
  
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let frameIndex = 0;
  
  function render() {
    if (quiet) return;
    
    const frame = frames[frameIndex % frames.length];
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    
    let status: string;
    
    switch (currentPhase) {
      case "loading_model":
        status = `${frame} Loading model...`;
        break;
      
      case "model_loaded":
        const loadInfo = modelLoadTime ? ` (${(modelLoadTime / 1000).toFixed(1)}s)` : "";
        status = `${pc.green("✓")} Model loaded${loadInfo}`;
        // Print this line and move to next
        process.stdout.write(`\r${status}\n`);
        currentPhase = "generating"; // Transition
        return;
      
      case "generating":
        if (lastProgress) {
          const pct = Math.round((lastProgress.charsDone / lastProgress.charsTotal) * 100);
          status = `${frame} Generating: ${pct}% (${lastProgress.chunk}/${lastProgress.totalChunks})`;
        } else {
          status = `${frame} Generating audio... (${elapsed}s)`;
        }
        break;
      
      default:
        status = `${frame} Starting... (${elapsed}s)`;
    }
    
    process.stdout.write(`\r${status}  `);
    frameIndex++;
  }
  
  return {
    start() {
      if (quiet) return;
      startTime = Date.now();
      interval = setInterval(render, 100);
    },
    
    stop(success: boolean) {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      if (!quiet) {
        process.stdout.write('\r' + ' '.repeat(80) + '\r');
      }
    },
    
    updateStatus(status: StatusEvent) {
      currentPhase = status.phase;
      if (status.loadTimeMs) {
        modelLoadTime = status.loadTimeMs;
      }
      render();
    },
    
    updateProgress(progress: GenerateProgress) {
      lastProgress = progress;
    },
  };
}
```

**File: `src/index.ts`** (wire up status callback)

```typescript
const spinner = createSpinner({
  text,
  showEta: !options.quiet && text.length > 100,
  quiet: options.quiet,
});

spinner.start();

try {
  const result = await generate({
    text,
    model: options.model,
    temperature: parseFloat(options.temp),
    speed: parseFloat(options.speed),
    voice: options.voice,
    onStatus: (status) => {
      spinner.updateStatus(status);
    },
    onProgress: (progress) => {
      spinner.updateProgress(progress);
    },
  });
  
  spinner.stop(true);
  // ... rest of handling
}
```

### Test Cases

```typescript
// test/integration/status.test.ts

describe('Status events', () => {
  it('reports model loading on cold start', async () => {
    // Ensure daemon is stopped
    await stopDaemon();
    
    const statuses: StatusEvent[] = [];
    
    await generate({
      text: 'Test',
      onStatus: (s) => statuses.push(s),
    });
    
    expect(statuses[0].phase).toBe('loading_model');
    expect(statuses[1].phase).toBe('model_loaded');
    expect(statuses[1].loadTimeMs).toBeGreaterThan(0);
    expect(statuses[2].phase).toBe('generating');
  });
  
  it('skips model loading on warm start', async () => {
    // Ensure daemon is running with model loaded
    await generate({ text: 'Warmup' });
    
    const statuses: StatusEvent[] = [];
    
    await generate({
      text: 'Test',
      onStatus: (s) => statuses.push(s),
    });
    
    // Should go straight to generating
    expect(statuses[0].phase).toBe('generating');
    expect(statuses.some(s => s.phase === 'loading_model')).toBe(false);
  });
});
```

### User Experience

**Cold start:**
```
⠋ Loading model...
✓ Model loaded (3.2s)
⠋ Generating audio... (5s)
✓ Generated 12.5s of audio
```

**Warm start:**
```
⠋ Generating audio... (3s)
✓ Generated 12.5s of audio
```

### Rollout

1. Add status events to Python server
2. Update client to handle status events
3. Update spinner to display phases
4. Test cold/warm start scenarios
5. Release

### Priority Note

Low priority because:
- Users can infer state from timing
- Not blocking any workflows
- Nice UX polish for debugging

Implement after core issues and alongside #002 (progress reporting).
