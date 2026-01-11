---
name: speak-tts
description: Local text-to-speech generation using Chatterbox TTS on Apple Silicon. Use this when users request converting text to audio, reading articles/documents aloud, generating speech from clipboard content, voice cloning, or creating audiobook-style narration. Runs entirely on-device via MLX for private TTS. Supports auto-chunking for long documents, batch processing, and resume capability.
---

# speak - Text to Speech for Agents

Convert text to natural speech audio using Chatterbox TTS on Apple Silicon.

## Prerequisites

Before using this tool, verify these requirements:

| Requirement | Check Command | Install |
|-------------|---------------|---------|
| Apple Silicon Mac (M1/M2/M3/M4) | Required | Not available on Intel Macs |
| macOS 12.0+ | `sw_vers` | - |
| sox (for auto-chunking/concat) | `which sox` | `brew install sox` |
| poppler (for PDF conversion) | `which pdftotext` | `brew install poppler` |

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

## Voice System

### Default Voice

When `--voice` is omitted, the tool uses a built-in default voice. This voice is consistent across all generations.

### Checking Available Voices

```bash
# List custom voice samples
ls ~/.chatter/voices/*.wav 2>/dev/null

# If directory is empty or doesn't exist:
# - Default voice is used automatically
# - Add custom voices (see "Adding Voice Samples" below)
```

**Note:** The example voice names in this documentation (stephen_fry, morgan_freeman, ursula_leguin) are illustrative. You must provide your own voice samples - they are NOT pre-installed.

### Using Custom Voices

**Always use the full path to voice files:**

```bash
# Correct - full path required
speak "Hello" --voice ~/.chatter/voices/narrator.wav --stream

# WRONG - will fail with "Voice file not found"
speak "Hello" --voice narrator.wav --stream
```

### Adding Voice Samples

To add a custom voice:
1. Get a clean 10-30 second audio sample
   - WAV format, 24kHz mono preferred
   - Clear speech, minimal background noise
   - SNR > 20dB recommended
2. Create directory if needed: `mkdir -p ~/.chatter/voices/`
3. Save to `~/.chatter/voices/speaker_name.wav`
4. Use with `--voice ~/.chatter/voices/speaker_name.wav`

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
# Create output directory first (NOT auto-created)
mkdir -p ~/Audio/book/

# Process multiple files at once
speak chapter1.md chapter2.md chapter3.md --output-dir ~/Audio/book/

# Output naming: input filename with .wav extension
# chapter1.md → ~/Audio/book/chapter1.wav
# chapter2.md → ~/Audio/book/chapter2.wav

# Skip files that already have output
speak chapters/*.md --output-dir ~/Audio/book/ --skip-existing

# Batch processing with auto-chunking (works together)
speak chapters/*.md --output-dir ~/Audio/book/ --auto-chunk
# Each file is chunked independently
# Intermediate chunks: ~/Audio/speak/chapter1_chunk_001.wav, etc.
# Final output: ~/Audio/book/chapter1.wav (concatenated)
```

### Resume Behavior

Resume works differently depending on mode:

| Mode | Resume Support | How |
|------|----------------|-----|
| Single file + `--auto-chunk` | ✓ | `speak --resume ~/Audio/speak/manifest.json` |
| Batch processing | Partial | Use `--skip-existing` to skip completed files |

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
# Explicit file order (concatenates in order specified)
speak concat part1.wav part2.wav part3.wav --output combined.wav

# Using glob (alphanumeric sort - REQUIRES zero-padded names!)
speak concat wav/*.wav --output combined.wav
# ✓ 01.wav, 02.wav, 03.wav, 10.wav → correct order
# ✗ 1.wav, 2.wav, 10.wav → WRONG (sorts as 1, 10, 2)
```

**Zero-padding rule:**
- 1-9 files: `01`, `02`, ..., `09`
- 10-99 files: `01`, `02`, ..., `99`
- 100+ files: `001`, `002`, ..., `999`

## Options Reference

| Option | Description | Default |
|--------|-------------|---------|
| `--stream` | Stream audio as it generates | false |
| `--play` | Play audio after generation | false |
| `--output <path>` | Output file (.wav) or directory | ~/Audio/speak/ |
| `--voice <path>` | Voice .wav file for cloning (full path required) | built-in default |
| `--timeout <sec>` | Generation timeout per file | 300 |
| `--auto-chunk` | Chunk long documents automatically | false |
| `--chunk-size <n>` | Max chars per chunk | 6000 |
| `--resume <file>` | Resume from manifest file | - |
| `--keep-chunks` | Keep intermediate chunk files | false |
| `--output-dir <dir>` | Output directory for batch mode | - |
| `--skip-existing` | Skip files if output exists (by filename) | false |
| `--estimate` | Show duration estimate only | false |
| `--dry-run` | Preview without generating | false |
| `--quiet` | Suppress output except errors | false |

## Commands

| Command | Description |
|---------|-------------|
| `speak setup` | Set up Python environment |
| `speak health` | Check system health |
| `speak models` | List available TTS models |
| `speak concat` | Concatenate audio files (requires sox) |
| `speak daemon kill` | Stop the TTS server |
| `speak config` | Show current configuration |

## Emotion Tags

Add expressive sounds inline with text. **Tags produce audible effects** (actual laughter, sighing sounds) - they are NOT spoken aloud.

```bash
speak "[sigh] I can't believe it's Monday again." --stream
# Output: (audible sigh sound) "I can't believe it's Monday again."

speak "[laugh] That's hilarious!" --stream
# Output: (audible laughter) "That's hilarious!"
```

**Placement:** Tags work at sentence start OR mid-sentence:
- `"[sigh] I think this is wrong"` - sigh before speaking
- `"I think [sigh] this is wrong"` - sigh mid-sentence (less natural)

### Supported Tags

| Tag | Effect |
|-----|--------|
| `[laugh]` | Laughing sound |
| `[chuckle]` | Light chuckle sound |
| `[sigh]` | Sighing sound |
| `[gasp]` | Gasping sound |
| `[groan]` | Groaning sound |
| `[clear throat]` | Throat clearing sound |
| `[cough]` | Coughing sound |
| `[crying]` | Crying/emotional sound |
| `[singing]` | Sung speech style |

**Not supported:** `[pause]`, `[whisper]`

**For pauses:** Use punctuation:
- Ellipsis: `"I think... this is important"`
- Period: `"Wait. Let me reconsider."`

## Performance & Storage

- **Cold start**: ~4-8s to first audio (model loading)
- **Warm start**: ~3-8s to first audio (model cached)
- **Generation speed**: ~0.3-0.5x RTF (faster than real-time)
- **Streaming**: Audio starts after ~250 chars

### Storage Requirements

| Duration | File Size (24kHz mono WAV) |
|----------|---------------------------|
| 1 minute | ~2.5 MB |
| 1 hour | ~150 MB |
| 10 hours | ~1.5 GB |

### Time Estimation

```bash
# Get time estimate before committing
speak --estimate document.md

# Output:
# Input: 24,011 characters (~4,800 words)
# Estimated audio: ~25 minutes
# Estimated generation time: ~12 minutes

# Quick page estimates:
# 1 page ≈ 500 words ≈ 2,500 chars ≈ 2 min audio ≈ 1 min generation
# 50 pages ≈ 25,000 words ≈ 100 min audio ≈ 50 min generation
```

## Multi-Voice Content (Podcasts, Debates, Dramas)

For content with multiple speakers, generate segments separately then concatenate.

### Full Workflow

```bash
# 1. Check available voices (or use default if empty)
ls ~/.chatter/voices/*.wav 2>/dev/null || echo "Using default voice"

# 2. Create directories
mkdir -p podcast/scripts podcast/wav

# 3. Create script files (zero-padded for correct ordering)
cat > podcast/scripts/01_host_intro.txt << 'EOF'
[clear throat] Welcome to AI Debates. Today we discuss whether 
artificial intelligence poses existential risks to humanity.
EOF

cat > podcast/scripts/02_guest1_opening.txt << 'EOF'
Thank you for having me. I believe concerns about AI safety 
are manageable. We have robust alignment techniques.
EOF

cat > podcast/scripts/03_guest2_counter.txt << 'EOF'
[sigh] I respectfully disagree. The pace of development is 
outstripping our ability to ensure safety.
EOF

cat > podcast/scripts/04_host_closing.txt << 'EOF'
Fascinating perspectives from both guests. Thank you for joining us.
EOF

# 4. Generate each segment
# Option A: Using custom voices (if available)
speak podcast/scripts/01_host_intro.txt --voice ~/.chatter/voices/host.wav --output podcast/wav/01.wav
speak podcast/scripts/02_guest1_opening.txt --voice ~/.chatter/voices/guest1.wav --output podcast/wav/02.wav
speak podcast/scripts/03_guest2_counter.txt --voice ~/.chatter/voices/guest2.wav --output podcast/wav/03.wav
speak podcast/scripts/04_host_closing.txt --voice ~/.chatter/voices/host.wav --output podcast/wav/04.wav

# Option B: Using default voice (if no custom voices)
speak podcast/scripts/01_host_intro.txt --output podcast/wav/01.wav
speak podcast/scripts/02_guest1_opening.txt --output podcast/wav/02.wav
speak podcast/scripts/03_guest2_counter.txt --output podcast/wav/03.wav
speak podcast/scripts/04_host_closing.txt --output podcast/wav/04.wav

# 5. Concatenate (explicit order recommended)
speak concat podcast/wav/01.wav podcast/wav/02.wav podcast/wav/03.wav podcast/wav/04.wav --output debate.wav

# 6. Play result
afplay debate.wav
```

### Segment Length Guidelines

Keep individual segments under 5,000 characters (~5 min audio) to avoid timeouts. For longer segments, use `--auto-chunk`:

```bash
speak long_monologue.txt --voice ~/.chatter/voices/speaker.wav --auto-chunk --output segment.wav
```

## Complete Example: PDF to Audiobook

```bash
# 1. Install dependencies
brew install poppler sox

# 2. Convert PDF to text (split by chapters)
# For 50 pages, split into ~5 chapters of 10 pages each
pdftotext -f 1 -l 10 -layout manual.pdf chapter01.txt
pdftotext -f 11 -l 20 -layout manual.pdf chapter02.txt
pdftotext -f 21 -l 30 -layout manual.pdf chapter03.txt
pdftotext -f 31 -l 40 -layout manual.pdf chapter04.txt
pdftotext -f 41 -l 50 -layout manual.pdf chapter05.txt

# 3. Verify file naming (must be zero-padded!)
ls chapter*.txt
# Should show: chapter01.txt chapter02.txt chapter03.txt chapter04.txt chapter05.txt

# 4. Estimate time (50 pages ≈ 100 min audio ≈ 50 min generation)
speak --estimate chapter*.txt

# 5. Check disk space (100 min ≈ 250 MB)
df -h ~

# 6. Create output directory (required)
mkdir -p audiobook/

# 7. Generate all chapters with auto-chunking
speak chapter01.txt chapter02.txt chapter03.txt chapter04.txt chapter05.txt --output-dir audiobook/ --auto-chunk

# 8. Verify all chapters generated
ls audiobook/
# Should show: chapter01.wav chapter02.wav chapter03.wav chapter04.wav chapter05.wav

# 9. Concatenate (explicit order for safety)
speak concat audiobook/chapter01.wav audiobook/chapter02.wav audiobook/chapter03.wav audiobook/chapter04.wav audiobook/chapter05.wav --output complete_audiobook.wav

# 10. Play result
afplay complete_audiobook.wav
```

### PDF Troubleshooting

| Issue | Solution |
|-------|----------|
| Garbled text output | Try without `-layout`: `pdftotext manual.pdf out.txt` |
| Scanned PDF (images) | Use OCR: `brew install tesseract` then OCR first |
| Encrypted PDF | Decrypt first: `qpdf --decrypt input.pdf output.pdf` |
| Wrong page count | Check pages: `pdfinfo manual.pdf` |

## Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| "Voice file not found" | Wrong path or missing file | Use full path: `~/.chatter/voices/name.wav` |
| "Output directory doesn't exist" | Directory not created | `mkdir -p dirname/` first |
| "sox not found" | sox not installed | `brew install sox` |
| Scrambled concatenation order | Non-zero-padded filenames | Use `01_`, `02_`, not `1_`, `2_` |
| Timeout on long file | >5 min generation | Use `--auto-chunk` or `--timeout 600` |
| "Server not running" | Stale daemon state | `speak daemon kill && speak health` |
| Emotion tags not working | sox not installed | `brew install sox` |

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
- Voice samples in documentation are examples - you must provide your own
