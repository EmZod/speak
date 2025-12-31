# Speak TTS: Production Implementation Plan

**Version:** 1.0  
**Date:** December 31, 2025  
**Status:** Ready for Implementation

---

## Executive Summary

Speak is a CLI tool that converts text to speech using Chatterbox TTS on Apple Silicon. The current implementation works but has architectural issues that prevent it from being reliable infrastructure for agents.

This plan transforms speak from a development prototype into production-grade agent infrastructure while preserving its full configuration surface area.

### Core Philosophy

```
┌─────────────────────────────────────────────────────────────────┐
│  SKILL.md (Agent-Facing Interface)                              │
│  ────────────────────────────────                               │
│  Simple, opinionated, 3-4 commands max                          │
│  "speak generates audio. Here's how to use it."                 │
│  Hides complexity, picks good defaults                          │
│  THIS IS THE PRIMARY DESIGN SURFACE                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  CLI (Power Users / Advanced Agent Use)                         │
│  ──────────────────────────────────────                         │
│  Full configuration surface area preserved                      │
│  Every knob exposed: models, temp, speed, markdown modes,       │
│  voice cloning, code block handling, output formats, etc.       │
│  "Simple things easy, hard things possible"                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Core Infrastructure (This Plan)                                │
│  ──────────────────────────────                                 │
│  Reliable streaming, proper audio playback, clean installation  │
│  Boring, well-tested, never breaks                              │
│  "Good design is self-effacing"                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Goals

1. **Fix streaming architecture** — Eliminate audio gaps, proper state management
2. **Fix installation** — Zero-friction setup for agents and users
3. **Add operational reliability** — Killswitches, health checks, structured logging
4. **Preserve flexibility** — Keep full configuration surface area for power users

### Non-Goals

1. Rewrite in Rust or Swift (unnecessary given bottleneck analysis)
2. Simplify CLI options (configuration richness is a feature)
3. Change the Python/mlx-audio core (already well-optimized)

---

## Part 1: Current State Analysis

### 1.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  CURRENT ARCHITECTURE                                                        │
│                                                                              │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐  │
│  │   Bun CLI   │───▶│   Bridge    │───▶│   Python    │───▶│   afplay    │  │
│  │  (index.ts) │    │  (client.ts)│    │  (server.py)│    │  (N times)  │  │
│  └─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘  │
│                           │                  │                   │          │
│                     Unix Socket         WAV Files           Subprocess      │
│                     JSON Lines          to /tmp             per chunk       │
│                                                                              │
│  PROBLEMS:                                                                   │
│  1. Three processes own playback state (violates single-owner principle)    │
│  2. File I/O for every chunk (unnecessary latency)                          │
│  3. afplay can't stream (gaps between chunks)                               │
│  4. No explicit state machine (race conditions)                             │
│  5. No killswitch (runaway processes)                                       │
│  6. Installation requires pip install (45+ seconds, often fails)            │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 State Inventory

| State | Location | Owner | Change Frequency | Staleness Tolerance | Failure Impact |
|-------|----------|-------|------------------|---------------------|----------------|
| TTS Model weights | HuggingFace cache → GPU memory | Python server | Never (after load) | N/A | Total failure |
| Configuration | `~/.chatter/config.toml` | User | Rare | Indefinite | Minor (defaults work) |
| Python venv | `~/.chatter/env/` | Setup process | Rare | Indefinite | Total failure |
| Daemon PID | `~/.chatter/speak.pid` | Daemon manager | Per session | 0 (must be accurate) | Stale socket issues |
| Unix socket | `~/.chatter/speak.sock` | Python server | Per session | 0 | Connection failures |
| Audio chunks | `/tmp/` files | Python server | Per generation | 0 | Playback gaps |
| Chunk queue | In-memory (Bun) | CLI process | Per generation | 0 | Lost audio |
| Playback position | In-memory (afplay) | OS subprocess | Continuous | 0 | Audio corruption |

**Critical Issue:** Streaming has three separate state owners for a single logical operation (audio playback). This violates the "one owner, one writer" principle and causes race conditions.

### 1.3 Hot Paths

**Hot Path 1: TTS Generation (GPU-bound)**
```
Text → Python → mlx-audio → MLX → Metal GPU → Audio samples
```
- Volume: 100% of requests
- Latency: ~0.35x real-time on M1 Max (already optimal)
- Bottleneck: Model cold start (~3.5s), addressed by daemon mode
- **Status: Already optimized, do not touch**

**Hot Path 2: Audio Playback (I/O-bound, streaming)**
```
Audio samples → Buffer → Audio device → User's ears
```
- Volume: 100% of `--stream` and `--play` requests
- Latency: User notices >50ms gaps
- Bottleneck: afplay subprocess spawning, file I/O
- **Status: Broken, primary focus of this plan**

### 1.4 Failure Mode Analysis

| Component | Failure Mode | Blast Radius | Current Handling | Required Handling |
|-----------|--------------|--------------|------------------|-------------------|
| Python server | Crash | Request fails | Error message | Fail closed, retry once |
| Python server | Timeout | Request hangs | 10min timeout | Reduce to 60s, fail fast |
| Model load | OOM | Server crash | None | Fail closed, log memory |
| Unix socket | Stale | Connection refused | Manual cleanup | Auto-cleanup on start |
| afplay | Not found | No audio | Error thrown | Detect at startup |
| Disk | Full | Write fails | Uncaught | Check before write |
| Generation | Partial failure | Incomplete audio | Hangs | Play partial, report error |

---

## Part 2: Target Architecture

### 2.1 Design Principles

These principles guide all decisions in this plan:

1. **One owner, one writer** — Each piece of state has exactly one service that can write to it
2. **State is the problem** — Minimize stateful components, be paranoid about state
3. **Simple and boring** — Use well-tested primitives, avoid clever tricks
4. **Hot paths first** — Design the critical paths before everything else
5. **Decide failure modes explicitly** — Every dependency has a fail-open or fail-closed decision
6. **Every automated system needs a killswitch** — Feature flags that disable runaway operations
7. **Log the decisions** — Every branch in critical paths logs what condition was hit
8. **Operations are part of the design** — How to deploy, rollback, debug, and know it's broken

### 2.2 Target Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  TARGET ARCHITECTURE                                                         │
│                                                                              │
│  BUN PROCESS (Single Owner of Client-Side State)                            │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                         STATE MACHINE                                 │   │
│  │                                                                       │   │
│  │   IDLE ──▶ BUFFERING ──▶ PLAYING ◀──▶ REBUFFERING ──▶ DRAINING ──▶ DONE │
│  │                                                                       │   │
│  │   Every transition logged with context                                │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│              │                    │                                          │
│              ▼                    ▼                                          │
│  ┌─────────────────┐   ┌─────────────────────┐                              │
│  │   Ring Buffer   │   │   Audio Thread      │                              │
│  │   (10s @ 24kHz) │──▶│   (native, pulls    │                              │
│  │   240,000 f32   │   │    from buffer)     │                              │
│  └─────────────────┘   └─────────────────────┘                              │
│         ▲                                                                    │
│         │ Binary PCM stream (no files)                                       │
│         │                                                                    │
│  ┌──────┴───────────────────────────────────────────────────────────────┐   │
│  │  UNIX SOCKET (Binary Protocol)                                        │   │
│  │  [magic:4][id:4][count:4][rate:4][samples:f32[]]                      │   │
│  └──────▲───────────────────────────────────────────────────────────────┘   │
│         │                                                                    │
└─────────┼────────────────────────────────────────────────────────────────────┘
          │
┌─────────┴────────────────────────────────────────────────────────────────────┐
│  PYTHON PROCESS (Single Owner of Generation State)                           │
│                                                                              │
│  ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────────────┐    │
│  │   Text Input    │──▶│   mlx-audio     │──▶│   Binary PCM Output     │    │
│  │   (JSON request)│   │   generate()    │   │   (direct to socket)    │    │
│  └─────────────────┘   └─────────────────┘   └─────────────────────────┘    │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  KILLSWITCH CHECK AT ENTRY TO EVERY OPERATION                        │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 2.3 Key Changes

| Aspect | Current | Target |
|--------|---------|--------|
| State ownership | 3 owners (Bun, Python, afplay) | 2 owners (Bun for playback, Python for generation) |
| Audio output | afplay subprocess per chunk | In-process streaming audio |
| Data transfer | WAV files on disk | Binary PCM over socket |
| Buffering | Queue of file paths | Ring buffer of samples |
| State management | Implicit in control flow | Explicit state machine |
| Gap between chunks | 50-100ms | 0ms (gapless) |
| Error handling | Implicit/inconsistent | Explicit fail-open/fail-closed |
| Observability | Basic console logs | Structured JSON logs with decisions |
| Cancellation | pkill afplay | Clean state transition |

---

## Part 3: Implementation Phases

### Phase 0: Operational Foundation (Day 1)

**Goal:** Add the operational primitives that make everything else debuggable.

#### 0.1 Killswitch

Every automated operation must check a killswitch before proceeding.

```typescript
// src/core/killswitch.ts

import { existsSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { CHATTER_DIR } from './config';

const KILLSWITCH_FILE = join(CHATTER_DIR, '.killswitch');

/**
 * Check if the killswitch is engaged
 */
export function isKillswitchEngaged(): boolean {
  return existsSync(KILLSWITCH_FILE);
}

/**
 * Check killswitch and throw if engaged
 * Call this at the entry to every operation
 */
export function checkKillswitch(operation: string): void {
  if (isKillswitchEngaged()) {
    throw new Error(
      `Operation "${operation}" is disabled by killswitch. ` +
      `Remove ${KILLSWITCH_FILE} to re-enable.`
    );
  }
}

/**
 * Engage the killswitch (for emergency stops)
 */
export function engageKillswitch(reason: string): void {
  writeFileSync(KILLSWITCH_FILE, JSON.stringify({
    engaged_at: new Date().toISOString(),
    reason,
  }));
}

/**
 * Disengage the killswitch
 */
export function disengageKillswitch(): void {
  if (existsSync(KILLSWITCH_FILE)) {
    unlinkSync(KILLSWITCH_FILE);
  }
}
```

**Usage in every operation:**

```typescript
// In src/index.ts, at the start of the main action
checkKillswitch('generate');

// In src/bridge/daemon.ts
checkKillswitch('daemon-start');

// In streaming code
checkKillswitch('stream');
```

#### 0.2 Structured Logging with Decisions

Replace ad-hoc logging with structured decision logging.

```typescript
// src/ui/logger.ts (enhanced)

interface LogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  context?: Record<string, unknown>;
  decision?: {
    what: string;
    why: string;
    alternatives_considered?: string[];
  };
}

/**
 * Log a decision point in critical code paths
 */
export function logDecision(
  what: string,
  why: string,
  context?: Record<string, unknown>
): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level: 'info',
    message: `Decision: ${what}`,
    context,
    decision: { what, why },
  };
  
  writeToFile(entry);
  
  if (shouldLogToConsole('info')) {
    console.log(formatConsole('info', `Decision: ${what} (${why})`));
  }
}

// Example usage:
logDecision(
  'Entering rebuffer state',
  'Buffer dropped below minimum threshold',
  {
    buffered_seconds: 0.8,
    min_threshold: 1.0,
    chunks_pending: 2,
    generation_complete: false,
  }
);

logDecision(
  'Skipping markdown processing',
  'Input does not appear to be markdown',
  {
    text_length: 50,
    markdown_indicators_found: 0,
  }
);

logDecision(
  'Using cached model',
  'Model already loaded in daemon',
  {
    model_name: 'mlx-community/chatterbox-turbo-8bit',
    load_time_saved_ms: 3500,
  }
);
```

#### 0.3 Health Check System

Comprehensive health check that answers "how do you know it's broken?"

```typescript
// src/core/health.ts

import { existsSync, statSync } from 'fs';
import { CHATTER_DIR, SOCKET_PATH, VENV_PYTHON } from './config';
import { isServerRunning, checkHealth as checkServerHealth } from '../bridge/client';

export interface HealthCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
  details?: Record<string, unknown>;
}

export interface HealthReport {
  overall: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  checks: HealthCheck[];
  summary: string;
}

export async function runHealthChecks(): Promise<HealthReport> {
  const checks: HealthCheck[] = [];
  
  // Check 1: Python environment
  checks.push(await checkPythonEnvironment());
  
  // Check 2: Disk space
  checks.push(await checkDiskSpace());
  
  // Check 3: Socket accessibility
  checks.push(await checkSocket());
  
  // Check 4: Server health (if running)
  checks.push(await checkServer());
  
  // Check 5: Audio device
  checks.push(await checkAudioDevice());
  
  // Check 6: Killswitch status
  checks.push(checkKillswitchStatus());
  
  // Determine overall status
  const failCount = checks.filter(c => c.status === 'fail').length;
  const warnCount = checks.filter(c => c.status === 'warn').length;
  
  let overall: 'healthy' | 'degraded' | 'unhealthy';
  if (failCount > 0) {
    overall = 'unhealthy';
  } else if (warnCount > 0) {
    overall = 'degraded';
  } else {
    overall = 'healthy';
  }
  
  const summary = checks
    .filter(c => c.status !== 'pass')
    .map(c => c.message)
    .join('; ') || 'All systems operational';
  
  return {
    overall,
    timestamp: new Date().toISOString(),
    checks,
    summary,
  };
}

async function checkPythonEnvironment(): Promise<HealthCheck> {
  if (!existsSync(VENV_PYTHON)) {
    return {
      name: 'python_environment',
      status: 'fail',
      message: 'Python environment not found. Run: speak setup',
    };
  }
  
  // Verify Python actually works
  try {
    const { execSync } = await import('child_process');
    execSync(`${VENV_PYTHON} -c "import mlx_audio"`, { timeout: 5000 });
    return {
      name: 'python_environment',
      status: 'pass',
      message: 'Python environment is valid',
    };
  } catch (error) {
    return {
      name: 'python_environment',
      status: 'fail',
      message: 'Python environment is broken. Run: speak setup --force',
      details: { error: String(error) },
    };
  }
}

async function checkDiskSpace(): Promise<HealthCheck> {
  try {
    const { execSync } = await import('child_process');
    const output = execSync(`df -m "${CHATTER_DIR}" | tail -1 | awk '{print $4}'`);
    const freeMB = parseInt(output.toString().trim(), 10);
    
    if (freeMB < 100) {
      return {
        name: 'disk_space',
        status: 'fail',
        message: `Critical: Only ${freeMB}MB free disk space`,
        details: { free_mb: freeMB },
      };
    } else if (freeMB < 500) {
      return {
        name: 'disk_space',
        status: 'warn',
        message: `Low disk space: ${freeMB}MB free`,
        details: { free_mb: freeMB },
      };
    }
    
    return {
      name: 'disk_space',
      status: 'pass',
      message: `${freeMB}MB free disk space`,
      details: { free_mb: freeMB },
    };
  } catch {
    return {
      name: 'disk_space',
      status: 'warn',
      message: 'Could not check disk space',
    };
  }
}

async function checkSocket(): Promise<HealthCheck> {
  if (!existsSync(SOCKET_PATH)) {
    return {
      name: 'socket',
      status: 'pass',
      message: 'Socket not present (server not running)',
    };
  }
  
  // Check if socket is stale
  const stat = statSync(SOCKET_PATH);
  const ageMs = Date.now() - stat.mtimeMs;
  const ageHours = ageMs / (1000 * 60 * 60);
  
  if (ageHours > 24) {
    return {
      name: 'socket',
      status: 'warn',
      message: 'Socket file is stale (>24h old)',
      details: { age_hours: ageHours.toFixed(1) },
    };
  }
  
  return {
    name: 'socket',
    status: 'pass',
    message: 'Socket file present',
  };
}

async function checkServer(): Promise<HealthCheck> {
  try {
    const running = await isServerRunning();
    if (!running) {
      return {
        name: 'server',
        status: 'pass',
        message: 'Server not running (will start on demand)',
      };
    }
    
    const health = await checkServerHealth();
    return {
      name: 'server',
      status: 'pass',
      message: `Server running, model: ${health.model_loaded || 'none'}`,
      details: health,
    };
  } catch (error) {
    return {
      name: 'server',
      status: 'warn',
      message: 'Server health check failed',
      details: { error: String(error) },
    };
  }
}

async function checkAudioDevice(): Promise<HealthCheck> {
  try {
    const { execSync } = await import('child_process');
    // Check if afplay exists (current implementation)
    execSync('which afplay', { timeout: 1000 });
    return {
      name: 'audio_device',
      status: 'pass',
      message: 'Audio playback available',
    };
  } catch {
    return {
      name: 'audio_device',
      status: 'fail',
      message: 'Audio playback not available (afplay not found)',
    };
  }
}

function checkKillswitchStatus(): HealthCheck {
  if (isKillswitchEngaged()) {
    return {
      name: 'killswitch',
      status: 'warn',
      message: 'Killswitch is engaged - operations disabled',
    };
  }
  return {
    name: 'killswitch',
    status: 'pass',
    message: 'Killswitch not engaged',
  };
}
```

#### 0.4 CLI Integration

Add health check command:

```typescript
// In src/index.ts, add new subcommand

program
  .command('health')
  .description('Check system health')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const { runHealthChecks } = await import('./core/health');
    const report = await runHealthChecks();
    
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      const statusIcon = {
        healthy: pc.green('✓'),
        degraded: pc.yellow('⚠'),
        unhealthy: pc.red('✗'),
      };
      
      console.log(`\n${statusIcon[report.overall]} System: ${report.overall.toUpperCase()}\n`);
      
      for (const check of report.checks) {
        const icon = check.status === 'pass' ? pc.green('✓') :
                     check.status === 'warn' ? pc.yellow('⚠') :
                     pc.red('✗');
        console.log(`  ${icon} ${check.name}: ${check.message}`);
      }
      
      console.log();
    }
    
    process.exit(report.overall === 'unhealthy' ? 1 : 0);
  });
```

---

### Phase 1: Ring Buffer and State Machine (Days 2-3)

**Goal:** Create the foundational data structures for reliable streaming.

#### 1.1 Ring Buffer Implementation

```typescript
// src/audio/ring-buffer.ts

/**
 * Lock-free single-producer single-consumer ring buffer for audio samples.
 * 
 * Design decisions:
 * - Fixed size (avoids allocation during playback)
 * - Float32 samples (matches mlx-audio output)
 * - Fills with silence on underrun (graceful degradation)
 * - Reports underruns for observability
 */
export class RingBuffer {
  private buffer: Float32Array;
  private writePos = 0;
  private readPos = 0;
  private _underrunSamples = 0;
  
  constructor(
    public readonly durationSeconds: number,
    public readonly sampleRate: number = 24000
  ) {
    // +1 sample to distinguish full from empty
    const capacity = Math.ceil(durationSeconds * sampleRate);
    this.buffer = new Float32Array(capacity + 1);
  }
  
  /**
   * Number of samples available to read
   */
  get availableRead(): number {
    const write = this.writePos;
    const read = this.readPos;
    
    if (write >= read) {
      return write - read;
    }
    return this.buffer.length - read + write;
  }
  
  /**
   * Number of samples that can be written
   */
  get availableWrite(): number {
    return this.capacity - this.availableRead;
  }
  
  /**
   * Total capacity in samples
   */
  get capacity(): number {
    return this.buffer.length - 1;
  }
  
  /**
   * Buffered audio duration in seconds
   */
  get bufferedSeconds(): number {
    return this.availableRead / this.sampleRate;
  }
  
  /**
   * Total samples lost to underrun (silence inserted)
   */
  get underrunSamples(): number {
    return this._underrunSamples;
  }
  
  /**
   * Whether buffer is completely full
   */
  get isFull(): boolean {
    return this.availableWrite === 0;
  }
  
  /**
   * Whether buffer is completely empty
   */
  get isEmpty(): boolean {
    return this.availableRead === 0;
  }
  
  /**
   * Write samples to buffer.
   * Returns number of samples actually written (may be less than input if full).
   */
  write(samples: Float32Array): number {
    const toWrite = Math.min(samples.length, this.availableWrite);
    
    for (let i = 0; i < toWrite; i++) {
      this.buffer[this.writePos] = samples[i];
      this.writePos = (this.writePos + 1) % this.buffer.length;
    }
    
    return toWrite;
  }
  
  /**
   * Read samples from buffer into output array.
   * Returns number of samples actually read.
   * Fills remainder with silence if buffer underruns.
   */
  read(output: Float32Array): number {
    const toRead = Math.min(output.length, this.availableRead);
    
    // Read available samples
    for (let i = 0; i < toRead; i++) {
      output[i] = this.buffer[this.readPos];
      this.readPos = (this.readPos + 1) % this.buffer.length;
    }
    
    // Fill remainder with silence (underrun)
    const silenceSamples = output.length - toRead;
    if (silenceSamples > 0) {
      for (let i = toRead; i < output.length; i++) {
        output[i] = 0;
      }
      this._underrunSamples += silenceSamples;
    }
    
    return toRead;
  }
  
  /**
   * Clear all data from buffer
   */
  clear(): void {
    this.writePos = 0;
    this.readPos = 0;
    this._underrunSamples = 0;
  }
  
  /**
   * Get buffer statistics for logging
   */
  getStats(): Record<string, number> {
    return {
      capacity_samples: this.capacity,
      capacity_seconds: this.capacity / this.sampleRate,
      available_read_samples: this.availableRead,
      available_read_seconds: this.bufferedSeconds,
      available_write_samples: this.availableWrite,
      underrun_samples: this._underrunSamples,
      underrun_seconds: this._underrunSamples / this.sampleRate,
    };
  }
}
```

#### 1.2 State Machine Implementation

```typescript
// src/streaming/state-machine.ts

import { logDecision } from '../ui/logger';

/**
 * Streaming states
 */
export enum StreamState {
  /** Initial state, waiting to start */
  IDLE = 'IDLE',
  
  /** Accumulating initial buffer before playback */
  BUFFERING = 'BUFFERING',
  
  /** Actively playing audio */
  PLAYING = 'PLAYING',
  
  /** Paused playback due to low buffer, waiting for more data */
  REBUFFERING = 'REBUFFERING',
  
  /** Generation complete, playing remaining buffer */
  DRAINING = 'DRAINING',
  
  /** Playback complete */
  FINISHED = 'FINISHED',
  
  /** Error occurred */
  ERROR = 'ERROR',
}

/**
 * Events that trigger state transitions
 */
export type StreamEvent =
  | { type: 'START' }
  | { type: 'CHUNK_RECEIVED'; samples: number; chunkId: number }
  | { type: 'GENERATION_COMPLETE'; totalChunks: number }
  | { type: 'GENERATION_ERROR'; error: Error }
  | { type: 'BUFFER_LOW'; bufferedSeconds: number }
  | { type: 'BUFFER_OK'; bufferedSeconds: number }
  | { type: 'BUFFER_EMPTY' }
  | { type: 'CANCEL'; reason: string };

/**
 * Configuration for buffer thresholds
 */
export interface StreamConfig {
  /** Seconds of audio to buffer before starting playback */
  initialBufferSeconds: number;
  
  /** Pause playback if buffer drops below this */
  minBufferSeconds: number;
  
  /** Resume playback when buffer reaches this level */
  resumeBufferSeconds: number;
}

export const DEFAULT_STREAM_CONFIG: StreamConfig = {
  initialBufferSeconds: 3.0,
  minBufferSeconds: 1.0,
  resumeBufferSeconds: 2.0,
};

/**
 * State machine for streaming audio playback.
 * 
 * Guarantees:
 * - Every state transition is logged with context
 * - Invalid transitions are logged as errors but don't throw
 * - Terminal states (FINISHED, ERROR) cannot transition
 */
export class StreamStateMachine {
  private _state: StreamState = StreamState.IDLE;
  private readonly listeners = new Set<(state: StreamState, prev: StreamState, event: StreamEvent) => void>();
  private transitionCount = 0;
  
  constructor(
    private readonly config: StreamConfig = DEFAULT_STREAM_CONFIG
  ) {}
  
  get state(): StreamState {
    return this._state;
  }
  
  get transitions(): number {
    return this.transitionCount;
  }
  
  /**
   * Subscribe to state changes
   * Returns unsubscribe function
   */
  onStateChange(
    fn: (state: StreamState, prev: StreamState, event: StreamEvent) => void
  ): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  
  /**
   * Dispatch an event and potentially transition state
   */
  dispatch(event: StreamEvent, context: { bufferedSeconds: number }): StreamState {
    const { bufferedSeconds } = context;
    const prevState = this._state;
    
    // Determine new state based on current state and event
    const newState = this.computeNextState(event, bufferedSeconds);
    
    // Log the event regardless of whether it caused a transition
    if (newState !== prevState) {
      this.transition(newState, event, bufferedSeconds);
    }
    
    return this._state;
  }
  
  private computeNextState(event: StreamEvent, bufferedSeconds: number): StreamState {
    switch (this._state) {
      case StreamState.IDLE:
        if (event.type === 'START') {
          return StreamState.BUFFERING;
        }
        break;
        
      case StreamState.BUFFERING:
        if (event.type === 'CHUNK_RECEIVED') {
          if (bufferedSeconds >= this.config.initialBufferSeconds) {
            return StreamState.PLAYING;
          }
        } else if (event.type === 'GENERATION_COMPLETE') {
          // Short text - didn't reach buffer threshold, play what we have
          return StreamState.DRAINING;
        } else if (event.type === 'GENERATION_ERROR') {
          return StreamState.ERROR;
        } else if (event.type === 'CANCEL') {
          return StreamState.FINISHED;
        }
        break;
        
      case StreamState.PLAYING:
        if (event.type === 'BUFFER_LOW') {
          if (bufferedSeconds < this.config.minBufferSeconds) {
            return StreamState.REBUFFERING;
          }
        } else if (event.type === 'GENERATION_COMPLETE') {
          return StreamState.DRAINING;
        } else if (event.type === 'GENERATION_ERROR') {
          // Keep playing what we have
          return StreamState.DRAINING;
        } else if (event.type === 'CANCEL') {
          return StreamState.FINISHED;
        }
        break;
        
      case StreamState.REBUFFERING:
        if (event.type === 'CHUNK_RECEIVED' || event.type === 'BUFFER_OK') {
          if (bufferedSeconds >= this.config.resumeBufferSeconds) {
            return StreamState.PLAYING;
          }
        } else if (event.type === 'GENERATION_COMPLETE') {
          // Can't get more data, play what we have
          return StreamState.DRAINING;
        } else if (event.type === 'GENERATION_ERROR') {
          return StreamState.DRAINING;
        } else if (event.type === 'CANCEL') {
          return StreamState.FINISHED;
        }
        break;
        
      case StreamState.DRAINING:
        if (event.type === 'BUFFER_EMPTY') {
          return StreamState.FINISHED;
        } else if (event.type === 'CANCEL') {
          return StreamState.FINISHED;
        }
        break;
        
      // Terminal states - no transitions
      case StreamState.FINISHED:
      case StreamState.ERROR:
        break;
    }
    
    return this._state; // No transition
  }
  
  private transition(
    newState: StreamState,
    event: StreamEvent,
    bufferedSeconds: number
  ): void {
    const prevState = this._state;
    this._state = newState;
    this.transitionCount++;
    
    // Log every transition with full context
    logDecision(
      `State transition: ${prevState} → ${newState}`,
      `Event: ${event.type}`,
      {
        transition_number: this.transitionCount,
        from_state: prevState,
        to_state: newState,
        event_type: event.type,
        event_details: event,
        buffered_seconds: bufferedSeconds,
        config: this.config,
      }
    );
    
    // Notify listeners
    this.listeners.forEach(fn => fn(newState, prevState, event));
  }
  
  /**
   * Check if current state is terminal
   */
  isTerminal(): boolean {
    return this._state === StreamState.FINISHED || this._state === StreamState.ERROR;
  }
  
  /**
   * Get state machine statistics for logging
   */
  getStats(): Record<string, unknown> {
    return {
      current_state: this._state,
      transition_count: this.transitionCount,
      is_terminal: this.isTerminal(),
      config: this.config,
    };
  }
}
```

#### 1.3 Unit Tests for Ring Buffer and State Machine

```typescript
// test/ring-buffer.test.ts

import { describe, it, expect } from 'bun:test';
import { RingBuffer } from '../src/audio/ring-buffer';

describe('RingBuffer', () => {
  it('reports correct initial state', () => {
    const buffer = new RingBuffer(1, 100); // 1 second at 100Hz = 100 samples
    
    expect(buffer.capacity).toBe(100);
    expect(buffer.availableRead).toBe(0);
    expect(buffer.availableWrite).toBe(100);
    expect(buffer.isEmpty).toBe(true);
    expect(buffer.isFull).toBe(false);
  });
  
  it('writes and reads samples correctly', () => {
    const buffer = new RingBuffer(1, 100);
    const input = new Float32Array([1, 2, 3, 4, 5]);
    
    const written = buffer.write(input);
    expect(written).toBe(5);
    expect(buffer.availableRead).toBe(5);
    
    const output = new Float32Array(5);
    const read = buffer.read(output);
    
    expect(read).toBe(5);
    expect(Array.from(output)).toEqual([1, 2, 3, 4, 5]);
    expect(buffer.isEmpty).toBe(true);
  });
  
  it('handles wrap-around correctly', () => {
    const buffer = new RingBuffer(0.05, 100); // 5 samples capacity
    
    // Write 3 samples
    buffer.write(new Float32Array([1, 2, 3]));
    
    // Read 2 samples
    const out1 = new Float32Array(2);
    buffer.read(out1);
    expect(Array.from(out1)).toEqual([1, 2]);
    
    // Write 4 more samples (wraps around)
    buffer.write(new Float32Array([4, 5, 6, 7]));
    
    // Read all 5 samples
    const out2 = new Float32Array(5);
    const read = buffer.read(out2);
    
    expect(read).toBe(5);
    expect(Array.from(out2)).toEqual([3, 4, 5, 6, 7]);
  });
  
  it('fills with silence on underrun', () => {
    const buffer = new RingBuffer(1, 100);
    buffer.write(new Float32Array([1, 2]));
    
    const output = new Float32Array(5);
    const read = buffer.read(output);
    
    expect(read).toBe(2);
    expect(Array.from(output)).toEqual([1, 2, 0, 0, 0]);
    expect(buffer.underrunSamples).toBe(3);
  });
  
  it('respects capacity limit', () => {
    const buffer = new RingBuffer(0.05, 100); // 5 samples
    const input = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]);
    
    const written = buffer.write(input);
    
    expect(written).toBe(5);
    expect(buffer.isFull).toBe(true);
  });
  
  it('calculates buffered seconds correctly', () => {
    const buffer = new RingBuffer(10, 24000); // 10 seconds at 24kHz
    buffer.write(new Float32Array(48000)); // 2 seconds worth
    
    expect(buffer.bufferedSeconds).toBeCloseTo(2.0, 5);
  });
});

// test/state-machine.test.ts

import { describe, it, expect } from 'bun:test';
import { StreamStateMachine, StreamState, DEFAULT_STREAM_CONFIG } from '../src/streaming/state-machine';

describe('StreamStateMachine', () => {
  it('starts in IDLE state', () => {
    const sm = new StreamStateMachine();
    expect(sm.state).toBe(StreamState.IDLE);
  });
  
  it('transitions IDLE → BUFFERING on START', () => {
    const sm = new StreamStateMachine();
    sm.dispatch({ type: 'START' }, { bufferedSeconds: 0 });
    expect(sm.state).toBe(StreamState.BUFFERING);
  });
  
  it('transitions BUFFERING → PLAYING when buffer threshold reached', () => {
    const config = { ...DEFAULT_STREAM_CONFIG, initialBufferSeconds: 2.0 };
    const sm = new StreamStateMachine(config);
    
    sm.dispatch({ type: 'START' }, { bufferedSeconds: 0 });
    
    // Below threshold - stay in BUFFERING
    sm.dispatch({ type: 'CHUNK_RECEIVED', samples: 24000, chunkId: 0 }, { bufferedSeconds: 1.0 });
    expect(sm.state).toBe(StreamState.BUFFERING);
    
    // At threshold - transition to PLAYING
    sm.dispatch({ type: 'CHUNK_RECEIVED', samples: 24000, chunkId: 1 }, { bufferedSeconds: 2.0 });
    expect(sm.state).toBe(StreamState.PLAYING);
  });
  
  it('transitions PLAYING → REBUFFERING when buffer low', () => {
    const config = { ...DEFAULT_STREAM_CONFIG, minBufferSeconds: 1.0 };
    const sm = new StreamStateMachine(config);
    
    sm.dispatch({ type: 'START' }, { bufferedSeconds: 0 });
    sm.dispatch({ type: 'CHUNK_RECEIVED', samples: 24000, chunkId: 0 }, { bufferedSeconds: 3.0 });
    expect(sm.state).toBe(StreamState.PLAYING);
    
    sm.dispatch({ type: 'BUFFER_LOW', bufferedSeconds: 0.5 }, { bufferedSeconds: 0.5 });
    expect(sm.state).toBe(StreamState.REBUFFERING);
  });
  
  it('transitions REBUFFERING → PLAYING when buffer recovered', () => {
    const config = { 
      ...DEFAULT_STREAM_CONFIG, 
      minBufferSeconds: 1.0,
      resumeBufferSeconds: 2.0,
    };
    const sm = new StreamStateMachine(config);
    
    // Get to REBUFFERING state
    sm.dispatch({ type: 'START' }, { bufferedSeconds: 0 });
    sm.dispatch({ type: 'CHUNK_RECEIVED', samples: 24000, chunkId: 0 }, { bufferedSeconds: 3.0 });
    sm.dispatch({ type: 'BUFFER_LOW', bufferedSeconds: 0.5 }, { bufferedSeconds: 0.5 });
    expect(sm.state).toBe(StreamState.REBUFFERING);
    
    // Still below resume threshold
    sm.dispatch({ type: 'CHUNK_RECEIVED', samples: 24000, chunkId: 1 }, { bufferedSeconds: 1.5 });
    expect(sm.state).toBe(StreamState.REBUFFERING);
    
    // At resume threshold
    sm.dispatch({ type: 'CHUNK_RECEIVED', samples: 24000, chunkId: 2 }, { bufferedSeconds: 2.0 });
    expect(sm.state).toBe(StreamState.PLAYING);
  });
  
  it('transitions to DRAINING when generation complete', () => {
    const sm = new StreamStateMachine();
    
    sm.dispatch({ type: 'START' }, { bufferedSeconds: 0 });
    sm.dispatch({ type: 'CHUNK_RECEIVED', samples: 24000, chunkId: 0 }, { bufferedSeconds: 3.0 });
    sm.dispatch({ type: 'GENERATION_COMPLETE', totalChunks: 1 }, { bufferedSeconds: 3.0 });
    
    expect(sm.state).toBe(StreamState.DRAINING);
  });
  
  it('transitions DRAINING → FINISHED when buffer empty', () => {
    const sm = new StreamStateMachine();
    
    sm.dispatch({ type: 'START' }, { bufferedSeconds: 0 });
    sm.dispatch({ type: 'CHUNK_RECEIVED', samples: 24000, chunkId: 0 }, { bufferedSeconds: 3.0 });
    sm.dispatch({ type: 'GENERATION_COMPLETE', totalChunks: 1 }, { bufferedSeconds: 3.0 });
    sm.dispatch({ type: 'BUFFER_EMPTY' }, { bufferedSeconds: 0 });
    
    expect(sm.state).toBe(StreamState.FINISHED);
    expect(sm.isTerminal()).toBe(true);
  });
  
  it('handles CANCEL from any state', () => {
    const sm = new StreamStateMachine();
    
    sm.dispatch({ type: 'START' }, { bufferedSeconds: 0 });
    sm.dispatch({ type: 'CANCEL', reason: 'User pressed Ctrl+C' }, { bufferedSeconds: 0 });
    
    expect(sm.state).toBe(StreamState.FINISHED);
  });
  
  it('transitions to ERROR on generation error', () => {
    const sm = new StreamStateMachine();
    
    sm.dispatch({ type: 'START' }, { bufferedSeconds: 0 });
    sm.dispatch(
      { type: 'GENERATION_ERROR', error: new Error('Model OOM') },
      { bufferedSeconds: 0.5 }
    );
    
    expect(sm.state).toBe(StreamState.ERROR);
    expect(sm.isTerminal()).toBe(true);
  });
  
  it('calls listeners on state change', () => {
    const sm = new StreamStateMachine();
    const transitions: [StreamState, StreamState][] = [];
    
    sm.onStateChange((state, prev) => {
      transitions.push([prev, state]);
    });
    
    sm.dispatch({ type: 'START' }, { bufferedSeconds: 0 });
    sm.dispatch({ type: 'CHUNK_RECEIVED', samples: 24000, chunkId: 0 }, { bufferedSeconds: 3.0 });
    
    expect(transitions).toEqual([
      [StreamState.IDLE, StreamState.BUFFERING],
      [StreamState.BUFFERING, StreamState.PLAYING],
    ]);
  });
});
```

---

### Phase 2: Streaming Audio Player (Days 4-5)

**Goal:** Replace afplay with in-process streaming audio.

#### 2.1 Stream Player Implementation

```typescript
// src/audio/stream-player.ts

import Speaker from 'speaker';
import { Readable } from 'stream';
import { RingBuffer } from './ring-buffer';
import { logDecision, logger } from '../ui/logger';

export interface StreamPlayerConfig {
  sampleRate: number;
  bufferDurationSeconds: number;
  chunkSamples: number; // Samples per audio callback
}

export const DEFAULT_PLAYER_CONFIG: StreamPlayerConfig = {
  sampleRate: 24000,
  bufferDurationSeconds: 10,
  chunkSamples: 1024, // ~42ms at 24kHz
};

/**
 * Streaming audio player using node-speaker.
 * 
 * Design decisions:
 * - Pull-based: Audio system requests samples when needed
 * - Ring buffer: Decouples generation from playback
 * - Graceful underrun: Inserts silence instead of crashing
 * - Observable: Exposes metrics for debugging
 */
export class StreamPlayer {
  private speaker: Speaker | null = null;
  private readable: Readable | null = null;
  private buffer: RingBuffer;
  private config: StreamPlayerConfig;
  
  private _playing = false;
  private _draining = false;
  private _finished = false;
  
  constructor(config: Partial<StreamPlayerConfig> = {}) {
    this.config = { ...DEFAULT_PLAYER_CONFIG, ...config };
    this.buffer = new RingBuffer(
      this.config.bufferDurationSeconds,
      this.config.sampleRate
    );
  }
  
  /**
   * Current buffer level in seconds
   */
  get bufferedSeconds(): number {
    return this.buffer.bufferedSeconds;
  }
  
  /**
   * Total samples lost to underrun
   */
  get underrunSamples(): number {
    return this.buffer.underrunSamples;
  }
  
  /**
   * Whether playback is active
   */
  get isPlaying(): boolean {
    return this._playing;
  }
  
  /**
   * Whether player has finished
   */
  get isFinished(): boolean {
    return this._finished;
  }
  
  /**
   * Write samples to the buffer.
   * Returns number of samples written (may be less if buffer full).
   */
  write(samples: Float32Array): number {
    return this.buffer.write(samples);
  }
  
  /**
   * Start audio playback.
   * Pulls samples from buffer and sends to audio device.
   */
  start(): void {
    if (this._playing) {
      logger.warn('StreamPlayer.start() called while already playing');
      return;
    }
    
    logDecision(
      'Starting audio playback',
      'Buffer reached initial threshold',
      {
        buffered_seconds: this.buffer.bufferedSeconds,
        sample_rate: this.config.sampleRate,
      }
    );
    
    this.speaker = new Speaker({
      channels: 1,
      bitDepth: 32,
      sampleRate: this.config.sampleRate,
      float: true,
      // Disable automatic closing so we control lifecycle
      // closeOnEnd: false,
    });
    
    const chunkSamples = this.config.chunkSamples;
    const chunk = new Float32Array(chunkSamples);
    
    this.readable = new Readable({
      read: () => {
        // Check if we should stop
        if (!this._playing) {
          this.readable!.push(null);
          return;
        }
        
        // Read from ring buffer
        const samplesRead = this.buffer.read(chunk);
        
        // Check for draining completion
        if (this._draining && this.buffer.isEmpty) {
          logDecision(
            'Audio playback complete',
            'Buffer drained and generation finished',
            {
              total_underrun_samples: this.buffer.underrunSamples,
            }
          );
          this.readable!.push(null);
          this._playing = false;
          this._finished = true;
          return;
        }
        
        // Convert Float32Array to Buffer and push
        const buf = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
        this.readable!.push(buf);
      },
    });
    
    // Handle speaker events
    this.speaker.on('error', (err) => {
      logger.error('Speaker error', { error: err.message });
      this._playing = false;
      this._finished = true;
    });
    
    this.speaker.on('close', () => {
      logger.debug('Speaker closed');
      this._finished = true;
    });
    
    // Start the audio pipeline
    this.readable.pipe(this.speaker);
    this._playing = true;
  }
  
  /**
   * Signal that no more data will be written.
   * Player will finish when buffer is empty.
   */
  startDraining(): void {
    logDecision(
      'Starting audio drain',
      'Generation complete, playing remaining buffer',
      {
        remaining_seconds: this.buffer.bufferedSeconds,
      }
    );
    this._draining = true;
  }
  
  /**
   * Stop playback immediately.
   */
  async stop(): Promise<void> {
    if (!this._playing && !this.speaker) {
      return;
    }
    
    logDecision(
      'Stopping audio playback',
      'Stop requested',
      {
        was_draining: this._draining,
        remaining_seconds: this.buffer.bufferedSeconds,
      }
    );
    
    this._playing = false;
    this._draining = false;
    
    return new Promise((resolve) => {
      if (this.speaker) {
        this.speaker.once('close', () => {
          this.speaker = null;
          this.readable = null;
          this._finished = true;
          resolve();
        });
        this.speaker.close();
      } else {
        this._finished = true;
        resolve();
      }
    });
  }
  
  /**
   * Wait for playback to finish (after draining).
   */
  async waitForFinish(): Promise<void> {
    if (this._finished) return;
    
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (this._finished) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 50);
    });
  }
  
  /**
   * Get player statistics for logging
   */
  getStats(): Record<string, unknown> {
    return {
      playing: this._playing,
      draining: this._draining,
      finished: this._finished,
      buffer: this.buffer.getStats(),
    };
  }
}
```

#### 2.2 Audio Device Detection

```typescript
// src/audio/device.ts

import { logDecision, logger } from '../ui/logger';

/**
 * Check if audio playback is available on this system.
 */
export async function checkAudioAvailable(): Promise<{
  available: boolean;
  method: 'speaker' | 'afplay' | 'none';
  error?: string;
}> {
  // Try node-speaker first (preferred)
  try {
    const Speaker = await import('speaker');
    // Create a test speaker to verify it works
    const testSpeaker = new Speaker.default({
      channels: 1,
      bitDepth: 16,
      sampleRate: 24000,
    });
    testSpeaker.close();
    
    return { available: true, method: 'speaker' };
  } catch (speakerError) {
    logger.debug('node-speaker not available', { error: String(speakerError) });
  }
  
  // Fall back to afplay (macOS only)
  try {
    const { execSync } = await import('child_process');
    execSync('which afplay', { timeout: 1000 });
    
    return { available: true, method: 'afplay' };
  } catch {
    logger.debug('afplay not available');
  }
  
  return {
    available: false,
    method: 'none',
    error: 'No audio playback method available. Install portaudio or use macOS.',
  };
}
```

---

### Phase 3: Binary Protocol (Days 6-7)

**Goal:** Eliminate file I/O between Python and TypeScript.

#### 3.1 Protocol Specification

```
SPEAK BINARY STREAMING PROTOCOL v1
==================================

All integers are little-endian.

CHUNK MESSAGE
-------------
Offset  Size  Type     Description
0       4     bytes    Magic: "SPKR"
4       4     uint32   Chunk ID (0, 1, 2, ...)
8       4     uint32   Sample count
12      4     uint32   Sample rate (typically 24000)
16      N*4   float32  Audio samples (N = sample count)

END MESSAGE
-----------
Offset  Size  Type     Description
0       4     bytes    Magic: "SPKR"
4       4     uint32   0xFFFFFFFF (end marker)
8       4     uint32   Total chunks sent
12      4     uint32   0 (unused)

ERROR MESSAGE
-------------
Offset  Size  Type     Description
0       4     bytes    Magic: "SPKR"
4       4     uint32   0xFFFFFFFE (error marker)
8       4     uint32   Message length (bytes)
12      4     uint32   0 (unused)
16      N     utf8     Error message (N = message length)
```

#### 3.2 Python Binary Writer

```python
# src/python/binary_protocol.py

import struct
import numpy as np
from typing import BinaryIO, Union
import socket

MAGIC = b'SPKR'
END_MARKER = 0xFFFFFFFF
ERROR_MARKER = 0xFFFFFFFE

def write_chunk(
    stream: Union[BinaryIO, socket.socket],
    chunk_id: int,
    samples: np.ndarray,
    sample_rate: int = 24000
) -> None:
    """
    Write an audio chunk to the stream.
    
    Args:
        stream: Socket or file-like object
        chunk_id: Sequential chunk identifier
        samples: Audio samples as numpy array
        sample_rate: Sample rate in Hz
    """
    # Ensure float32
    samples_f32 = samples.astype(np.float32)
    
    # Build header: magic(4) + id(4) + count(4) + rate(4) = 16 bytes
    header = struct.pack('<4sIII', MAGIC, chunk_id, len(samples_f32), sample_rate)
    
    # Get sample bytes
    sample_bytes = samples_f32.tobytes()
    
    # Write atomically if possible
    if hasattr(stream, 'sendall'):
        stream.sendall(header + sample_bytes)
    else:
        stream.write(header)
        stream.write(sample_bytes)
        stream.flush()


def write_end(
    stream: Union[BinaryIO, socket.socket],
    total_chunks: int
) -> None:
    """
    Write end-of-stream marker.
    
    Args:
        stream: Socket or file-like object
        total_chunks: Total number of chunks sent
    """
    header = struct.pack('<4sIII', MAGIC, END_MARKER, total_chunks, 0)
    
    if hasattr(stream, 'sendall'):
        stream.sendall(header)
    else:
        stream.write(header)
        stream.flush()


def write_error(
    stream: Union[BinaryIO, socket.socket],
    message: str
) -> None:
    """
    Write error message.
    
    Args:
        stream: Socket or file-like object
        message: Error description
    """
    msg_bytes = message.encode('utf-8')
    header = struct.pack('<4sIII', MAGIC, ERROR_MARKER, len(msg_bytes), 0)
    
    if hasattr(stream, 'sendall'):
        stream.sendall(header + msg_bytes)
    else:
        stream.write(header)
        stream.write(msg_bytes)
        stream.flush()
```

#### 3.3 Python Streaming Handler Update

```python
# In src/python/server.py - add binary streaming support

from binary_protocol import write_chunk, write_end, write_error

async def handle_stream_binary(conn: socket.socket, request: dict) -> None:
    """
    Handle streaming TTS with binary protocol.
    No file I/O - samples go directly to socket.
    """
    text = request.get('text', '')
    model_name = request.get('model', DEFAULT_MODEL)
    temperature = request.get('temperature', 0.5)
    speed = request.get('speed', 1.0)
    voice = request.get('voice')
    
    log_info('Starting binary stream', {
        'text_length': len(text),
        'model': model_name,
    })
    
    try:
        # Ensure model is loaded
        ensure_model_loaded(model_name)
        
        # Chunk text
        chunks = chunk_text(text)
        log_info('Text chunked', {'chunk_count': len(chunks)})
        
        total_samples = 0
        start_time = time.time()
        
        for i, chunk_text in enumerate(chunks):
            log_debug('Generating chunk', {
                'chunk_id': i,
                'text_length': len(chunk_text),
            })
            
            # Generate audio - returns numpy array directly
            audio = generate_audio_numpy(
                text=chunk_text,
                model=model_name,
                temperature=temperature,
                speed=speed,
                voice=voice,
            )
            
            # Send directly to socket
            write_chunk(conn, i, audio, SAMPLE_RATE)
            
            total_samples += len(audio)
            log_debug('Chunk sent', {
                'chunk_id': i,
                'samples': len(audio),
                'duration_seconds': len(audio) / SAMPLE_RATE,
            })
        
        # Send completion marker
        write_end(conn, len(chunks))
        
        elapsed = time.time() - start_time
        duration = total_samples / SAMPLE_RATE
        rtf = elapsed / duration if duration > 0 else 0
        
        log_info('Stream complete', {
            'total_chunks': len(chunks),
            'total_samples': total_samples,
            'duration_seconds': duration,
            'elapsed_seconds': elapsed,
            'rtf': rtf,
        })
        
    except Exception as e:
        log_error('Stream generation failed', {'error': str(e)})
        write_error(conn, str(e))
        raise


def generate_audio_numpy(
    text: str,
    model: str,
    temperature: float,
    speed: float,
    voice: str | None,
) -> np.ndarray:
    """
    Generate audio and return as numpy array (no file I/O).
    """
    from mlx_audio.tts import generate
    
    # Generate with mlx-audio
    result = generate(
        text=text,
        model=model,
        temperature=temperature,
        speed=speed,
        voice=voice,
        # Return numpy array instead of writing to file
        output_format='numpy',
    )
    
    return result
```

#### 3.4 TypeScript Binary Reader

```typescript
// src/bridge/binary-reader.ts

import { Socket } from 'net';
import { logger, logDecision } from '../ui/logger';

const MAGIC = Buffer.from('SPKR');
const HEADER_SIZE = 16;
const END_MARKER = 0xFFFFFFFF;
const ERROR_MARKER = 0xFFFFFFFE;

export interface AudioChunk {
  type: 'chunk';
  id: number;
  samples: Float32Array;
  sampleRate: number;
}

export interface StreamEnd {
  type: 'end';
  totalChunks: number;
}

export interface StreamError {
  type: 'error';
  message: string;
}

export type StreamMessage = AudioChunk | StreamEnd | StreamError;

/**
 * Async generator that reads binary audio stream from socket.
 * Yields AudioChunk, StreamEnd, or StreamError messages.
 */
export async function* readBinaryStream(
  socket: Socket
): AsyncGenerator<StreamMessage> {
  let buffer = Buffer.alloc(0);
  
  // Helper to read exactly N bytes
  async function readExact(n: number): Promise<Buffer> {
    while (buffer.length < n) {
      const chunk = await new Promise<Buffer | null>((resolve, reject) => {
        const onData = (data: Buffer) => {
          cleanup();
          resolve(data);
        };
        const onError = (err: Error) => {
          cleanup();
          reject(err);
        };
        const onClose = () => {
          cleanup();
          resolve(null);
        };
        const cleanup = () => {
          socket.off('data', onData);
          socket.off('error', onError);
          socket.off('close', onClose);
        };
        
        socket.once('data', onData);
        socket.once('error', onError);
        socket.once('close', onClose);
      });
      
      if (chunk === null) {
        throw new Error('Socket closed before receiving complete message');
      }
      
      buffer = Buffer.concat([buffer, chunk]);
    }
    
    const result = buffer.subarray(0, n);
    buffer = buffer.subarray(n);
    return result;
  }
  
  try {
    while (true) {
      // Read header
      const header = await readExact(HEADER_SIZE);
      
      // Validate magic
      if (!header.subarray(0, 4).equals(MAGIC)) {
        throw new Error(`Invalid protocol magic: ${header.subarray(0, 4).toString('hex')}`);
      }
      
      const id = header.readUInt32LE(4);
      const count = header.readUInt32LE(8);
      const rate = header.readUInt32LE(12);
      
      // Check for end marker
      if (id === END_MARKER) {
        logDecision(
          'Received stream end marker',
          'Generation complete',
          { total_chunks: count }
        );
        yield { type: 'end', totalChunks: count };
        return;
      }
      
      // Check for error marker
      if (id === ERROR_MARKER) {
        const msgBytes = await readExact(count);
        const message = msgBytes.toString('utf-8');
        logger.error('Received stream error', { message });
        yield { type: 'error', message };
        return;
      }
      
      // Read samples
      const sampleBytes = await readExact(count * 4);
      
      // Create Float32Array view
      // Note: We need to copy because the buffer may be reused
      const samples = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        samples[i] = sampleBytes.readFloatLE(i * 4);
      }
      
      logger.debug('Received audio chunk', {
        chunk_id: id,
        samples: count,
        sample_rate: rate,
        duration_seconds: count / rate,
      });
      
      yield {
        type: 'chunk',
        id,
        samples,
        sampleRate: rate,
      };
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('Socket closed')) {
      // Connection closed unexpectedly
      logger.error('Socket closed during stream', { 
        buffered_bytes: buffer.length 
      });
    }
    throw error;
  }
}
```

---

### Phase 4: Stream Orchestrator (Day 8)

**Goal:** Wire everything together into a cohesive streaming system.

```typescript
// src/streaming/orchestrator.ts

import { Socket, connect } from 'net';
import { StreamPlayer } from '../audio/stream-player';
import { StreamStateMachine, StreamState, StreamConfig, DEFAULT_STREAM_CONFIG } from './state-machine';
import { readBinaryStream, StreamMessage } from '../bridge/binary-reader';
import { checkKillswitch } from '../core/killswitch';
import { logger, logDecision } from '../ui/logger';
import { SOCKET_PATH } from '../core/config';

export interface StreamOptions {
  text: string;
  model?: string;
  temperature?: number;
  speed?: number;
  voice?: string;
  onProgress?: (progress: StreamProgress) => void;
}

export interface StreamProgress {
  state: StreamState;
  chunksReceived: number;
  bufferedSeconds: number;
  totalSamplesReceived: number;
}

export interface StreamResult {
  success: boolean;
  totalChunks: number;
  totalSamples: number;
  totalDurationSeconds: number;
  underrunCount: number;
  rebufferCount: number;
  finalState: StreamState;
  error?: string;
}

/**
 * Orchestrates streaming TTS generation and playback.
 * 
 * Coordinates:
 * - Binary protocol reader (from Python)
 * - Ring buffer and audio player
 * - State machine for playback control
 * - Progress reporting and cancellation
 */
export class StreamOrchestrator {
  private player: StreamPlayer;
  private stateMachine: StreamStateMachine;
  private socket: Socket | null = null;
  private aborted = false;
  private rebufferCount = 0;
  private chunksReceived = 0;
  private totalSamples = 0;
  
  constructor(
    private readonly sampleRate: number = 24000,
    private readonly config: StreamConfig = DEFAULT_STREAM_CONFIG
  ) {
    this.player = new StreamPlayer({ sampleRate });
    this.stateMachine = new StreamStateMachine(config);
    
    // Wire up state machine to player
    this.stateMachine.onStateChange((state, prev, event) => {
      this.handleStateChange(state, prev, event);
    });
  }
  
  /**
   * Stream audio for the given text.
   */
  async stream(options: StreamOptions): Promise<StreamResult> {
    const { text, onProgress } = options;
    
    // Check killswitch at entry
    checkKillswitch('stream');
    
    logDecision(
      'Starting stream orchestration',
      'User requested streaming playback',
      {
        text_length: text.length,
        config: this.config,
      }
    );
    
    try {
      // Connect to Python server
      this.socket = await this.connectToServer();
      
      // Send stream request
      await this.sendStreamRequest(this.socket, options);
      
      // Start state machine
      this.stateMachine.dispatch(
        { type: 'START' },
        { bufferedSeconds: 0 }
      );
      
      // Process incoming audio
      for await (const message of readBinaryStream(this.socket)) {
        if (this.aborted) {
          logDecision('Stream aborted', 'Cancellation requested', {});
          break;
        }
        
        await this.handleMessage(message);
        
        // Report progress
        if (onProgress) {
          onProgress({
            state: this.stateMachine.state,
            chunksReceived: this.chunksReceived,
            bufferedSeconds: this.player.bufferedSeconds,
            totalSamplesReceived: this.totalSamples,
          });
        }
        
        // Check for terminal state
        if (this.stateMachine.isTerminal()) {
          break;
        }
      }
      
      // Wait for playback to finish
      if (this.player.isPlaying) {
        await this.player.waitForFinish();
      }
      
      return this.buildResult();
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      logDecision(
        'Stream orchestration failed',
        errorMessage,
        { chunks_received: this.chunksReceived }
      );
      
      this.stateMachine.dispatch(
        { type: 'GENERATION_ERROR', error: error as Error },
        { bufferedSeconds: this.player.bufferedSeconds }
      );
      
      return {
        ...this.buildResult(),
        success: false,
        error: errorMessage,
      };
      
    } finally {
      await this.cleanup();
    }
  }
  
  /**
   * Cancel streaming playback.
   */
  cancel(reason: string = 'User cancelled'): void {
    logDecision('Cancelling stream', reason, {
      current_state: this.stateMachine.state,
      chunks_received: this.chunksReceived,
    });
    
    this.aborted = true;
    this.stateMachine.dispatch(
      { type: 'CANCEL', reason },
      { bufferedSeconds: this.player.bufferedSeconds }
    );
  }
  
  private async connectToServer(): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = connect({ path: SOCKET_PATH });
      
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error('Connection timeout'));
      }, 5000);
      
      socket.once('connect', () => {
        clearTimeout(timeout);
        resolve(socket);
      });
      
      socket.once('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }
  
  private async sendStreamRequest(socket: Socket, options: StreamOptions): Promise<void> {
    const request = {
      id: `stream-${Date.now()}`,
      method: 'stream-binary',
      params: {
        text: options.text,
        model: options.model,
        temperature: options.temperature,
        speed: options.speed,
        voice: options.voice,
      },
    };
    
    return new Promise((resolve, reject) => {
      socket.write(JSON.stringify(request) + '\n', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
  
  private async handleMessage(message: StreamMessage): Promise<void> {
    switch (message.type) {
      case 'chunk':
        await this.handleChunk(message);
        break;
        
      case 'end':
        this.stateMachine.dispatch(
          { type: 'GENERATION_COMPLETE', totalChunks: message.totalChunks },
          { bufferedSeconds: this.player.bufferedSeconds }
        );
        break;
        
      case 'error':
        this.stateMachine.dispatch(
          { type: 'GENERATION_ERROR', error: new Error(message.message) },
          { bufferedSeconds: this.player.bufferedSeconds }
        );
        break;
    }
  }
  
  private async handleChunk(chunk: { id: number; samples: Float32Array; sampleRate: number }): Promise<void> {
    // Write samples to buffer with backpressure
    let written = 0;
    while (written < chunk.samples.length && !this.aborted) {
      const remaining = chunk.samples.subarray(written);
      const count = this.player.write(remaining);
      written += count;
      
      if (count < remaining.length) {
        // Buffer full - wait a bit
        await this.sleep(10);
      }
    }
    
    this.chunksReceived++;
    this.totalSamples += chunk.samples.length;
    
    // Dispatch chunk received event
    this.stateMachine.dispatch(
      { type: 'CHUNK_RECEIVED', samples: chunk.samples.length, chunkId: chunk.id },
      { bufferedSeconds: this.player.bufferedSeconds }
    );
    
    // Check for buffer low condition while playing
    if (this.stateMachine.state === StreamState.PLAYING) {
      if (this.player.bufferedSeconds < this.config.minBufferSeconds) {
        this.stateMachine.dispatch(
          { type: 'BUFFER_LOW', bufferedSeconds: this.player.bufferedSeconds },
          { bufferedSeconds: this.player.bufferedSeconds }
        );
      }
    }
  }
  
  private handleStateChange(state: StreamState, prev: StreamState, event: any): void {
    switch (state) {
      case StreamState.PLAYING:
        if (prev === StreamState.BUFFERING || prev === StreamState.REBUFFERING) {
          if (!this.player.isPlaying) {
            this.player.start();
          }
        }
        break;
        
      case StreamState.REBUFFERING:
        this.rebufferCount++;
        // Player continues playing (with potential underruns)
        // We just wait for more data
        break;
        
      case StreamState.DRAINING:
        this.player.startDraining();
        break;
        
      case StreamState.FINISHED:
      case StreamState.ERROR:
        // Terminal states - cleanup handled in stream()
        break;
    }
  }
  
  private buildResult(): StreamResult {
    return {
      success: this.stateMachine.state === StreamState.FINISHED,
      totalChunks: this.chunksReceived,
      totalSamples: this.totalSamples,
      totalDurationSeconds: this.totalSamples / this.sampleRate,
      underrunCount: this.player.underrunSamples,
      rebufferCount: this.rebufferCount,
      finalState: this.stateMachine.state,
    };
  }
  
  private async cleanup(): Promise<void> {
    if (this.player.isPlaying) {
      await this.player.stop();
    }
    
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
```

---

### Phase 5: Installation Improvements (Days 9-11)

**Goal:** Reduce installation friction from 45+ seconds to <60 seconds with zero user intervention.

#### 5.1 Embedded Python Strategy

```typescript
// src/python/embedded.ts

import { existsSync, mkdirSync, renameSync, createWriteStream } from 'fs';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import { createGunzip } from 'zlib';
import { extract } from 'tar';
import { CHATTER_DIR } from '../core/config';
import { logger, logDecision } from '../ui/logger';

const PYTHON_VERSION = '3.11.7';
const PYTHON_BUILD = '20240107';

// Platform-specific download URLs
const PYTHON_URLS: Record<string, string> = {
  'darwin-arm64': `https://github.com/indygreg/python-build-standalone/releases/download/${PYTHON_BUILD}/cpython-${PYTHON_VERSION}+${PYTHON_BUILD}-aarch64-apple-darwin-install_only.tar.gz`,
  'darwin-x64': `https://github.com/indygreg/python-build-standalone/releases/download/${PYTHON_BUILD}/cpython-${PYTHON_VERSION}+${PYTHON_BUILD}-x86_64-apple-darwin-install_only.tar.gz`,
  'linux-arm64': `https://github.com/indygreg/python-build-standalone/releases/download/${PYTHON_BUILD}/cpython-${PYTHON_VERSION}+${PYTHON_BUILD}-aarch64-unknown-linux-gnu-install_only.tar.gz`,
  'linux-x64': `https://github.com/indygreg/python-build-standalone/releases/download/${PYTHON_BUILD}/cpython-${PYTHON_VERSION}+${PYTHON_BUILD}-x86_64-unknown-linux-gnu-install_only.tar.gz`,
};

const EMBEDDED_PYTHON_DIR = join(CHATTER_DIR, 'python');
const EMBEDDED_PYTHON_BIN = join(EMBEDDED_PYTHON_DIR, 'bin', 'python3');
const EMBEDDED_PIP = join(EMBEDDED_PYTHON_DIR, 'bin', 'pip3');

/**
 * Check if embedded Python is available and working
 */
export function hasEmbeddedPython(): boolean {
  if (!existsSync(EMBEDDED_PYTHON_BIN)) {
    return false;
  }
  
  try {
    const { execSync } = require('child_process');
    execSync(`${EMBEDDED_PYTHON_BIN} --version`, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the path to the Python interpreter (embedded or system)
 */
export function getPythonPath(): string {
  if (hasEmbeddedPython()) {
    return EMBEDDED_PYTHON_BIN;
  }
  
  // Fall back to venv Python
  const { VENV_PYTHON } = require('../core/config');
  if (existsSync(VENV_PYTHON)) {
    return VENV_PYTHON;
  }
  
  // Last resort: system Python
  return 'python3';
}

/**
 * Download and install embedded Python
 */
export async function installEmbeddedPython(
  onProgress?: (message: string, percent?: number) => void
): Promise<boolean> {
  const platform = `${process.platform}-${process.arch}`;
  const url = PYTHON_URLS[platform];
  
  if (!url) {
    logger.error('Unsupported platform for embedded Python', { platform });
    return false;
  }
  
  logDecision(
    'Installing embedded Python',
    'No suitable Python found on system',
    { platform, url }
  );
  
  try {
    // Create directory
    if (!existsSync(CHATTER_DIR)) {
      mkdirSync(CHATTER_DIR, { recursive: true });
    }
    
    // Download
    onProgress?.('Downloading Python...', 0);
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Download failed: ${response.statusText}`);
    }
    
    const totalBytes = parseInt(response.headers.get('content-length') || '0', 10);
    let downloadedBytes = 0;
    
    // Create temp file
    const tempPath = join(CHATTER_DIR, 'python-download.tar.gz');
    const writeStream = createWriteStream(tempPath);
    
    // Stream download with progress
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      writeStream.write(value);
      downloadedBytes += value.length;
      
      if (totalBytes > 0) {
        const percent = Math.round((downloadedBytes / totalBytes) * 50); // 0-50%
        onProgress?.(`Downloading Python... ${Math.round(downloadedBytes / 1024 / 1024)}MB`, percent);
      }
    }
    
    writeStream.end();
    await new Promise((resolve) => writeStream.on('finish', resolve));
    
    // Extract
    onProgress?.('Extracting Python...', 50);
    
    const { createReadStream } = require('fs');
    await pipeline(
      createReadStream(tempPath),
      createGunzip(),
      extract({ cwd: CHATTER_DIR })
    );
    
    // Rename extracted directory
    const extractedDir = join(CHATTER_DIR, 'python');
    if (existsSync(join(CHATTER_DIR, 'python'))) {
      // Already named correctly
    }
    
    // Cleanup temp file
    const { unlinkSync } = require('fs');
    unlinkSync(tempPath);
    
    // Verify installation
    onProgress?.('Verifying Python...', 90);
    
    const { execSync } = require('child_process');
    const version = execSync(`${EMBEDDED_PYTHON_BIN} --version`, { encoding: 'utf-8' }).trim();
    
    logDecision(
      'Embedded Python installed',
      version,
      { path: EMBEDDED_PYTHON_BIN }
    );
    
    onProgress?.('Python ready', 100);
    return true;
    
  } catch (error) {
    logger.error('Failed to install embedded Python', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Install Python packages using embedded or system Python
 */
export async function installPackages(
  packages: string[],
  onProgress?: (message: string) => void
): Promise<boolean> {
  const pythonPath = getPythonPath();
  const pipPath = pythonPath.replace('python3', 'pip3');
  
  logDecision(
    'Installing Python packages',
    `Using ${pythonPath}`,
    { packages }
  );
  
  try {
    const { spawn } = require('child_process');
    
    return new Promise((resolve) => {
      const proc = spawn(pipPath, ['install', ...packages], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      
      proc.stdout.on('data', (data: Buffer) => {
        const line = data.toString().trim();
        if (line.includes('Installing') || line.includes('Successfully')) {
          onProgress?.(line);
        }
      });
      
      proc.stderr.on('data', (data: Buffer) => {
        logger.debug('pip stderr', { output: data.toString() });
      });
      
      proc.on('close', (code: number) => {
        resolve(code === 0);
      });
    });
  } catch (error) {
    logger.error('Failed to install packages', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
```

#### 5.2 Unified Setup Flow

```typescript
// src/python/setup.ts (enhanced)

import { hasEmbeddedPython, installEmbeddedPython, installPackages, getPythonPath } from './embedded';
import { logger, logDecision } from '../ui/logger';

export const REQUIRED_PACKAGES = [
  'mlx-audio',
  'mlx-lm', 
  'scipy',
  'sounddevice',
  'librosa',
  'einops',
];

export interface SetupOptions {
  force?: boolean;
  useEmbedded?: boolean;
  onProgress?: (step: string, message: string, percent?: number) => void;
}

export interface SetupResult {
  success: boolean;
  pythonPath: string;
  method: 'embedded' | 'venv' | 'system';
  error?: string;
}

/**
 * Run complete setup process.
 * 
 * Strategy:
 * 1. Check for existing working setup
 * 2. Try embedded Python (most reliable)
 * 3. Fall back to system Python with venv
 */
export async function runSetup(options: SetupOptions = {}): Promise<SetupResult> {
  const { force = false, useEmbedded = true, onProgress } = options;
  
  logDecision(
    'Starting setup',
    force ? 'Force reinstall requested' : 'Checking environment',
    { force, useEmbedded }
  );
  
  // Step 1: Check existing setup (unless force)
  if (!force) {
    const existing = await checkExistingSetup();
    if (existing.success) {
      logDecision('Using existing setup', 'Environment already valid', existing);
      return existing;
    }
  }
  
  // Step 2: Try embedded Python
  if (useEmbedded) {
    onProgress?.('python', 'Setting up embedded Python...', 0);
    
    if (!hasEmbeddedPython() || force) {
      const installed = await installEmbeddedPython((msg, pct) => {
        onProgress?.('python', msg, pct);
      });
      
      if (!installed) {
        logger.warn('Embedded Python installation failed, trying venv');
      }
    }
    
    if (hasEmbeddedPython()) {
      onProgress?.('packages', 'Installing packages...', 50);
      
      const packagesInstalled = await installPackages(REQUIRED_PACKAGES, (msg) => {
        onProgress?.('packages', msg);
      });
      
      if (packagesInstalled) {
        const result = await verifySetup();
        if (result.success) {
          onProgress?.('complete', 'Setup complete!', 100);
          return { ...result, method: 'embedded' };
        }
      }
    }
  }
  
  // Step 3: Fall back to venv with system Python
  onProgress?.('venv', 'Creating virtual environment...', 0);
  
  const venvResult = await createVenvSetup((msg, pct) => {
    onProgress?.('venv', msg, pct);
  });
  
  if (venvResult.success) {
    onProgress?.('complete', 'Setup complete!', 100);
    return { ...venvResult, method: 'venv' };
  }
  
  return {
    success: false,
    pythonPath: '',
    method: 'system',
    error: 'All setup methods failed. Please install Python 3.10+ manually.',
  };
}

async function checkExistingSetup(): Promise<SetupResult> {
  try {
    const pythonPath = getPythonPath();
    const { execSync } = require('child_process');
    
    // Check Python works
    execSync(`${pythonPath} -c "import mlx_audio"`, { timeout: 10000 });
    
    return {
      success: true,
      pythonPath,
      method: hasEmbeddedPython() ? 'embedded' : 'venv',
    };
  } catch {
    return {
      success: false,
      pythonPath: '',
      method: 'system',
      error: 'Existing setup not valid',
    };
  }
}

async function verifySetup(): Promise<SetupResult> {
  const pythonPath = getPythonPath();
  
  try {
    const { execSync } = require('child_process');
    
    // Verify mlx-audio imports
    execSync(`${pythonPath} -c "import mlx_audio.tts; print('OK')"`, {
      timeout: 30000,
    });
    
    return {
      success: true,
      pythonPath,
      method: hasEmbeddedPython() ? 'embedded' : 'venv',
    };
  } catch (error) {
    return {
      success: false,
      pythonPath,
      method: 'system',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function createVenvSetup(
  onProgress: (msg: string, pct?: number) => void
): Promise<SetupResult> {
  // ... existing venv creation logic ...
  // (Keep the existing implementation from src/python/setup.ts)
  
  return {
    success: false,
    pythonPath: '',
    method: 'venv',
    error: 'Venv creation not implemented in this excerpt',
  };
}
```

---

### Phase 6: CLI Integration and SKILL.md (Day 12)

**Goal:** Update CLI to use new streaming system and create clean agent-facing SKILL.md.

#### 6.1 Updated Streaming Command

```typescript
// In src/index.ts - update streaming section

if (options.stream) {
  const { StreamOrchestrator } = await import('./streaming/orchestrator');
  
  const orchestrator = new StreamOrchestrator(24000, {
    initialBufferSeconds: 3.0,
    minBufferSeconds: 1.0,
    resumeBufferSeconds: 2.0,
  });
  
  // Handle Ctrl+C
  const cancelHandler = () => {
    orchestrator.cancel('User interrupted');
  };
  process.once('SIGINT', cancelHandler);
  
  if (!options.quiet) {
    console.log(pc.dim('Streaming audio...'));
  }
  
  const result = await orchestrator.stream({
    text,
    model: options.model,
    temperature: parseFloat(options.temp),
    speed: parseFloat(options.speed),
    voice: options.voice,
    onProgress: (progress) => {
      if (!options.quiet && options.verbose) {
        process.stdout.write(
          `\r${pc.dim(`State: ${progress.state} | Buffer: ${progress.bufferedSeconds.toFixed(1)}s | Chunks: ${progress.chunksReceived}`)}`
        );
      }
    },
  });
  
  process.off('SIGINT', cancelHandler);
  
  if (!options.quiet) {
    if (result.success) {
      console.log(pc.green(`\n✓ Streamed ${result.totalChunks} chunks`));
      console.log(pc.dim(`  Duration: ${result.totalDurationSeconds.toFixed(1)}s`));
      if (result.rebufferCount > 0) {
        console.log(pc.yellow(`  Rebuffered: ${result.rebufferCount} time(s)`));
      }
      if (result.underrunCount > 0) {
        console.log(pc.yellow(`  Underruns: ${result.underrunCount} samples`));
      }
    } else {
      console.log(pc.red(`\n✗ Streaming failed: ${result.error}`));
    }
  }
  
  process.exit(result.success ? 0 : 1);
}
```

#### 6.2 Agent-Facing SKILL.md

```markdown
# speak - Text to Speech for Agents

Convert text to natural speech audio using Chatterbox TTS on Apple Silicon.

## Quick Start

```bash
# Generate audio file
speak "Hello, I'm your AI assistant."

# Generate and play immediately
speak "Let me read that for you." --play

# Stream long text (starts playing before generation completes)
speak document.md --stream

# Read from file
speak README.md --play
```

## Common Patterns

### Reading Documents to Users

```bash
# Best for long documents - streams audio as it generates
speak document.md --stream
```

### Quick Responses

```bash
# Generate and play short responses
speak "I've completed that task for you." --play
```

### Background Audio Generation

```bash
# Generate audio file for later use
speak "Welcome to our service" --output ~/Audio/welcome.wav
```

## Options Reference

| Option | Description | Default |
|--------|-------------|---------|
| `--play` | Play audio after generation | false |
| `--stream` | Stream audio as it generates | false |
| `--output <path>` | Output directory or file | ~/Audio/speak/ |
| `--voice <name>` | Voice preset or .wav file | default |

## Setup

First run automatically sets up the environment:

```bash
speak "test"  # Auto-setup on first run
```

Or manually:

```bash
speak setup
```

## Daemon Mode

Keep the model loaded for faster responses:

```bash
# Start daemon (model stays loaded)
speak daemon start

# Generate audio (fast - model already loaded)  
speak "Quick response" --play

# Stop daemon when done
speak daemon stop
```

## Health Check

```bash
speak health
```

## Notes

- Requires Apple Silicon Mac (M1/M2/M3)
- First generation loads model (~3-5 seconds)
- Subsequent generations are fast (~0.3x real-time)
- Use `--stream` for text longer than a few sentences
- Audio files are WAV format at 24kHz
```

---

## Part 4: Testing Strategy

### 4.1 Test Categories

| Category | Purpose | Coverage Target |
|----------|---------|-----------------|
| Unit | Ring buffer, state machine, protocol | 100% of logic branches |
| Integration | Orchestrator, player, binary reader | All state transitions |
| E2E | Full CLI flows | Happy path + error cases |
| Performance | Latency, throughput, memory | Regression detection |

### 4.2 Test Files Structure

```
test/
├── unit/
│   ├── ring-buffer.test.ts
│   ├── state-machine.test.ts
│   └── binary-protocol.test.ts
├── integration/
│   ├── stream-player.test.ts
│   ├── orchestrator.test.ts
│   └── binary-reader.test.ts
├── e2e/
│   ├── generate.test.ts
│   ├── streaming.test.ts
│   ├── daemon.test.ts
│   └── setup.test.ts
└── fixtures/
    ├── sample-audio.bin
    └── test-text.md
```

### 4.3 CI Pipeline

```yaml
# .github/workflows/test.yml
name: Test

on: [push, pull_request]

jobs:
  test:
    runs-on: macos-14  # Apple Silicon
    steps:
      - uses: actions/checkout@v4
      
      - uses: oven-sh/setup-bun@v1
        with:
          bun-version: latest
      
      - name: Install dependencies
        run: bun install
      
      - name: Run unit tests
        run: bun test test/unit/
      
      - name: Run integration tests
        run: bun test test/integration/
      
      - name: Setup Python environment
        run: bun run src/index.ts setup
      
      - name: Run E2E tests
        run: bun test test/e2e/
```

---

## Part 5: Rollout Plan

### 5.1 Phases

| Phase | Duration | Scope | Success Criteria |
|-------|----------|-------|------------------|
| Alpha | 1 week | Internal testing | All tests pass, no crashes |
| Beta | 2 weeks | Select users | <1% error rate, no data loss |
| GA | Ongoing | All users | <0.1% error rate, <5s cold start |

### 5.2 Feature Flags

```typescript
// Feature flags for gradual rollout
const FEATURES = {
  // Use new binary streaming protocol
  BINARY_STREAMING: process.env.SPEAK_BINARY_STREAMING === '1',
  
  // Use new audio player (vs afplay)
  NEW_AUDIO_PLAYER: process.env.SPEAK_NEW_AUDIO_PLAYER === '1',
  
  // Use embedded Python
  EMBEDDED_PYTHON: process.env.SPEAK_EMBEDDED_PYTHON === '1',
};
```

### 5.3 Rollback Procedure

```bash
# If issues detected:

# 1. Engage killswitch (immediate)
touch ~/.chatter/.killswitch

# 2. Downgrade to previous version
npm install -g @emzod/speak@<previous-version>

# 3. Disable feature flags
export SPEAK_BINARY_STREAMING=0
export SPEAK_NEW_AUDIO_PLAYER=0

# 4. Restart daemon
speak daemon kill
speak daemon start

# 5. Disengage killswitch
rm ~/.chatter/.killswitch
```

---

## Part 6: Success Metrics

### 6.1 Reliability Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Generation success rate | >99.5% | Successful completions / total attempts |
| Streaming success rate | >99% | Streams completed without error |
| Audio gap incidents | <1% | User-reported choppy audio |
| Setup success rate | >95% | First-time setups completed |

### 6.2 Performance Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Cold start time | <6s | Time from `speak` to first audio (cold) |
| Warm start time | <1s | Time from `speak` to first audio (daemon) |
| Time to first audio (streaming) | <4s | Time from `speak --stream` to audio output |
| Real-time factor | <0.5x | Generation time / audio duration |

### 6.3 Observability

```bash
# Key log queries for monitoring

# Error rate
cat ~/.chatter/logs/speak_*.log | jq 'select(.level == "error")' | wc -l

# State transitions (streaming health)
cat ~/.chatter/logs/speak_*.log | jq 'select(.message | contains("State transition"))'

# Rebuffer events (streaming quality)
cat ~/.chatter/logs/speak_*.log | jq 'select(.decision.what | contains("rebuffer"))'

# Setup failures
cat ~/.chatter/logs/speak_*.log | jq 'select(.message | contains("setup") and .level == "error")'
```

---

## Part 7: Timeline Summary

| Phase | Days | Deliverables |
|-------|------|--------------|
| **Phase 0: Operational Foundation** | 1 | Killswitch, structured logging, health checks |
| **Phase 1: Ring Buffer & State Machine** | 2 | Core data structures with tests |
| **Phase 2: Streaming Audio Player** | 2 | node-speaker integration, pull-based playback |
| **Phase 3: Binary Protocol** | 2 | File-free streaming, Python + TS implementations |
| **Phase 4: Stream Orchestrator** | 1 | Wire everything together |
| **Phase 5: Installation Improvements** | 3 | Embedded Python, unified setup |
| **Phase 6: CLI & SKILL.md** | 1 | Updated CLI, agent documentation |
| **Total** | **12 days** | Production-ready v1.0 |

---

## Appendix A: File Changes Summary

### New Files

```
src/
├── core/
│   ├── killswitch.ts          # Killswitch implementation
│   └── health.ts              # Health check system
├── audio/
│   ├── ring-buffer.ts         # Audio sample ring buffer
│   ├── stream-player.ts       # Streaming audio player
│   └── device.ts              # Audio device detection
├── streaming/
│   ├── state-machine.ts       # Streaming state machine
│   └── orchestrator.ts        # Stream coordination
├── bridge/
│   └── binary-reader.ts       # Binary protocol reader
└── python/
    ├── embedded.ts            # Embedded Python management
    └── binary_protocol.py     # Binary protocol writer

test/
├── unit/
│   ├── ring-buffer.test.ts
│   └── state-machine.test.ts
├── integration/
│   ├── stream-player.test.ts
│   └── orchestrator.test.ts
└── e2e/
    └── streaming.test.ts
```

### Modified Files

```
src/
├── index.ts                   # Updated streaming command
├── ui/logger.ts               # Add logDecision, structured output
├── python/setup.ts            # Use embedded Python
└── python/server.py           # Add binary streaming handler
```

---

## Appendix B: Dependencies

### New NPM Dependencies

```json
{
  "dependencies": {
    "speaker": "^0.5.4"
  },
  "devDependencies": {
    "tar": "^6.2.0"
  }
}
```

### System Dependencies

```bash
# macOS (for node-speaker)
brew install portaudio
```

---

## Appendix C: Configuration Reference

All existing configuration options are preserved. No breaking changes.

```toml
# ~/.chatter/config.toml

# Output settings
output_dir = "~/Audio/speak"

# Model settings
model = "mlx-community/chatterbox-turbo-8bit"
temperature = 0.5
speed = 1.0

# Processing settings
markdown_mode = "plain"  # or "smart"
code_blocks = "read"     # or "skip", "placeholder"

# Voice settings
voice = ""  # path to .wav or preset name

# Daemon settings
daemon = false

# Logging
log_level = "info"  # debug, info, warn, error
```

---

## Closing Note

This plan transforms speak from a working prototype into production infrastructure. The changes focus on:

1. **Reliability** — Explicit state machines, proper error handling, killswitches
2. **Performance** — Gapless streaming, no file I/O, pull-based audio
3. **Observability** — Structured logging, health checks, decision tracking
4. **Installation** — Embedded Python, zero-friction setup

The configuration surface area remains unchanged. Power users and agents have access to all the same knobs. What changes is the plumbing underneath—boring, reliable, invisible.

> "Good design is self-effacing. You recognize it by nothing going wrong for a long time."