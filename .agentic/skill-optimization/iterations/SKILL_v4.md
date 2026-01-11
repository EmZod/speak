---
name: speak-tts
description: Local text-to-speech generation using Chatterbox TTS on Apple Silicon. Use this when users request converting text to audio, reading articles/documents aloud, generating speech from clipboard content, voice cloning, or creating audiobook-style narration. Runs entirely on-device via MLX for private TTS. Supports auto-chunking for long documents, batch processing, and resume capability.
---

# speak - Text to Speech for Agents

Convert text to natural speech audio using Chatterbox TTS on Apple Silicon.

## Prerequisites

| Requirement | Check | Install |
|-------------|-------|---------|
| Apple Silicon Mac | `uname -m` → arm64 | Intel Macs not supported |
| macOS 12.0+ | `sw_vers` | - |
| sox | `which sox` | `brew install sox` |
| ffmpeg (for voice prep) | `which ffmpeg` | `brew install ffmpeg` |
| poppler (for PDF) | `which pdftotext` | `brew install poppler` |

## Input Sources

| Source | Example | Notes |
|--------|---------|-------|
| Text file | `speak article.txt` | .txt, .md supported |
| Direct string | `speak "Hello"` | Quote the text |
| Clipboard | `pbpaste \| speak` | Pipe from clipboard |
| Stdin | `cat file.txt \| speak` | Pipe any text |
| URL | See "Web Articles" below | Requires conversion |

### Web Articles

```bash
# Method 1: lynx (brew install lynx)
lynx -dump -nolist "https://example.com/article" | speak --output article.wav

# Method 2: curl + pandoc (brew install pandoc)
curl -s "https://example.com/article" | pandoc -f html -t plain | speak --output article.wav
```

### Converting Formats

| Format | Convert Command |
|--------|-----------------|
| PDF | `pdftotext doc.pdf doc.txt` |
| DOCX | `textutil -convert txt doc.docx` |
| HTML | `pandoc -f html -t plain doc.html > doc.txt` |
| PPTX | Export to PDF first, then `pdftotext` |

## Output Modes

| Goal | Command | Behavior |
|------|---------|----------|
| Save for later | `speak text.txt --output file.wav` | Generates silently |
| Listen now (streaming) | `speak text.txt --stream` | Plays as it generates |
| Listen now (complete) | `speak text.txt --play` | Waits, then plays |
| Both save and listen | `speak text.txt --stream --output file.wav` | Simultaneous |

### Default Behavior

```bash
# Without flags, saves to ~/Audio/speak/ (auto-created)
speak article.txt
# → Creates: ~/Audio/speak/article.wav

speak "Hello world"
# → Creates: ~/Audio/speak/speak_<timestamp>.wav
```

## Directory Auto-Creation

| Directory | Auto-Created? |
|-----------|---------------|
| `~/Audio/speak/` | ✓ Yes (default output) |
| `~/.chatter/voices/` | ✗ No - create first |
| Custom output directories | ✗ No - create first |

Always create custom directories before use:
```bash
mkdir -p ~/.chatter/voices/
mkdir -p ~/Audio/custom/
```

## Voice Cloning

Voice cloning uses a short recording of your voice to generate speech that matches your vocal characteristics (pitch, tone, cadence). The TTS model adapts to sound like your sample.

### How It Works

1. You provide a 10-30 second WAV sample of your voice
2. The model analyzes your voice characteristics
3. Generated speech approximates your voice style

**Quality expectations:** The output captures general voice characteristics but is not a perfect replica. Quality depends heavily on sample quality.

### Recording Your Voice Sample

**Using QuickTime (macOS):**
1. Open QuickTime Player
2. File → New Audio Recording
3. Record 15-30 seconds of clear speech
4. File → Export As → Audio Only (.m4a)
5. Convert to WAV (see below)

**Using sox (command line):**
```bash
# Record 30 seconds directly to WAV
sox -d -r 24000 -c 1 ~/.chatter/voices/my_voice.wav trim 0 30
```

### Converting Audio to Required Format

Voice samples MUST be:
- **Format:** WAV (required)
- **Sample rate:** 24000 Hz (required)
- **Channels:** 1/mono (required)
- **Duration:** 10-30 seconds

```bash
# From MP3
ffmpeg -i voice.mp3 -ar 24000 -ac 1 voice.wav

# From M4A (QuickTime export)
ffmpeg -i voice.m4a -ar 24000 -ac 1 voice.wav

# From stereo WAV
ffmpeg -i stereo.wav -ar 24000 -ac 1 mono.wav

# Trim to 30 seconds
ffmpeg -i long.wav -t 30 -ar 24000 -ac 1 trimmed.wav

# Using sox instead
sox input.m4a -r 24000 -c 1 output.wav trim 0 30
```

### Using Your Cloned Voice

```bash
# Create directory first
mkdir -p ~/.chatter/voices/

# Save your prepared sample
mv voice.wav ~/.chatter/voices/my_voice.wav

# Test it
speak "Testing my cloned voice" --voice ~/.chatter/voices/my_voice.wav --stream

# Use full path (REQUIRED - relative paths fail)
speak notes.txt --voice ~/.chatter/voices/my_voice.wav --output presentation.wav
```

### Voice Sample Tips

**Good sample:**
- Quiet room, no background noise
- Natural speaking pace (not rushed)
- Clear diction, consistent volume
- Read varied content (not repetitive phrases)

**Bad sample:**
- Background noise/music
- Whispering or shouting
- Multiple speakers
- Very short (\<10s) or monotone

## Default Voice

When `--voice` is omitted, the tool uses a **built-in default voice**:
```bash
speak "Hello world" --stream  # Uses default voice
```

## Emotion Tags

Add expressive sounds to speech. Tags produce **audible effects**:

```bash
speak "[sigh] I can't believe it's Monday." --stream
# Output: (audible sigh) "I can't believe it's Monday."

speak "[laugh] That's hilarious!" --stream
# Output: (laughter sound) "That's hilarious!"
```

### Supported Tags

| Tag | Effect |
|-----|--------|
| `[laugh]` | Laughter |
| `[chuckle]` | Light chuckle |
| `[sigh]` | Sighing |
| `[gasp]` | Gasping |
| `[groan]` | Groaning |
| `[clear throat]` | Throat clearing |
| `[cough]` | Coughing |
| `[crying]` | Crying |
| `[singing]` | Sung speech |

**NOT supported:** `[pause]`, `[whisper]` (ignored)

**For pauses:** Use punctuation: `"Wait... let me think."` or `"Stop. Now."`

## Quick Start Examples

### Save Article for Later
```bash
speak article.txt --output ~/Audio/article.wav
afplay ~/Audio/article.wav  # Play anytime
```

### Read Clipboard Aloud
```bash
pbpaste | speak --stream
```

### Clone Voice and Read Presentation
```bash
# 1. Prepare voice sample
ffmpeg -i recording.m4a -ar 24000 -ac 1 ~/.chatter/voices/my_voice.wav

# 2. Read notes with your voice
speak notes.txt --voice ~/.chatter/voices/my_voice.wav --stream
```

### Long Document
```bash
# Check length first
speak --estimate document.txt

# If >10 min audio, use auto-chunk
speak document.txt --auto-chunk --output document.wav
```

## Batch Processing

```bash
# Create output directory first
mkdir -p ~/Audio/book/

# Process multiple files
speak ch1.txt ch2.txt ch3.txt --output-dir ~/Audio/book/
# Creates: ch1.wav, ch2.wav, ch3.wav

# With auto-chunking for long files
speak chapters/*.txt --output-dir ~/Audio/book/ --auto-chunk

# Skip already-generated
speak chapters/*.txt --output-dir ~/Audio/book/ --skip-existing
```

## Concatenating Audio

```bash
# Explicit order (recommended)
speak concat part1.wav part2.wav part3.wav --output combined.wav

# Glob (requires zero-padded names: 01, 02, 03...)
speak concat wav/*.wav --output combined.wav
```

**Zero-padding:** `01.wav, 02.wav` not `1.wav, 2.wav`

## Multi-Voice Content

```bash
# 1. Create directories
mkdir -p podcast/scripts podcast/wav

# 2. Create scripts (zero-padded)
echo "Welcome to the show." > podcast/scripts/01_host.txt
echo "Thanks for having me." > podcast/scripts/02_guest.txt

# 3. Generate with different voices
speak podcast/scripts/01_host.txt --voice ~/.chatter/voices/host.wav --output podcast/wav/01.wav
speak podcast/scripts/02_guest.txt --voice ~/.chatter/voices/guest.wav --output podcast/wav/02.wav

# 4. Concatenate
speak concat podcast/wav/01.wav podcast/wav/02.wav --output podcast.wav
```

## PDF to Audiobook

```bash
# 1. Install dependencies
brew install poppler sox

# 2. Split PDF into chapters
pdftotext -f 1 -l 10 -layout manual.pdf ch01.txt
pdftotext -f 11 -l 20 -layout manual.pdf ch02.txt

# 3. Check estimate
speak --estimate ch*.txt

# 4. Generate
mkdir -p audiobook/
speak ch01.txt ch02.txt --output-dir audiobook/ --auto-chunk

# 5. Concatenate
speak concat audiobook/ch01.wav audiobook/ch02.wav --output full_audiobook.wav
```

## Options Reference

| Option | Description | Default |
|--------|-------------|---------|
| `--stream` | Stream audio as it generates | false |
| `--play` | Play after generation | false |
| `--output <path>` | Output file (.wav) | ~/Audio/speak/ |
| `--output-dir <dir>` | Batch output directory | - |
| `--voice <path>` | Voice sample (full path) | default |
| `--timeout <sec>` | Timeout per file | 300 |
| `--auto-chunk` | Split long documents | false |
| `--chunk-size <n>` | Chars per chunk | 6000 |
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
| `speak concat` | Concatenate audio |
| `speak daemon kill` | Stop TTS server |
| `speak config` | Show configuration |

## Performance

| Metric | Value |
|--------|-------|
| Cold start | ~4-8s |
| Warm start | ~3-8s |
| Speed | ~0.3-0.5x RTF (faster than real-time) |
| Storage | ~2.5 MB/min, ~150 MB/hour |

### Estimation

```bash
speak --estimate document.txt

# Quick estimates:
# 1 page ≈ 500 words ≈ 2 min audio ≈ 1 min generation
# 50 pages ≈ 100 min audio ≈ 50 min generation
```

## Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| "Voice file not found" | Wrong path or missing | Use full path: `~/.chatter/voices/x.wav` |
| "Invalid WAV format" | Wrong sample rate/channels | Convert: `ffmpeg -i in.wav -ar 24000 -ac 1 out.wav` |
| "Voice sample too short" | <10 seconds | Record 10-30 second sample |
| "Output directory doesn't exist" | Custom dir not created | `mkdir -p dirname/` |
| "sox not found" | sox not installed | `brew install sox` |
| Scrambled concat order | Non-zero-padded names | Use `01_`, `02_`, not `1_`, `2_` |
| Timeout | >5 min generation | Use `--auto-chunk` |
| "Server not running" | Stale daemon | `speak daemon kill && speak health` |

## Setup

```bash
speak "test"     # Auto-setup on first run
speak setup      # Or manual setup
```

## Server Management

Server auto-starts and shuts down after 1 hour idle.

```bash
speak health        # Check status
speak daemon kill   # Stop manually
```
