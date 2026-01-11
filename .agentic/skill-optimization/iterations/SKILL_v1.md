---
name: speak-tts
description: Local text-to-speech generation using Chatterbox TTS on Apple Silicon. Use this when users request converting text to audio, reading articles/documents aloud, generating speech from clipboard content, voice cloning, or creating audiobook-style narration. Runs entirely on-device via MLX for private TTS. Supports auto-chunking for long documents, batch processing, and resume capability.
---

# speak - Text to Speech for Agents

Convert text to natural speech audio using Chatterbox TTS on Apple Silicon.

## Prerequisites

Before using this tool:

| Requirement | Check | Install |
|-------------|-------|---------|
| Apple Silicon Mac (M1/M2/M3/M4) | Required | Not available on Intel Macs |
| macOS 12.0+ | Required | - |
| sox (for auto-chunking/concat) | `which sox` | `brew install sox` |

## Supported Input Formats

| Format | Supported | Example |
|--------|-----------|---------|
| Plain text (.txt) | ✓ | `speak article.txt` |
| Markdown (.md) | ✓ | `speak document.md` |
| Direct string | ✓ | `speak "Hello world"` |
| PDF | ✗ | Convert first: `pdftotext doc.pdf doc.txt` |
| DOCX/HTML | ✗ | Convert to .txt first |

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

# Output naming: input filename with .wav extension
# chapter1.md → ~/Audio/book/chapter1.wav
# chapter2.md → ~/Audio/book/chapter2.wav

# Skip files that already have output
speak chapters/*.md --output-dir ~/Audio/book/ --skip-existing

# Batch processing with auto-chunking (works together)
speak chapters/*.md --output-dir ~/Audio/book/ --auto-chunk
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
speak concat part1.wav part2.wav part3.wav --output combined.wav

# Using glob (files sorted alphanumerically - use zero-padded names!)
speak concat wav/*.wav --output combined.wav
# 01.wav, 02.wav, 03.wav → correct order
# 1.wav, 10.wav, 2.wav → WRONG order (use zero-padding)
```

## Options Reference

| Option | Description | Default |
|--------|-------------|---------|
| `--stream` | Stream audio as it generates | false |
| `--play` | Play audio after generation | false |
| `--output <path>` | Output file (.wav) or directory | ~/Audio/speak/ |
| `--voice <path>` | Voice .wav file for cloning (full path required) | default |
| `--timeout <sec>` | Generation timeout per file | 300 |
| `--auto-chunk` | Chunk long documents automatically | false |
| `--chunk-size <n>` | Max chars per chunk | 6000 |
| `--resume <file>` | Resume from manifest file | - |
| `--keep-chunks` | Keep intermediate chunk files | false |
| `--output-dir <dir>` | Output directory for batch mode | - |
| `--skip-existing` | Skip files with existing output (by filename) | false |
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

## Performance & Storage

- **Cold start**: ~4-8s to first audio (model loading + generation)
- **Warm start**: ~3-8s to first audio (model already loaded)
- **Generation speed**: ~0.3-0.5x RTF on Apple Silicon (faster than real-time)
- **Streaming**: Audio starts after first chunk (~250 chars)

### Storage Requirements

| Duration | File Size (24kHz mono WAV) |
|----------|---------------------------|
| 1 minute | ~2.5 MB |
| 1 hour | ~150 MB |
| 10 hours | ~1.5 GB |

### Estimation

```bash
# Get time estimate before committing
speak --estimate document.md

# Output:
# Input: 24,011 characters (~4,800 words)
# Estimated audio: ~25 minutes
# Estimated generation time: ~12 minutes
# RTF: 0.40x

# Rough page estimates:
# 1 page ≈ 500 words ≈ 2,500 chars ≈ 2 min audio
# 50 pages ≈ 25,000 words ≈ 100 min audio
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

Voice samples are stored in `~/.chatter/voices/`. Check what's available:

```bash
# List available voice samples
ls ~/.chatter/voices/*.wav 2>/dev/null

# If empty or directory doesn't exist:
# - The tool uses a default voice
# - Add your own samples (see "Adding New Voice Samples" below)
```

### Using a Custom Voice

**Always use the full path to voice files:**

```bash
# Correct - full path
speak "Hello world" --voice ~/.chatter/voices/morgan_freeman.wav --stream

# WRONG - will fail
speak "Hello world" --voice morgan_freeman.wav --stream
```

### Multi-Voice Content (Debates, Dramas, Podcasts)

For content with multiple speakers:

1. **Create output directory first:**
   ```bash
   mkdir -p wav/
   ```

2. **Split script into separate files per speaker (use zero-padded numbers):**
   ```
   01_host_intro.txt
   02_guest1_response.txt
   03_host_followup.txt
   04_guest2_rebuttal.txt
   ```

3. **Generate each segment with appropriate voice (full paths required):**
   ```bash
   speak 01_host_intro.txt --voice ~/.chatter/voices/stephen_fry.wav --output wav/01.wav
   speak 02_guest1_response.txt --voice ~/.chatter/voices/morgan_freeman.wav --output wav/02.wav
   speak 03_host_followup.txt --voice ~/.chatter/voices/stephen_fry.wav --output wav/03.wav
   speak 04_guest2_rebuttal.txt --voice ~/.chatter/voices/ursula_leguin.wav --output wav/04.wav
   ```

4. **Concatenate in order:**
   ```bash
   speak concat wav/01.wav wav/02.wav wav/03.wav wav/04.wav --output final_debate.wav
   # Or with glob (only if zero-padded):
   speak concat wav/*.wav --output final_debate.wav
   ```

### Adding New Voice Samples

To add a new voice for cloning:
1. Get a clean 10-30 second audio sample
   - WAV format, 24kHz mono preferred
   - Clear speech, minimal background noise
2. Save to `~/.chatter/voices/speaker_name.wav`
3. Use with `--voice ~/.chatter/voices/speaker_name.wav`

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

**Not supported:** `[pause]`, `[whisper]`

**For pauses:** Use punctuation instead:
- Ellipsis: `"I think... this is important"`
- Period: `"Wait. Let me reconsider."`

## Complete Example: PDF to Audiobook

```bash
# 1. Convert PDF to text (requires poppler: brew install poppler)
pdftotext -layout manual.pdf manual.txt

# 2. Or split into chapters
pdftotext -f 1 -l 10 manual.pdf chapter01.txt
pdftotext -f 11 -l 25 manual.pdf chapter02.txt
pdftotext -f 26 -l 50 manual.pdf chapter03.txt

# 3. Estimate total time
speak --estimate chapter01.txt chapter02.txt chapter03.txt

# 4. Generate all chapters with auto-chunking
mkdir -p audiobook/
speak chapter*.txt --output-dir audiobook/ --auto-chunk

# 5. Concatenate into single audiobook
speak concat audiobook/chapter01.wav audiobook/chapter02.wav audiobook/chapter03.wav --output complete_audiobook.wav
```

## Complete Example: Multi-Voice Podcast

```bash
# 1. Check available voices
ls ~/.chatter/voices/*.wav

# 2. Create script files with emotion tags
mkdir -p podcast/scripts podcast/wav

cat > podcast/scripts/01_host_intro.txt << 'EOF'
[clear throat] Welcome to AI Debates! Today we're discussing AI safety 
with two brilliant guests.
EOF

cat > podcast/scripts/02_guest1.txt << 'EOF'
Thanks for having me. I believe AI alignment is fundamentally solvable.
EOF

cat > podcast/scripts/03_guest2.txt << 'EOF'
[sigh] I wish I shared that optimism. The challenges are immense.
EOF

# 3. Generate each segment
speak podcast/scripts/01_host_intro.txt --voice ~/.chatter/voices/stephen_fry.wav --output podcast/wav/01.wav
speak podcast/scripts/02_guest1.txt --voice ~/.chatter/voices/morgan_freeman.wav --output podcast/wav/02.wav
speak podcast/scripts/03_guest2.txt --voice ~/.chatter/voices/ursula_leguin.wav --output podcast/wav/03.wav

# 4. Concatenate
speak concat podcast/wav/01.wav podcast/wav/02.wav podcast/wav/03.wav --output ai_safety_debate.wav

# 5. Play result
afplay ai_safety_debate.wav
```

## Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| "Voice file not found" | Wrong path or missing file | Use full path: `~/.chatter/voices/name.wav` |
| "Output directory doesn't exist" | Parent directory missing | Create first: `mkdir -p dirname/` |
| "sox not found" | sox not installed | `brew install sox` |
| Scrambled concatenation order | Non-zero-padded filenames | Use `01_`, `02_`, not `1_`, `2_` |
| Timeout on long file | File too long for 300s default | Use `--auto-chunk` or `--timeout 600` |
| "Server not running" | Stale daemon state | `speak daemon kill && speak health` |

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

## Notes

- Audio format: WAV 24kHz mono
- Use `--stream` for text longer than a few sentences
- Use `--auto-chunk` for documents >10 minutes of audio
- Output directories are NOT auto-created - use `mkdir -p` first
