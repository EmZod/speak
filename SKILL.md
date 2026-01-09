---
name: speak-tts
description: Local text-to-speech generation using Chatterbox TTS on Apple Silicon. Use this when users request converting text to audio, reading articles/documents aloud, generating speech from clipboard content, voice cloning, or creating audiobook-style narration. Runs entirely on-device via MLX for private TTS. Supports auto-chunking for long documents, batch processing, and resume capability.
---

# speak - Text to Speech for Agents

Convert text to natural speech audio using Chatterbox TTS on Apple Silicon.

## Quick Start

```bash
# Stream audio (recommended - starts playing immediately)
speak "Hello, I'm your AI assistant." --stream

# Generate and play after completion
speak "Let me read that for you." --play

# Generate audio file with specific name
speak "Hello" --output ~/Audio/greeting.wav

# Check duration estimate before generating
speak --estimate document.md
```

## Common Patterns

### Reading Documents to Users

```bash
# Best for long documents - starts playing within ~3s
speak document.md --stream

# For very long documents - auto-chunk for reliability
speak long-book-chapter.md --auto-chunk --output chapter.wav
```

### Quick Responses

```bash
# Stream for lowest latency to first audio
speak "I've completed that task for you." --stream

# Or generate then play (waits for full generation)
speak "Done!" --play
```

### Background Audio Generation

```bash
# Generate audio file for later use
speak "Welcome to our service" --output ~/Audio/welcome.wav

# Preview estimate without generating
speak --estimate "Long text here..."
```

### Batch Processing Multiple Files

```bash
# Process multiple files at once
speak chapter1.md chapter2.md chapter3.md --output-dir ~/Audio/book/

# Skip files that already have output
speak chapters/*.md --output-dir ~/Audio/book/ --skip-existing
```

### Long Document Workflow

```bash
# For documents that might timeout (>5 min generation)
speak book-chapter.md --auto-chunk --output chapter.wav

# If interrupted, resume from where it left off
speak --resume ~/Audio/speak/manifest.json

# Keep intermediate chunks for inspection
speak document.md --auto-chunk --output doc.wav --keep-chunks
```

### Concatenating Audio Files

```bash
# Combine multiple audio files
speak concat part1.wav part2.wav part3.wav --out combined.wav
```

## Options Reference

| Option | Description | Default |
|--------|-------------|---------|
| `--stream` | Stream audio as it generates | false |
| `--play` | Play audio after generation | false |
| `--output <path>` | Output file (.wav) or directory | ~/Audio/speak/ |
| `--voice <path>` | Voice preset or .wav file for cloning | default |
| `--timeout <sec>` | Generation timeout (0 = none) | 300 |
| `--auto-chunk` | Chunk long documents automatically | false |
| `--chunk-size <n>` | Max chars per chunk | 6000 |
| `--resume <file>` | Resume from manifest file | - |
| `--keep-chunks` | Keep intermediate chunk files | false |
| `--output-dir <dir>` | Output directory for batch mode | - |
| `--skip-existing` | Skip files with existing output | false |
| `--estimate` | Show duration estimate only | false |
| `--dry-run` | Preview without generating | false |
| `--quiet` | Suppress output except errors | false |

## Commands

| Command | Description |
|---------|-------------|
| `speak setup` | Set up Python environment |
| `speak health` | Check system health |
| `speak models` | List available TTS models |
| `speak concat` | Concatenate audio files |
| `speak daemon kill` | Stop the TTS server |
| `speak config` | Show current configuration |

## Performance

- **Cold start**: ~4-8s to first audio (model loading + generation)
- **Warm start**: ~3-8s to first audio (model already loaded)
- **Generation speed**: ~0.3-0.5x RTF on Apple Silicon (faster than real-time)
- **Streaming**: Audio starts after first chunk (~250 chars)

### Estimation

```bash
# Get time estimate before committing
speak --estimate document.md

# Output:
# Input: 24,011 characters (~4,800 words)
# Estimated audio: ~25 minutes
# Estimated generation time: ~12 minutes
# RTF: 0.40x
```

## Long Document Handling

For documents that exceed the 5-minute timeout:

1. **Auto-chunking** splits text at sentence boundaries
2. **Progressive saving** - each chunk saved immediately
3. **Resume capability** - continue from where you left off

```bash
# Generate with auto-chunking (recommended for >10 min audio)
speak long-document.md --auto-chunk --output output.wav

# If it fails partway through, resume:
speak --resume ~/Audio/speak/manifest.json
```

## Voice Cloning & Multi-Voice Content

### Discovering Available Voices

Voice samples are stored in `~/.chatter/voices/`. Always check what's available:

```bash
# List available voice samples
ls ~/.chatter/voices/*.wav 2>/dev/null

# Example output:
# alan_watts.wav
# david_attenborough.wav
# morgan_freeman.wav
# stephen_fry.wav
# ursula_leguin.wav
```

### Using a Custom Voice

**Always use the full path to voice files:**

```bash
# Clone a specific voice (full path required)
speak "Hello world" --voice ~/.chatter/voices/morgan_freeman.wav --stream
```

> **Important:** Do not use just the filename (e.g., `--voice morgan_freeman.wav`). 
> Always use the full path: `--voice ~/.chatter/voices/morgan_freeman.wav`

### Multi-Voice Content (Debates, Dramas, Podcasts)

For content with multiple speakers:

1. **Split script into separate files per speaker**
   ```
   01_host_intro.txt
   02_guest1_response.txt
   03_host_followup.txt
   04_guest2_rebuttal.txt
   ```

2. **Generate each segment with appropriate voice (use full paths)**
   ```bash
   speak 01_host_intro.txt --voice ~/.chatter/voices/stephen_fry.wav --output wav/01.wav
   speak 02_guest1_response.txt --voice ~/.chatter/voices/morgan_freeman.wav --output wav/02.wav
   speak 03_host_followup.txt --voice ~/.chatter/voices/stephen_fry.wav --output wav/03.wav
   speak 04_guest2_rebuttal.txt --voice ~/.chatter/voices/ursula_leguin.wav --output wav/04.wav
   ```

3. **Concatenate in order**
   ```bash
   speak concat wav/*.wav --out final_debate.wav
   ```

### Adding New Voice Samples

To add a new voice for cloning:
1. Get a clean 10-30 second audio sample (WAV format, clear speech, minimal background noise)
2. Save to `~/.chatter/voices/speaker_name.wav`
3. The voice is now available via `--voice speaker_name.wav`

## Emotion Tags

Add expressive sounds inline with text:

```bash
speak "[sigh] I can't believe it's Monday again." --stream
speak "[laugh] That's hilarious!" --stream
```

### Supported Tags

| Tag | Effect |
|-----|--------|
| `[laugh]` | Laughing |
| `[chuckle]` | Light chuckle |
| `[sigh]` | Sighing |
| `[gasp]` | Gasping |
| `[groan]` | Groaning |
| `[clear throat]` | Throat clearing |
| `[cough]` | Coughing |
| `[crying]` | Crying/emotional |
| `[singing]` | Sung speech |

**Note:** `[pause]` and `[whisper]` are NOT supported. Use punctuation for pauses.

## Setup

First run automatically sets up the environment:

```bash
speak "test"  # Auto-setup on first run
```

Or manually: `speak setup`

## Server Management

Server auto-starts and shuts down after 1 hour idle.

```bash
speak health        # Check status
speak daemon kill   # Stop manually
```

## Additional Documentation

For more details, see:
- [docs/usage.md](docs/usage.md) - Complete usage guide with all options
- [docs/configuration.md](docs/configuration.md) - Config file, environment variables
- [docs/troubleshooting.md](docs/troubleshooting.md) - Common issues and fixes

## Notes

- Requires Apple Silicon Mac (M1/M2/M3)
- Requires `sox` for auto-chunking: `brew install sox`
- Audio format: WAV 24kHz mono
- Use `--stream` for text longer than a few sentences
- Use `--auto-chunk` for documents >10 minutes of audio
