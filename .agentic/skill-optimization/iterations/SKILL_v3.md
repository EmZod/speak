---
name: speak-tts
description: Local text-to-speech generation using Chatterbox TTS on Apple Silicon. Use this when users request converting text to audio, reading articles/documents aloud, generating speech from clipboard content, voice cloning, or creating audiobook-style narration. Runs entirely on-device via MLX for private TTS. Supports auto-chunking for long documents, batch processing, and resume capability.
---

# speak - Text to Speech for Agents

Convert text to natural speech audio using Chatterbox TTS on Apple Silicon.

## Prerequisites

| Requirement | Check Command | Install |
|-------------|---------------|---------|
| Apple Silicon Mac (M1/M2/M3/M4) | `uname -m` → arm64 | Not available on Intel |
| macOS 12.0+ | `sw_vers` | - |
| sox (for concat/chunking) | `which sox` | `brew install sox` |
| poppler (for PDF) | `which pdftotext` | `brew install poppler` |

## Input Sources

### Supported Input Types

| Source | Example | Notes |
|--------|---------|-------|
| Text file (.txt) | `speak article.txt` | Direct file path |
| Markdown (.md) | `speak document.md` | Markdown syntax stripped |
| Direct string | `speak "Hello world"` | Quote the text |
| Clipboard | `pbpaste \| speak` | Pipe from clipboard |
| Stdin | `cat file.txt \| speak` | Pipe any text |
| URL/Web | See below | Requires curl + conversion |

### Fetching Web Articles

```bash
# Simple method: lynx (install: brew install lynx)
lynx -dump -nolist "https://example.com/article" | speak --output article.wav

# Alternative: curl + pandoc (install: brew install pandoc)
curl -s "https://example.com/article" | pandoc -f html -t plain | speak --output article.wav

# For JavaScript-heavy sites, save the page manually first
```

### Converting Other Formats

| Format | Convert First |
|--------|--------------|
| PDF | `pdftotext doc.pdf doc.txt` then `speak doc.txt` |
| DOCX | `textutil -convert txt doc.docx` then `speak doc.txt` |
| HTML | `pandoc -f html -t plain doc.html > doc.txt` |

## Output Modes: When to Use What

| Goal | Command | Behavior |
|------|---------|----------|
| **Save for later** (no playback) | `speak text.txt --output file.wav` | Generates file silently |
| **Listen now** (streaming) | `speak text.txt --stream` | Plays as it generates |
| **Listen now** (after complete) | `speak text.txt --play` | Waits, then plays |
| **Listen now AND save** | `speak text.txt --stream --output file.wav` | Both simultaneously |

### Default Behavior (no flags)

```bash
# Without --output, --stream, or --play:
speak article.txt
# → Saves to: ~/Audio/speak/article.wav
# → Does NOT play automatically
# → Creates ~/Audio/speak/ if it doesn't exist (this is the ONLY auto-created directory)

speak "Hello world"
# → Saves to: ~/Audio/speak/speak_<timestamp>.wav
```

**Custom output directories are NOT auto-created.** Use `mkdir -p` first:
```bash
mkdir -p ~/Audio/custom/
speak article.txt --output ~/Audio/custom/article.wav
```

## Quick Start Examples

### Read Article and Save for Later

```bash
# From a file
speak article.txt --output ~/Audio/article.wav

# From clipboard
pbpaste | speak --output ~/Audio/clipboard.wav

# From URL
lynx -dump -nolist "https://example.com/news" | speak --output ~/Audio/news.wav

# Play anytime later
afplay ~/Audio/article.wav
```

### Read and Listen Now

```bash
# Stream (starts playing immediately, best for long text)
speak article.txt --stream

# Or wait for completion then play
speak "Short message" --play
```

### Long Document (>10 min audio)

```bash
# Always use --auto-chunk for long documents
speak book-chapter.txt --auto-chunk --output chapter.wav

# Check length first
speak --estimate document.txt
# If "Estimated audio: >10 minutes", use --auto-chunk
```

## Voice System

### Default Voice

When `--voice` is omitted, the tool uses a **built-in default voice** automatically. No setup required.

```bash
# Uses default voice
speak "Hello world" --stream
```

### Custom Voices

To use custom voices, you must provide your own voice samples:

```bash
# Check what's available
ls ~/.chatter/voices/*.wav 2>/dev/null || echo "No custom voices"

# Use a custom voice (FULL PATH REQUIRED)
speak "Hello" --voice ~/.chatter/voices/narrator.wav --stream

# WRONG - will fail
speak "Hello" --voice narrator.wav --stream
```

**Voice sample requirements:**
- WAV format, 10-30 seconds
- 24kHz mono preferred
- Clear speech, minimal background noise
- Save to `~/.chatter/voices/`

## Emotion Tags

Add expressive sounds to speech. **Tags produce audible effects** (actual laughter, sighing sounds):

```bash
speak "[sigh] I can't believe it's Monday." --stream
# Output: (audible sigh) "I can't believe it's Monday."

speak "[laugh] That's hilarious!" --stream
# Output: (audible laughter) "That's hilarious!"
```

### Supported Tags

| Tag | Effect |
|-----|--------|
| `[laugh]` | Laughter sound |
| `[chuckle]` | Light chuckle |
| `[sigh]` | Sighing sound |
| `[gasp]` | Gasping sound |
| `[groan]` | Groaning sound |
| `[clear throat]` | Throat clearing |
| `[cough]` | Coughing sound |
| `[crying]` | Crying sound |
| `[singing]` | Sung speech |

### NOT Supported

`[pause]` and `[whisper]` are **not supported** and will be ignored.

**For pauses:** Use punctuation:
- Ellipsis: `"I think... this is important"`
- Period: `"Wait. Let me reconsider."`

## Batch Processing

```bash
# Create output directory first (required)
mkdir -p ~/Audio/book/

# Process multiple files
speak chapter1.txt chapter2.txt chapter3.txt --output-dir ~/Audio/book/
# Creates: chapter1.wav, chapter2.wav, chapter3.wav

# With auto-chunking for long files
speak chapters/*.txt --output-dir ~/Audio/book/ --auto-chunk

# Skip already-generated files
speak chapters/*.txt --output-dir ~/Audio/book/ --skip-existing
```

### Resume Behavior

| Mode | Resume Method |
|------|---------------|
| Single file + `--auto-chunk` | `speak --resume ~/Audio/speak/manifest.json` |
| Batch processing | Use `--skip-existing` to skip completed files |

## Concatenating Audio

```bash
# Explicit order (recommended)
speak concat part1.wav part2.wav part3.wav --output combined.wav

# Glob pattern (requires zero-padded filenames!)
speak concat wav/*.wav --output combined.wav
# ✓ 01.wav, 02.wav, 03.wav → correct
# ✗ 1.wav, 2.wav, 10.wav → WRONG order
```

**Zero-padding rule:**
- Up to 9 files: `01`, `02`, ..., `09`
- Up to 99 files: `01`, `02`, ..., `99`
- 100+ files: `001`, `002`, ..., `999`

## Multi-Voice Content (Podcasts, Debates)

For content with multiple speakers:

```bash
# 1. Create directories
mkdir -p podcast/scripts podcast/wav

# 2. Create script files (zero-padded)
echo "Welcome to AI Debates." > podcast/scripts/01_host.txt
echo "I believe AI is safe." > podcast/scripts/02_guest1.txt
echo "[sigh] I disagree." > podcast/scripts/03_guest2.txt

# 3. Generate with different voices (if available)
speak podcast/scripts/01_host.txt --voice ~/.chatter/voices/host.wav --output podcast/wav/01.wav
speak podcast/scripts/02_guest1.txt --voice ~/.chatter/voices/guest1.wav --output podcast/wav/02.wav
speak podcast/scripts/03_guest2.txt --voice ~/.chatter/voices/guest2.wav --output podcast/wav/03.wav

# Or use default voice for all (simpler)
speak podcast/scripts/01_host.txt --output podcast/wav/01.wav
speak podcast/scripts/02_guest1.txt --output podcast/wav/02.wav
speak podcast/scripts/03_guest2.txt --output podcast/wav/03.wav

# 4. Concatenate
speak concat podcast/wav/01.wav podcast/wav/02.wav podcast/wav/03.wav --output debate.wav
```

## PDF to Audiobook Example

```bash
# 1. Install dependencies
brew install poppler sox

# 2. Split PDF into chapters (50 pages → 5 chapters of 10 pages)
pdftotext -f 1 -l 10 -layout manual.pdf chapter01.txt
pdftotext -f 11 -l 20 -layout manual.pdf chapter02.txt
pdftotext -f 21 -l 30 -layout manual.pdf chapter03.txt
pdftotext -f 31 -l 40 -layout manual.pdf chapter04.txt
pdftotext -f 41 -l 50 -layout manual.pdf chapter05.txt

# 3. Check estimates
speak --estimate chapter*.txt

# 4. Generate all chapters
mkdir -p audiobook/
speak chapter01.txt chapter02.txt chapter03.txt chapter04.txt chapter05.txt \
  --output-dir audiobook/ --auto-chunk

# 5. Concatenate
speak concat audiobook/chapter01.wav audiobook/chapter02.wav \
  audiobook/chapter03.wav audiobook/chapter04.wav audiobook/chapter05.wav \
  --output complete_audiobook.wav
```

## Options Reference

| Option | Description | Default |
|--------|-------------|---------|
| `--stream` | Stream audio as it generates | false |
| `--play` | Play audio after generation | false |
| `--output <path>` | Output file (.wav) | ~/Audio/speak/ |
| `--output-dir <dir>` | Output directory for batch | - |
| `--voice <path>` | Voice file (full path required) | built-in default |
| `--timeout <sec>` | Timeout per file | 300 |
| `--auto-chunk` | Split long documents | false |
| `--chunk-size <n>` | Max chars per chunk | 6000 |
| `--resume <file>` | Resume from manifest | - |
| `--keep-chunks` | Keep intermediate files | false |
| `--skip-existing` | Skip if output exists | false |
| `--estimate` | Show duration estimate | false |
| `--dry-run` | Preview only | false |
| `--quiet` | Suppress output | false |

## Commands

| Command | Description |
|---------|-------------|
| `speak setup` | Set up environment |
| `speak health` | Check system status |
| `speak models` | List TTS models |
| `speak concat` | Concatenate audio (requires sox) |
| `speak daemon kill` | Stop TTS server |
| `speak config` | Show configuration |

## Performance & Storage

| Metric | Value |
|--------|-------|
| Cold start | ~4-8s (model loading) |
| Warm start | ~3-8s (model cached) |
| Generation speed | ~0.3-0.5x RTF (faster than real-time) |
| Storage | ~2.5 MB/min, ~150 MB/hour |

### Time Estimation

```bash
speak --estimate document.txt

# Quick estimates:
# 1 page ≈ 500 words ≈ 2 min audio ≈ 1 min generation
# 50 pages ≈ 100 min audio ≈ 50 min generation
```

## Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| "Voice file not found" | Wrong path | Use full path: `~/.chatter/voices/name.wav` |
| "Output directory doesn't exist" | Custom dir not created | `mkdir -p dirname/` |
| "sox not found" | sox not installed | `brew install sox` |
| Scrambled concat order | Non-zero-padded names | Use `01_`, `02_`, not `1_`, `2_` |
| Timeout | >5 min generation | Use `--auto-chunk` |
| "Server not running" | Stale daemon | `speak daemon kill && speak health` |

## Setup

```bash
# Auto-setup on first run
speak "test"

# Or manual setup
speak setup
```

## Server Management

Server auto-starts and shuts down after 1 hour idle.

```bash
speak health        # Check status
speak daemon kill   # Stop manually
```
