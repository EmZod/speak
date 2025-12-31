# No progress indicator for long files

## Type
Feature Request

## Severity
Medium

## Description
When generating audio for long text inputs, there's no indication of progress. The process appears hung with no feedback until completion or timeout.

## Current Behavior
- Spinner shows "Generating audio..." indefinitely
- No indication of how much is done or remaining
- For large files, user cannot distinguish between "working" and "stuck"

## Expected Behavior
Progress reporting during generation:
```
Generating audio...
  Chunk 3/12 complete (25%)
  Estimated time remaining: 4m 30s
```

## Use Case
When generating a 168KB chapter that takes 15+ minutes, I had no idea if it was progressing or had silently failed until it either completed or timed out at 5 minutes.

---

## Investigation

### Current Architecture

Looking at `src/bridge/client.ts`, the `generate()` function makes a single request to the Python server and waits for completion. The Python server processes the entire text before returning.

For streaming mode (`src/streaming/orchestrator.ts`), we already have chunk-by-chunk progress via `onProgress` callback. The issue is **non-streaming** mode and the user's mental model during long generations.

### State Inventory

| State | Location | Current Visibility |
|-------|----------|-------------------|
| Total chunks | Python server | None - only known at end |
| Current chunk | Python server | None - no intermediate reporting |
| Generation progress | Python → TypeScript | None for non-streaming |
| ETA calculation | N/A | Not implemented |

### Design Questions

1. **Where should progress live?**
   - Option A: Python streams progress over socket (even for non-streaming output)
   - Option B: Python writes progress to a side-channel file
   - Option C: TypeScript polls Python for status
   
   **Answer**: Option A is cleanest. Single socket, single protocol. Python sends progress events interleaved with audio chunks.

2. **What metrics to show?**
   - Chunks: `3/12 chunks` — requires knowing total upfront
   - Percentage: `25%` — same requirement
   - Characters processed: `5,000/20,000 chars` — easy
   - Time elapsed + ETA: `2m30s elapsed, ~5m remaining` — requires RTF estimation
   
   **Answer**: Characters processed is simplest and always available. ETA can be calculated from observed generation speed.

### Hot Path Impact

Progress reporting adds overhead to the hot path (generation). Must be minimal:
- No blocking I/O for progress
- Progress events should be fire-and-forget
- Batch progress updates (every N chunks, not every token)

---

## Implementation Plan

### Design Principles Applied

1. **Hot paths first** — Progress reporting must not slow generation
2. **Log the decisions** — Log progress events for debugging
3. **Simple and boring** — Use existing socket protocol, extend it minimally

### Approach

Extend the JSON-lines protocol to support progress events. Python server sends progress after each chunk. TypeScript client updates spinner/progress bar.

### Protocol Extension

Current protocol (JSON-lines over Unix socket):
```
→ {"id": "1", "method": "generate", "params": {...}}
← {"id": "1", "result": {"audio_path": "...", "duration": 5.2}}
```

Extended protocol with progress:
```
→ {"id": "1", "method": "generate", "params": {...}}
← {"id": "1", "progress": {"chunk": 1, "total_chunks": 12, "chars_done": 1500, "chars_total": 18000}}
← {"id": "1", "progress": {"chunk": 2, "total_chunks": 12, "chars_done": 3000, "chars_total": 18000}}
...
← {"id": "1", "result": {"audio_path": "...", "duration": 45.2}}
```

### Code Changes

**File: `src/python/server.py`** (add progress emission)

```python
def handle_generate(conn, request):
    """Handle generate request with progress reporting."""
    request_id = request.get('id')
    params = request.get('params', {})
    text = params.get('text', '')
    
    # Chunk text for progress reporting
    chunks = chunk_text(text)
    total_chunks = len(chunks)
    total_chars = len(text)
    chars_done = 0
    
    audio_segments = []
    
    for i, chunk_text in enumerate(chunks):
        # Send progress event
        progress = {
            'id': request_id,
            'progress': {
                'chunk': i + 1,
                'total_chunks': total_chunks,
                'chars_done': chars_done,
                'chars_total': total_chars,
            }
        }
        send_json(conn, progress)
        
        # Generate audio for chunk
        audio = generate_audio(chunk_text, params)
        audio_segments.append(audio)
        
        chars_done += len(chunk_text)
    
    # Concatenate and save
    final_audio = concatenate_audio(audio_segments)
    audio_path = save_audio(final_audio)
    
    # Send final result
    result = {
        'id': request_id,
        'result': {
            'audio_path': audio_path,
            'duration': len(final_audio) / SAMPLE_RATE,
            'rtf': calculate_rtf(),
        }
    }
    send_json(conn, result)
```

**File: `src/bridge/client.ts`** (handle progress events)

```typescript
export interface GenerateProgress {
  chunk: number;
  totalChunks: number;
  charsDone: number;
  charsTotal: number;
}

export interface GenerateOptions {
  text: string;
  model?: string;
  temperature?: number;
  speed?: number;
  voice?: string;
  onProgress?: (progress: GenerateProgress) => void;
}

export async function generate(options: GenerateOptions): Promise<GenerateResult> {
  const { onProgress, ...params } = options;
  
  const socket = await connectToServer();
  const requestId = `gen-${Date.now()}`;
  
  // Send request
  await sendRequest(socket, {
    id: requestId,
    method: 'generate',
    params,
  });
  
  // Read responses until we get a result
  for await (const message of readJsonLines(socket)) {
    if (message.id !== requestId) continue;
    
    if (message.progress && onProgress) {
      onProgress({
        chunk: message.progress.chunk,
        totalChunks: message.progress.total_chunks,
        charsDone: message.progress.chars_done,
        charsTotal: message.progress.chars_total,
      });
    }
    
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

**File: `src/ui/progress.ts`** (enhanced spinner with progress)

```typescript
export interface SpinnerOptions {
  text: string;
  showEta: boolean;
  quiet: boolean;
}

export interface Spinner {
  start(): void;
  stop(success: boolean): void;
  updateProgress(progress: GenerateProgress): void;
}

export function createSpinner(options: SpinnerOptions): Spinner {
  const { quiet } = options;
  let startTime: number;
  let interval: Timer | null = null;
  
  // Track for ETA calculation
  let lastProgress: GenerateProgress | null = null;
  let charRate = 0; // chars per second
  
  return {
    start() {
      if (quiet) return;
      startTime = Date.now();
      
      // Start spinner animation
      const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
      let frameIndex = 0;
      
      interval = setInterval(() => {
        const frame = frames[frameIndex % frames.length];
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        
        let status = `${frame} Generating audio... (${elapsed}s)`;
        
        if (lastProgress) {
          const pct = Math.round((lastProgress.charsDone / lastProgress.charsTotal) * 100);
          status = `${frame} Generating: ${pct}% (${lastProgress.chunk}/${lastProgress.totalChunks} chunks)`;
          
          if (charRate > 0) {
            const remaining = lastProgress.charsTotal - lastProgress.charsDone;
            const etaSeconds = Math.round(remaining / charRate);
            status += ` ~${formatTime(etaSeconds)} remaining`;
          }
        }
        
        process.stdout.write(`\r${status}  `);
        frameIndex++;
      }, 100);
    },
    
    stop(success: boolean) {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      if (!quiet) {
        process.stdout.write('\r' + ' '.repeat(80) + '\r'); // Clear line
      }
    },
    
    updateProgress(progress: GenerateProgress) {
      const now = Date.now();
      
      // Calculate char rate for ETA
      if (lastProgress && progress.charsDone > lastProgress.charsDone) {
        const charsDelta = progress.charsDone - lastProgress.charsDone;
        const timeDelta = (now - startTime) / 1000;
        charRate = progress.charsDone / timeDelta; // Simple average
      }
      
      lastProgress = progress;
    },
  };
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m${secs}s`;
}
```

**File: `src/index.ts`** (wire up progress callback)

```typescript
// In the generate action, update to use onProgress:

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
// test/unit/progress.test.ts

describe('Spinner with progress', () => {
  it('calculates ETA based on char rate', () => {
    const spinner = createSpinner({ text: '', showEta: true, quiet: false });
    
    // Simulate 1000 chars/second rate
    spinner.updateProgress({
      chunk: 1,
      totalChunks: 10,
      charsDone: 1000,
      charsTotal: 10000,
    });
    
    // After 1 second, should estimate 9 more seconds
    // (9000 remaining chars / 1000 chars per sec)
  });
});
```

### Failure Modes

| Failure | Handling |
|---------|----------|
| Progress events not arriving | Spinner continues with elapsed time only |
| Zero char rate (stuck) | Show "Processing..." without ETA |
| Rapid progress spam | Throttle UI updates to 100ms |

### Rollout

1. Implement Python progress emission
2. Update client to handle progress events
3. Enhance spinner UI
4. Test with long documents
5. Release

### Verification

```bash
# Generate from large file, should show progress
speak large-document.md --verbose

# Output should show:
# ⠹ Generating: 45% (5/11 chunks) ~2m30s remaining
```
