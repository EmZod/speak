# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2025-12-31

A complete rewrite of the streaming architecture for reliability, plus new features for handling long documents.

### Added

#### Streaming Architecture (v1.0 Core)
- Binary streaming protocol for gapless audio playback (eliminates file I/O between Python and TypeScript)
- Ring buffer implementation (`src/audio/ring-buffer.ts`) for smooth audio delivery
- Explicit state machine (`src/streaming/state-machine.ts`) for streaming: IDLE → BUFFERING → PLAYING → DRAINING → FINISHED
- Pull-based audio player (`src/audio/stream-player.ts`) using node-speaker (replaces afplay subprocess spawning)
- Binary protocol reader (`src/bridge/binary-reader.ts`) for efficient chunk parsing
- Stream orchestrator (`src/streaming/orchestrator.ts`) coordinating generation, buffering, and playback

#### Operational Infrastructure
- Killswitch system (`~/.chatter/.killswitch`) for emergency stops
- Structured decision logging with `logDecision()` for debugging critical paths
- Comprehensive health check system (`speak health`) with JSON output option
- Server auto-shutdown after 1 hour of idle (only TTS operations reset timer)

#### Long Document Support (v1.1)
- Auto-chunking for long documents (`--auto-chunk`, `--chunk-size`) - splits at sentence boundaries
- Resume capability for interrupted generations (`--resume <manifest>`, `--keep-chunks`)
- Generation manifest (`src/core/manifest.ts`) tracking chunk status for reliable recovery
- Progressive chunk saving to disk during generation (partial output preserved on timeout/error)
- Configurable timeout (`--timeout <seconds>`, default 300s, 0 for unlimited)

#### Batch Processing
- Batch mode for multiple input files (`--output-dir`, `--skip-existing`, `--stop-on-error`)
- Batch utilities (`src/core/batch.ts`) for preparing inputs and summarizing results

#### New Commands and Options
- `speak concat <files...> --out <output>` - Concatenate audio files using sox
- `speak health` - System health check with pass/fail status
- `--estimate` - Show duration estimate without generating
- `--dry-run` - Preview what would happen without generating
- Progress indicator showing chunk counts and ETA during generation

#### Documentation
- SKILL.md for agent-facing documentation (simple, opinionated interface)
- Updated README with global installation instructions

### Changed

- `--output` now accepts both file paths (with .wav extension) and directories
- Version bumped from 0.1.0 to 1.1.0
- Default timeout reduced from unlimited to 300 seconds

### Fixed

#### Streaming Bugs (v1.0)
- **Buffer view corruption**: `Buffer.from(arrayBuffer)` created views that got corrupted when underlying Float32Array was reused. Fixed by allocating new buffers and copying data for each audio chunk push.
- **Socket buffer reuse**: Bun may reuse buffers passed to data event callbacks. Fixed by copying socket data immediately in `binary-reader.ts`.
- **Short text streaming failure**: State machine went BUFFERING → DRAINING without starting player. Fixed by adding `player.start()` call when entering DRAINING from BUFFERING.
- **Streaming success=false**: After `waitForFinish()`, no BUFFER_EMPTY event was dispatched, leaving state as DRAINING. Fixed by dispatching BUFFER_EMPTY after playback completes.
- **Streaming hang on long content**: `for await` loop blocked while `handleChunk()` waited for buffer drain. Fixed with producer-consumer pattern for concurrent socket reading and chunk processing.

#### v1.1 Bug Fixes (found during testing)
- **Process hanging after completion**: `socket.end()` doesn't force close the socket. Changed to `socket.destroy()` in `client.ts`.
- **Concat --output option conflict**: `-o, --output` conflicted with parent command. Renamed to `--out` for concat subcommand.
- **--resume requiring input text**: Resume handling was after input validation. Moved to beginning of action handler.

### Technical Details

#### Architecture Changes
```
BEFORE (v0.1):
  Bun CLI → Bridge → Python → afplay (subprocess per chunk)
  - Three processes own playback state
  - File I/O for every chunk
  - 50-100ms gaps between chunks
  
AFTER (v1.0+):
  Bun CLI (state machine + ring buffer + speaker) ← Binary stream ← Python
  - Single owner for playback state
  - No file I/O for streaming
  - Gapless audio playback
```

#### State Machine States
- IDLE: Initial state, waiting to start
- BUFFERING: Accumulating initial buffer before playback (3s default)
- PLAYING: Actively playing audio
- REBUFFERING: Paused playback due to low buffer, waiting for more data
- DRAINING: Generation complete, playing remaining buffer
- FINISHED: Playback complete
- ERROR: Error occurred

#### New Files
```
src/audio/ring-buffer.ts      - Lock-free audio sample ring buffer
src/audio/stream-player.ts    - Streaming audio player using node-speaker
src/audio/device.ts           - Audio device detection
src/streaming/state-machine.ts - Streaming state machine
src/streaming/orchestrator.ts  - Stream coordination
src/bridge/binary-reader.ts    - Binary protocol reader
src/bridge/binary-protocol.ts  - Binary protocol types
src/core/killswitch.ts        - Emergency stop mechanism
src/core/health.ts            - Health check system
src/core/chunker.ts           - Text chunking at sentence boundaries
src/core/concatenate.ts       - Sox-based audio concatenation
src/core/manifest.ts          - Generation state tracking for resume
src/core/batch.ts             - Batch processing utilities
src/core/estimate.ts          - Duration estimation
src/python/binary_protocol.py  - Python binary protocol writer
```

### Dependencies

#### Added
- `speaker` ^0.5.4 - Node.js native audio playback

#### System Requirements
- `sox` required for auto-chunking and concat: `brew install sox`
- `portaudio` required for node-speaker: `brew install portaudio`

## [0.1.0] - 2025-12-26

### Added
- Initial release
- Text-to-speech using Chatterbox TTS on Apple Silicon
- Daemon mode for faster subsequent generations
- Voice cloning with `--voice <sample.wav>`
- Markdown processing modes (plain/smart)
- Code block handling (read/skip/placeholder)
- Auto-setup on first run
- Shell completions (bash, zsh, fish)
- Emotion tags support ([laugh], [sigh], etc.)

### Known Issues
- Streaming mode has audio gaps between chunks (fixed in v1.0)
- No progress indicator for long files (fixed in v1.1)
- No resume capability for interrupted generations (fixed in v1.1)
