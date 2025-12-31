# Silent timeout with no partial output

## Type
Bug / Feature Request

## Severity
High

## Description
Long text inputs timeout after 5 minutes (300000ms) with no partial output saved. All progress is lost.

## Current Behavior
```
Error: Request timeout after 300000ms
```
- No audio file produced
- No indication of how far it got
- Must restart from scratch

## Expected Behavior
- Save partial output before timeout
- Or: checkpoint intermediate results during generation
- Or: configurable timeout with `--timeout` flag

## Impact
- Wasted compute time on failed generations
- No way to resume or recover partial work
- Forces users to manually chunk input to stay under timeout

---

## Investigation

### Root Cause Analysis

Looking at `src/bridge/client.ts` and the Python server, the timeout is set in the client:

```typescript
// client.ts - probable location
const TIMEOUT_MS = 300000; // 5 minutes
```

When timeout fires:
1. Client kills the socket connection
2. Python server may still be generating
3. Any generated audio in Python's memory is lost
4. Temp files (if any) are orphaned

### State During Generation

| State | Location | Persistence |
|-------|----------|-------------|
| Text chunks | Python memory | Lost on crash |
| Generated audio | Python memory | Lost on crash |
| Partial concatenation | Python memory | Lost on crash |
| Temp files | /tmp | Orphaned on crash |

**Problem**: All state is in-memory with no checkpointing. A 4-minute generation that fails at minute 4.5 loses everything.

### Design Options

**Option A: Configurable timeout**
- Pro: Simple
- Con: Doesn't solve the fundamental problem of lost work

**Option B: Checkpoint to disk during generation**
- Pro: Can resume from checkpoint
- Con: Adds disk I/O to hot path, complexity

**Option C: Progressive output (stream chunks to file as generated)**
- Pro: Partial work always saved
- Con: Requires restructuring output handling

**Option D: Auto-chunking with per-chunk output**
- Pro: Each chunk saved independently, natural resume point
- Con: User needs to concatenate, changes output semantics

**Recommendation**: Combine A + C. Configurable timeout with progressive output. Each chunk is saved to disk as generated, so timeout/crash loses at most one chunk.

---

## Implementation Plan

### Design Principles Applied

1. **State is the problem** — Minimize in-memory state, persist early
2. **Decide failure modes explicitly** — Timeout should fail gracefully with partial output
3. **Every automated system needs a killswitch** — Timeout itself is a killswitch for runaway generation

### Approach

1. Add `--timeout` flag (default: 300s, 0 = no timeout)
2. Save each chunk to disk as it's generated in Python
3. On timeout, concatenate whatever chunks exist and return partial result
4. Report partial completion vs full completion in result

### Protocol Extension

```json
// Success response
{
  "id": "1",
  "result": {
    "audio_path": "/tmp/speak_123.wav",
    "duration": 45.2,
    "complete": true,
    "chunks_generated": 12,
    "chunks_total": 12
  }
}

// Partial response (timeout/error mid-generation)
{
  "id": "1",
  "result": {
    "audio_path": "/tmp/speak_123_partial.wav",
    "duration": 30.1,
    "complete": false,
    "chunks_generated": 8,
    "chunks_total": 12,
    "reason": "timeout"
  }
}
```

### Code Changes

**File: `src/index.ts`** (add timeout flag)

```typescript
.option("--timeout <seconds>", "Generation timeout in seconds (0 = no timeout)", "300")
```

**File: `src/bridge/client.ts`** (configurable timeout, handle partial)

```typescript
export interface GenerateOptions {
  text: string;
  model?: string;
  temperature?: number;
  speed?: number;
  voice?: string;
  timeoutMs?: number;
  onProgress?: (progress: GenerateProgress) => void;
}

export interface GenerateResult {
  audio_path: string;
  duration: number;
  rtf: number;
  complete: boolean;
  chunksGenerated: number;
  chunksTotal: number;
  reason?: string;
}

export async function generate(options: GenerateOptions): Promise<GenerateResult> {
  const { timeoutMs = 300000, onProgress, ...params } = options;
  
  const socket = await connectToServer();
  const requestId = `gen-${Date.now()}`;
  
  // Set up timeout with cleanup
  let timeoutHandle: Timer | null = null;
  
  if (timeoutMs > 0) {
    timeoutHandle = setTimeout(() => {
      // Send abort signal to server
      socket.write(JSON.stringify({
        id: requestId,
        method: 'abort',
        params: { save_partial: true },
      }) + '\n');
    }, timeoutMs);
  }
  
  try {
    await sendRequest(socket, {
      id: requestId,
      method: 'generate',
      params,
    });
    
    for await (const message of readJsonLines(socket)) {
      if (message.id !== requestId) continue;
      
      if (message.progress && onProgress) {
        onProgress(message.progress);
      }
      
      if (message.result) {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        socket.destroy();
        return message.result;
      }
      
      if (message.error) {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        socket.destroy();
        throw new Error(message.error.message);
      }
    }
    
    throw new Error('Connection closed without result');
    
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}
```

**File: `src/python/server.py`** (progressive saving, abort handling)

```python
import os
import signal
import tempfile
from pathlib import Path

class GenerationContext:
    """Manages state for a single generation request."""
    
    def __init__(self, request_id: str, temp_dir: str):
        self.request_id = request_id
        self.temp_dir = temp_dir
        self.chunk_files: list[str] = []
        self.aborted = False
        self.abort_reason: str | None = None
    
    def save_chunk(self, chunk_index: int, audio: np.ndarray) -> str:
        """Save a single chunk to disk immediately."""
        chunk_path = os.path.join(self.temp_dir, f'chunk_{chunk_index:04d}.wav')
        save_wav(chunk_path, audio)
        self.chunk_files.append(chunk_path)
        return chunk_path
    
    def concatenate_chunks(self) -> str:
        """Concatenate all saved chunks into final output."""
        if not self.chunk_files:
            raise ValueError('No chunks to concatenate')
        
        # Load and concatenate
        segments = [load_wav(f) for f in self.chunk_files]
        combined = np.concatenate(segments)
        
        # Save final
        suffix = '_partial' if self.aborted else ''
        output_path = os.path.join(self.temp_dir, f'output{suffix}.wav')
        save_wav(output_path, combined)
        
        # Cleanup chunk files
        for f in self.chunk_files:
            try:
                os.unlink(f)
            except:
                pass
        
        return output_path
    
    def abort(self, reason: str = 'abort'):
        """Signal abort, save what we have."""
        self.aborted = True
        self.abort_reason = reason


# Global registry of active generations (for abort handling)
active_generations: dict[str, GenerationContext] = {}


def handle_generate(conn, request):
    """Handle generate request with progressive saving."""
    request_id = request.get('id')
    params = request.get('params', {})
    text = params.get('text', '')
    
    # Create temp directory for this generation
    temp_dir = tempfile.mkdtemp(prefix='speak_')
    ctx = GenerationContext(request_id, temp_dir)
    active_generations[request_id] = ctx
    
    try:
        chunks = chunk_text(text)
        total_chunks = len(chunks)
        
        for i, chunk_text in enumerate(chunks):
            # Check for abort
            if ctx.aborted:
                break
            
            # Send progress
            send_progress(conn, request_id, i + 1, total_chunks, chunk_text)
            
            # Generate audio
            audio = generate_audio(chunk_text, params)
            
            # Save immediately (progressive)
            ctx.save_chunk(i, audio)
        
        # Concatenate whatever we have
        output_path = ctx.concatenate_chunks()
        duration = get_audio_duration(output_path)
        
        result = {
            'id': request_id,
            'result': {
                'audio_path': output_path,
                'duration': duration,
                'rtf': calculate_rtf(),
                'complete': not ctx.aborted,
                'chunks_generated': len(ctx.chunk_files),
                'chunks_total': total_chunks,
                'reason': ctx.abort_reason,
            }
        }
        send_json(conn, result)
        
    finally:
        del active_generations[request_id]


def handle_abort(conn, request):
    """Handle abort request - signal generation to stop."""
    request_id = request.get('params', {}).get('target_id', request.get('id'))
    save_partial = request.get('params', {}).get('save_partial', True)
    
    if request_id in active_generations:
        ctx = active_generations[request_id]
        ctx.abort('client_timeout' if save_partial else 'client_abort')
        
        send_json(conn, {
            'id': request.get('id'),
            'result': {'acknowledged': True},
        })
    else:
        send_json(conn, {
            'id': request.get('id'),
            'error': {'message': 'No active generation with that ID'},
        })
```

**File: `src/index.ts`** (handle partial results in UI)

```typescript
// After generate() returns:

if (!options.quiet) {
  if (result.complete) {
    console.log(pc.green(`✓ Generated ${result.duration.toFixed(1)}s of audio`));
  } else {
    console.log(pc.yellow(`⚠ Partial generation: ${result.duration.toFixed(1)}s of audio`));
    console.log(pc.yellow(`  Generated ${result.chunksGenerated}/${result.chunksTotal} chunks`));
    console.log(pc.yellow(`  Reason: ${result.reason || 'unknown'}`));
  }
  console.log(pc.dim(`  Output: ${outputPath}`));
}
```

### Test Cases

```typescript
// test/integration/timeout.test.ts

describe('Timeout handling', () => {
  it('returns partial result on timeout', async () => {
    // Create long text that takes >5s to generate
    const longText = 'Long text... '.repeat(1000);
    
    const result = await generate({
      text: longText,
      timeoutMs: 2000, // 2 second timeout
    });
    
    expect(result.complete).toBe(false);
    expect(result.chunksGenerated).toBeGreaterThan(0);
    expect(result.chunksGenerated).toBeLessThan(result.chunksTotal);
    expect(result.reason).toBe('client_timeout');
    
    // Verify partial audio file exists and is valid
    expect(existsSync(result.audio_path)).toBe(true);
    expect(result.duration).toBeGreaterThan(0);
  });
  
  it('completes fully when timeout is sufficient', async () => {
    const result = await generate({
      text: 'Short text',
      timeoutMs: 60000,
    });
    
    expect(result.complete).toBe(true);
    expect(result.chunksGenerated).toBe(result.chunksTotal);
  });
  
  it('respects timeout=0 as no timeout', async () => {
    // This test would need a mock or very short text
    const result = await generate({
      text: 'Test',
      timeoutMs: 0,
    });
    
    expect(result.complete).toBe(true);
  });
});
```

### Failure Modes

| Scenario | Handling |
|----------|----------|
| Timeout with 0 chunks | Return error, no partial file |
| Disk full during chunk save | Fail immediately, report disk error |
| Server crash mid-generation | Orphaned temp files, client sees connection error |
| Client disconnect | Server completes generation anyway (waste, but safe) |

### Cleanup Strategy

Temp directory cleanup:
- On success: cleanup after concatenation
- On partial: keep output file, cleanup chunks
- On server restart: cleanup orphaned temp dirs older than 1 hour

```python
# In server startup
def cleanup_old_temp_dirs():
    """Remove orphaned temp directories from crashed generations."""
    temp_base = tempfile.gettempdir()
    cutoff = time.time() - 3600  # 1 hour
    
    for entry in os.listdir(temp_base):
        if entry.startswith('speak_'):
            path = os.path.join(temp_base, entry)
            if os.path.isdir(path) and os.stat(path).st_mtime < cutoff:
                shutil.rmtree(path, ignore_errors=True)
```

### Rollout

1. Implement progressive chunk saving in Python
2. Add abort handling protocol
3. Update client with timeout configuration
4. Add `--timeout` CLI flag
5. Update UI to handle partial results
6. Test with various timeout values
7. Release

### Verification

```bash
# Test timeout with partial output
speak very-large-document.md --timeout 30

# Should output:
# ⚠ Partial generation: 25.3s of audio
#   Generated 4/15 chunks
#   Reason: client_timeout
#   Output: ~/Audio/speak/speak_2025-12-31_120000_partial.wav
```
