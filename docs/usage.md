# Usage Guide

Complete usage documentation for speak.

## Basic Usage

```bash
# Text input
speak "Hello, world!"

# File input
speak article.txt
speak document.md

# Clipboard input
speak --clipboard
speak -c

# Play audio after generation
speak "Hello!" --play

# Stream audio as it generates (for long text)
speak article.md --stream
```

## Long Documents

For documents that might timeout (>5 min generation):

```bash
# Auto-chunk long documents for reliable generation
speak book-chapter.md --auto-chunk --output chapter.wav

# Get duration estimate before generating
speak --estimate document.md

# Resume interrupted generation
speak --resume ~/.chatter/manifest.json

# Preview without generating
speak --dry-run document.md --auto-chunk

# Keep intermediate chunks for inspection
speak document.md --auto-chunk --output doc.wav --keep-chunks
```

### How Auto-Chunking Works

1. Text is split at sentence boundaries (~6000 chars per chunk by default)
2. Each chunk is generated and saved to disk immediately
3. A manifest file tracks progress
4. On completion, chunks are concatenated with sox
5. If interrupted, use `--resume` to continue

## Batch Processing

Process multiple files at once:

```bash
# Process multiple files
speak chapter1.md chapter2.md chapter3.md --output-dir ~/Audio/book/

# Skip already-generated files
speak *.md --output-dir ~/Audio/ --skip-existing

# Stop on first error (default: continue)
speak *.md --output-dir ~/Audio/ --stop-on-error
```

Output files are named after input files (e.g., `chapter1.md` → `chapter1.wav`).

## Concatenating Audio Files

Combine multiple audio files into one:

```bash
speak concat part1.wav part2.wav part3.wav --out combined.wav
```

Files are sorted naturally, so `chunk_0001.wav`, `chunk_0002.wav`, etc. are handled correctly.

Requires sox: `brew install sox`

## Markdown Processing

```bash
# Strip markdown syntax (default)
speak document.md --markdown plain

# Smart mode: adds [clear throat] before headers for emphasis
speak document.md --markdown smart
```

### Code Block Handling

```bash
speak document.md --code-blocks read        # Read code verbatim (default)
speak document.md --code-blocks skip        # Skip code blocks entirely
speak document.md --code-blocks placeholder # Replace with "[code block omitted]"
```

## Voice & Model Options

```bash
# List available models
speak models

# Use a specific model
speak "Hello" --model mlx-community/chatterbox-turbo-fp16

# Adjust temperature (0-1, default 0.5)
speak "Hello" --temp 0.7

# Adjust speed (0-2, default 1.0)
speak "Hello" --speed 1.2

# Voice cloning with reference audio
speak "Hello" --voice ~/voices/sample.wav
```

### Available Models

| Model | Description |
|-------|-------------|
| `mlx-community/chatterbox-turbo-8bit` | 8-bit quantized, fastest (default) |
| `mlx-community/chatterbox-turbo-fp16` | Full precision, highest quality |
| `mlx-community/chatterbox-turbo-4bit` | 4-bit quantized, smallest memory |
| `mlx-community/chatterbox-turbo-5bit` | 5-bit quantized |
| `mlx-community/chatterbox-turbo-6bit` | 6-bit quantized |

## Output Options

```bash
# Output to specific file
speak "Hello" --output ~/Desktop/greeting.wav

# Output to directory (auto-generates filename)
speak "Hello" --output ~/Desktop/

# Preview mode: generate first sentence only
speak article.md --preview --play
```

## Streaming Mode

For long text, streaming plays audio as it generates:

```bash
speak article.md --stream
```

Features:
- Buffers 3 seconds before starting playback
- Maintains minimum 1-second buffer
- Auto-rebuffers if generation falls behind
- Press Ctrl+C to stop cleanly

Best for content longer than a few sentences.

## Daemon Mode

Keep the TTS server running between calls for faster subsequent generations:

```bash
# Keep server running after generation
speak "Hello" --daemon --play
speak "Another phrase" --daemon --play  # Much faster!

# Check server status
speak health

# Stop the daemon when done
speak daemon kill
```

The server also auto-shuts down after 1 hour of idle.

## Emotion Tags

Add expressive sounds inline with text:

```bash
speak "[sigh] I can't believe it's Monday again." --play
speak "[laugh] That's hilarious!" --play
speak "[clear throat] Welcome to the presentation." --play
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

**Note:** `[pause]` and `[whisper]` are NOT reliably supported. Use punctuation (periods, ellipses) for pauses.

## Performance

Benchmarked on MacBook Pro M1 Max:

| Mode | RTF | Speed | Best For |
|------|-----|-------|----------|
| Non-streaming | 0.3-0.5x | 2-3x real-time | Short text |
| Streaming | 0.5-0.8x | 1.2-2x real-time | Long text |

RTF = Real-Time Factor (lower is faster)

- **Cold start**: ~4-8s to first audio (model loading)
- **Warm start**: ~2-4s to first audio (model cached)
