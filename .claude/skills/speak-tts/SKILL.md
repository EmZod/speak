---
name: speak-tts
description: Local text-to-speech generation using Chatterbox TTS on Apple Silicon. Use this when users request converting text to audio, reading articles/documents aloud, generating speech from clipboard content, voice cloning, or creating audiobook-style narration. Runs entirely on-device via MLX for private TTS. DEFAULTS - Use fp16 model (best quality), temp 0.5, speed 1.0. Only use 8bit model if user explicitly requests speed. Only adjust temp/speed if user asks.
---

# Speak TTS Skill

Generate high-quality text-to-speech audio locally on Apple Silicon using Chatterbox TTS via MLX.

## Overview

The `speak` CLI provides:
- **Local on-device TTS** - No cloud APIs, complete privacy
- **Multiple quantization models** - Balance quality vs speed
- **Streaming playback** - Audio plays while generating
- **Voice cloning** - Clone any voice from a .wav sample
- **Emotion tags** - Inline expressive speech control
- **Markdown processing** - Smart handling of formatted text
- **Daemon mode** - Keep model loaded for rapid subsequent calls

---

## Agent Defaults (IMPORTANT)

When using this skill, follow these defaults unless the user explicitly requests otherwise:

> **For AI Agents:** The `speak` command should be available as a global terminal command. Simply invoke it via Bash like `speak "Hello" --play`. If the command is not found, the user needs to set up the global command per the "Making `speak` Available Globally" section above.

### Model Selection
| Scenario | Model | Rationale |
|----------|-------|-----------|
| **Default** | `mlx-community/chatterbox-turbo-fp16` | Best quality output |
| User says "fast", "quick", "speed" | `mlx-community/chatterbox-turbo-8bit` | Optimized for speed |
| User says "low memory" | `mlx-community/chatterbox-turbo-4bit` | Smallest footprint |

### Parameter Defaults
| Parameter | Default Value | When to Change |
|-----------|---------------|----------------|
| **Temperature** | `0.5` | Only if user requests more/less expressiveness |
| **Speed** | `1.0` (no change) | Only if user explicitly requests faster/slower playback |

### Decision Guidelines

1. **Always use fp16 (best quality) by default** - Quality matters for TTS
2. **Only switch to 8bit if user explicitly prioritizes speed** - e.g., "make it fast", "quick generation", "I don't need perfect quality"
3. **Keep temperature at 0.5** - Balanced expressiveness; don't adjust unless asked
4. **Keep speed at 1.0** - Natural playback; only change if user says "read faster/slower"
5. **Use streaming for long content** - Automatically enable `--stream` for content > 500 words
6. **Use daemon mode for batch operations** - Enable `--daemon` when processing multiple items

### Example Agent Behavior

```bash
# User: "Read this article"
speak article.md --model mlx-community/chatterbox-turbo-fp16 --temp 0.5 --play

# User: "Read this quickly, I don't have time"
speak article.md --model mlx-community/chatterbox-turbo-8bit --temp 0.5 --play

# User: "Read this slowly and clearly"
speak article.md --model mlx-community/chatterbox-turbo-fp16 --temp 0.5 --speed 0.85 --play

# User: "Make it more expressive"
speak article.md --model mlx-community/chatterbox-turbo-fp16 --temp 0.7 --play
```

---

## Quick Reference

### Installation & Setup

```bash
# Prerequisites
# - macOS with Apple Silicon (M1/M2/M3/M4)
# - Bun runtime (https://bun.sh)
# - Python 3.10+

# Clone and install
git clone https://github.com/YOUR_USERNAME/speak.git
cd speak
bun install

# One-time Python environment setup
bun run src/index.ts setup

# Verify installation
bun run src/index.ts setup --health
```

### Making `speak` Available Globally

After installation, the `speak` command won't be available globally by default. Choose one of these options:

**Option 1: Shell Alias (Recommended)**

Add to your `~/.zshrc` (or `~/.bashrc` for Bash):

```bash
# Speak TTS CLI
alias speak="bun run /path/to/speak/src/index.ts"
```

Then reload your shell:
```bash
source ~/.zshrc
```

**Option 2: Symlink to /usr/local/bin**

```bash
# Create a wrapper script
echo '#!/bin/bash
bun run /path/to/speak/src/index.ts "$@"' | sudo tee /usr/local/bin/speak
sudo chmod +x /usr/local/bin/speak
```

**Option 3: Add to PATH**

Add the speak directory to your PATH in `~/.zshrc`:

```bash
export PATH="/path/to/speak:$PATH"
```

> **Note:** Replace `/path/to/speak` with your actual installation directory (e.g., `~/Documents/speak`).

### Core Commands

| Command | Description |
|---------|-------------|
| `speak <text\|file>` | Generate speech from text or file |
| `speak setup` | Set up Python environment |
| `speak setup --health` | Check environment health |
| `speak models` | List available TTS models |
| `speak config` | Show current configuration |
| `speak config --init` | Create default config file |
| `speak daemon kill` | Stop running TTS server |
| `speak completions <shell>` | Generate shell completions |

### Essential Options

| Option | Short | Description |
|--------|-------|-------------|
| `--play` | | Play audio immediately after generation |
| `--stream` | | Stream audio as it generates (for long text) |
| `--clipboard` | `-c` | Read input from system clipboard |
| `--output <dir>` | `-o` | Output directory (default: ~/Audio/speak) |
| `--model <name>` | `-m` | TTS model to use |
| `--temp <0-1>` | `-t` | Temperature (default: 0.5) |
| `--speed <0-2>` | `-s` | Playback speed (default: 1.0) |
| `--voice <path>` | `-v` | Voice preset or .wav for cloning |
| `--daemon` | | Keep server running between calls |
| `--preview` | | Generate first sentence only |
| `--quiet` | | Suppress output except errors |
| `--verbose` | | Show detailed progress |

---

## Pattern 1: Basic Text-to-Speech

### Direct Text Input

```bash
# Simple text to speech
speak "Hello, world!" --play

# Longer text with immediate playback
speak "This is a longer sentence that demonstrates the natural flow of the Chatterbox voice synthesis." --play

# Save to specific directory
speak "Important announcement" --output ~/Desktop --play
```

### File Input

```bash
# Plain text file
speak article.txt --play

# Markdown file (auto-detected, syntax stripped)
speak document.md --play

# Any text file
speak notes.txt --output ~/Audio/notes
```

### Clipboard Input

```bash
# Read from clipboard and play
speak --clipboard --play
speak -c --play

# Read clipboard, save to file
speak -c --output ~/Desktop
```

---

## Pattern 2: Streaming Mode (Long Content)

For long text, streaming plays audio as it generates with adaptive buffering.

### How Streaming Works

1. Text is split into sentence chunks
2. Each chunk generates in parallel with playback
3. System maintains 5-second buffer before starting
4. Minimum 2-second buffer maintained during playback
5. Auto-rebuffers if generation falls behind

### Usage

```bash
# Stream a long article
speak article.md --stream

# Stream with live progress
speak book-chapter.txt --stream --verbose

# Stream from clipboard
speak -c --stream
```

### When to Use Streaming

| Content Length | Recommended Mode |
|----------------|------------------|
| < 100 words | Standard (`--play`) |
| 100-500 words | Either works |
| > 500 words | Streaming (`--stream`) |
| Very long (books) | Streaming with daemon |

---

## Pattern 3: Daemon Mode (Rapid Generation)

Keep the TTS model loaded in memory for instant subsequent generations.

### Workflow

```bash
# First call - starts daemon (slower, loads model)
speak "First phrase" --daemon --play

# Subsequent calls - instant (model already loaded)
speak "Second phrase" --daemon --play
speak "Third phrase" --daemon --play

# Stop daemon when done
speak daemon kill
```

### Performance Comparison

| Mode | First Call | Subsequent Calls |
|------|------------|------------------|
| Standard | ~3-5s | ~3-5s |
| Daemon | ~3-5s | ~0.3-0.5s |

### Daemon + Streaming

For maximum performance on long content:

```bash
speak long-article.md --stream --daemon
```

---

## Pattern 4: Emotion Tags

Chatterbox supports inline emotion tags for expressive speech.

### Available Tags

| Tag | Effect |
|-----|--------|
| `[laugh]` | Laughing sound |
| `[chuckle]` | Light chuckle |
| `[sigh]` | Sighing sound |
| `[gasp]` | Gasping sound |
| `[groan]` | Groaning sound |
| `[clear throat]` | Throat clearing |
| `[cough]` | Coughing sound |
| `[sniff]` | Sniffing sound |
| `[shush]` | Shushing sound |
| `[crying]` | Crying/emotional |
| `[singing]` | Sung speech |

> **Note:** `[pause]` and `[whisper]` are NOT supported emotion tags and will be spoken literally. Use punctuation (periods, ellipses, commas) to create natural pauses instead.

### Usage Examples

```bash
# Sigh at the beginning
speak "[sigh] I can't believe it's Monday again." --play

# Laugh mid-sentence
speak "That's hilarious! [laugh] I can't stop laughing." --play

# Multiple emotions
speak "[clear throat] Welcome everyone... Today's topic is exciting!" --play

# Dramatic reading
speak "[gasp] The door opened slowly... And there it was." --play
```

### In Files

Emotion tags work in text files too:

```text
# story.txt
[clear throat] Once upon a time, in a land far away...

The hero faced his greatest challenge. [sigh] "I don't know if I can do this," he muttered.

[gasp] Suddenly, a light appeared! [laugh] "Of course! The answer was here all along!"
```

```bash
speak story.txt --play
```

---

## Pattern 5: Markdown Processing

### Modes

| Mode | Description |
|------|-------------|
| `plain` (default) | Strips all markdown syntax |
| `smart` | Adds `[clear throat]` before headers for emphasis |

### Plain Mode

```bash
speak document.md --markdown plain --play
```

Transformations:
- `# Header` → `Header`
- `**bold**` → `bold`
- `*italic*` → `italic`
- `[link](url)` → `link`
- Code blocks → handled by `--code-blocks`
- Lists → cleaned up (bullets removed)

### Smart Mode

```bash
speak document.md --markdown smart --play
```

Adds natural pauses/emphasis:
- `# Header` → `[clear throat] Header`
- Other markdown stripped as in plain mode

### Code Block Handling

| Mode | Description |
|------|-------------|
| `read` (default) | Read code verbatim |
| `skip` | Omit code blocks entirely |
| `placeholder` | Replace with "[code block omitted]" |

```bash
# Read code aloud (technical tutorial)
speak tutorial.md --code-blocks read --play

# Skip code (narrative focus)
speak article.md --code-blocks skip --play

# Acknowledge but skip details
speak documentation.md --code-blocks placeholder --play
```

---

## Pattern 6: Voice Cloning

Clone any voice from a reference audio sample.

### Requirements

- Reference audio: WAV format, 5-30 seconds recommended
- Clear speech, minimal background noise
- Representative of desired voice characteristics

### Usage

```bash
# Clone from reference audio
speak "Hello, this is my cloned voice." --voice ~/voices/sample.wav --play

# Use with streaming
speak article.md --voice ~/voices/narrator.wav --stream

# Combine with other options
speak "Important message" --voice ~/voices/custom.wav --speed 1.1 --play
```

### Voice Preset Directory

Store custom voices in `~/.chatter/voices/`:

```bash
# Create directory
mkdir -p ~/.chatter/voices

# Copy reference audio
cp my-voice-sample.wav ~/.chatter/voices/narrator.wav

# Use by name
speak "Hello" --voice ~/.chatter/voices/narrator.wav --play
```

---

## Pattern 7: Model Selection

### Available Models

| Model | Bits | Speed | Quality | Memory |
|-------|------|-------|---------|--------|
| `chatterbox-turbo-8bit` | 8 | Fastest | Good | Low |
| `chatterbox-turbo-fp16` | 16 | Slowest | Best | High |
| `chatterbox-turbo-4bit` | 4 | Fast | Lower | Lowest |
| `chatterbox-turbo-5bit` | 5 | Fast | Medium | Low |
| `chatterbox-turbo-6bit` | 6 | Medium | Good | Medium |

### Model Selection

```bash
# List all available models
speak models

# Use high-quality model
speak "Premium quality audio" --model mlx-community/chatterbox-turbo-fp16 --play

# Use fastest model (default)
speak "Quick generation" --model mlx-community/chatterbox-turbo-8bit --play

# Use smallest memory footprint
speak "Low memory" --model mlx-community/chatterbox-turbo-4bit --play
```

### When to Use Which

| Use Case | Recommended Model |
|----------|-------------------|
| General use | 8bit (default) |
| Final production audio | fp16 |
| Limited memory | 4bit |
| Batch processing | 8bit |
| Testing/development | 4bit or 8bit |

---

## Pattern 8: Generation Parameters

### Temperature

Controls randomness/creativity in speech patterns.

```bash
# More consistent (lower temp)
speak "Formal announcement" --temp 0.3 --play

# Default balance
speak "Normal speech" --temp 0.5 --play

# More varied/expressive (higher temp)
speak "Creative storytelling" --temp 0.8 --play
```

| Temperature | Effect |
|-------------|--------|
| 0.0-0.3 | Very consistent, robotic |
| 0.4-0.6 | Balanced (recommended) |
| 0.7-1.0 | More varied, expressive |

### Speed

Adjusts playback speed without changing pitch.

```bash
# Slower for clarity
speak "Complex technical content" --speed 0.8 --play

# Normal speed
speak "Regular content" --speed 1.0 --play

# Faster playback
speak "Quick summary" --speed 1.3 --play
```

| Speed | Effect |
|-------|--------|
| 0.5-0.8 | Slower, clearer |
| 0.9-1.1 | Normal |
| 1.2-2.0 | Faster |

---

## Pattern 9: Preview Mode

Generate only the first sentence for quick testing.

```bash
# Preview voice/settings on long document
speak long-article.md --preview --play

# Test different models quickly
speak document.md --preview --model mlx-community/chatterbox-turbo-fp16 --play
speak document.md --preview --model mlx-community/chatterbox-turbo-8bit --play

# Preview with different temperatures
speak story.md --preview --temp 0.3 --play
speak story.md --preview --temp 0.7 --play
```

---

## Pattern 10: Batch Processing

### Multiple Files

```bash
# Process multiple files
for file in articles/*.md; do
  speak "$file" --output ~/Audio/articles --daemon
done

# Stop daemon after batch
speak daemon kill
```

### With Progress Tracking

```bash
# Count files
files=(articles/*.md)
total=${#files[@]}
count=0

for file in "${files[@]}"; do
  ((count++))
  echo "Processing $count/$total: $file"
  speak "$file" --output ~/Audio/articles --daemon --quiet
done

speak daemon kill
echo "Done! Processed $total files"
```

---

## Configuration

### Config File Location

`~/.chatter/config.toml`

### Create Default Config

```bash
speak config --init
```

### Example Configuration

```toml
# Output settings
output_dir = "~/Audio/speak"

# Model settings
model = "mlx-community/chatterbox-turbo-8bit"
temperature = 0.5
speed = 1.0

# Markdown processing
markdown_mode = "plain"
code_blocks = "read"

# Behavior
daemon = false
log_level = "info"
```

### Environment Variable Overrides

All config options can be overridden with `SPEAK_` prefix:

```bash
# Override model
SPEAK_MODEL="mlx-community/chatterbox-turbo-fp16" speak "Hello" --play

# Override output directory
SPEAK_OUTPUT_DIR="~/Desktop" speak "Hello" --play

# Override temperature
SPEAK_TEMPERATURE="0.7" speak "Hello" --play
```

---

## Shell Completions

### Bash

```bash
# Add to ~/.bashrc
eval "$(speak completions bash)"

# Or save to file
speak completions bash > ~/.bash_completion.d/speak
```

### Zsh

```bash
# Add to ~/.zshrc
eval "$(speak completions zsh)"

# Or save to file
speak completions zsh > ~/.zsh/completions/_speak
```

### Fish

```bash
# Save to completions directory
speak completions fish > ~/.config/fish/completions/speak.fish
```

---

## File & Directory Structure

```
~/.chatter/
├── config.toml          # Configuration file
├── env/                  # Python virtual environment
│   ├── bin/python        # Python interpreter
│   └── lib/              # Installed packages (mlx-audio, etc.)
├── logs/                 # Log files (by date)
│   └── speak_2024-12-26.log
├── voices/               # Custom voice presets
│   └── narrator.wav
└── speak.sock            # Unix socket for IPC (daemon mode)

~/Audio/speak/            # Default output directory
└── speak_2024-12-26_143052.wav
```

---

## Performance Benchmarks

### MacBook Pro M1 Max (64GB)

| Mode | RTF | Speed | Best For |
|------|-----|-------|----------|
| Non-streaming | 0.3-0.5x | 2-3x real-time | Short text |
| Streaming | 0.5-0.8x | 1.2-2x real-time | Long text |
| Daemon (warm) | 0.2-0.3x | 3-5x real-time | Rapid calls |

RTF = Real-Time Factor (lower is faster)

### Model Performance

| Model | Load Time | Generation Speed | Memory |
|-------|-----------|------------------|--------|
| 4bit | ~2s | Fastest | ~2GB |
| 8bit | ~3s | Fast | ~4GB |
| fp16 | ~5s | Slower | ~8GB |

---

## Common Workflows

### Read Article Aloud

```bash
# Quick listen
speak article.md --play

# Save for later
speak article.md --output ~/Audio/articles
```

### Convert Document Library

```bash
# Setup
mkdir -p ~/Audio/documents
speak daemon kill  # Clean start

# Convert all markdown files
for f in ~/Documents/*.md; do
  name=$(basename "$f" .md)
  speak "$f" --output ~/Audio/documents --daemon --quiet
  echo "Converted: $name"
done

speak daemon kill
```

### Voice Note from Clipboard

```bash
# Quick voice note
speak -c --play

# Save voice note
speak -c --output ~/Audio/notes
```

### Preview Before Full Generation

```bash
# Test settings
speak long-document.md --preview --play

# Adjust and test again
speak long-document.md --preview --temp 0.6 --speed 1.1 --play

# Full generation when satisfied
speak long-document.md --stream --temp 0.6 --speed 1.1
```

### Audiobook Production

```bash
# For each chapter
for chapter in book/chapter-*.md; do
  speak "$chapter" \
    --model mlx-community/chatterbox-turbo-fp16 \
    --markdown smart \
    --code-blocks skip \
    --daemon \
    --output ~/Audio/audiobook
done

speak daemon kill
```

---

## Troubleshooting

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| "Python environment not set up" | Missing venv | Run `speak setup` |
| "Server not running" | Stale socket | Run `speak daemon kill` then retry |
| No audio plays | Missing `--play` | Add `--play` flag |
| Slow first generation | Model loading | Use `--daemon` for subsequent calls |
| Audio still playing after Ctrl+C | Background afplay | Run `pkill afplay` |

### Debug Commands

```bash
# Check environment health
speak setup --health

# View current config
speak config

# Check logs
cat ~/.chatter/logs/speak_$(date +%Y-%m-%d).log

# Kill stuck daemon
speak daemon kill

# Clean up stale socket manually
rm ~/.chatter/speak.sock

# Verify Python environment
~/.chatter/env/bin/python --version
```

### Performance Tips

1. **Use daemon mode** for multiple generations
2. **Use streaming** for long content (> 500 words)
3. **Use 8bit model** for best speed/quality balance
4. **Preview first** before full generation on long documents
5. **Batch with --quiet** to reduce output overhead

---

## Integration Examples

### Script: Daily News Reader

```bash
#!/bin/bash
# Read daily news from clipboard

pbpaste | speak - --stream --markdown smart
```

### Script: Document Converter

```bash
#!/bin/bash
# Convert all .md files in current directory

for f in *.md; do
  speak "$f" --daemon --quiet --output ./audio
done
speak daemon kill
echo "Done converting ${#} files"
```

### Alfred/Raycast Integration

```bash
# Read selected text
speak "{query}" --play
```

### Keyboard Shortcut (Automator)

```bash
#!/bin/bash
# Read clipboard with speak
# Note: Update the path below to your speak installation directory

export PATH="/opt/homebrew/bin:$PATH"
speak --clipboard --play

# Or if speak isn't globally available:
# cd /path/to/speak
# bun run src/index.ts --clipboard --play
```

---

## API Reference

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Invalid arguments |
| 3 | Python environment not set up |
| 4 | Server communication error |

### Output Files

Generated files follow the pattern:
```
speak_YYYY-MM-DD_HHMMSS.wav
```

Example: `speak_2024-12-26_143052.wav`

### Socket Path

Unix socket for IPC: `~/.chatter/speak.sock`

---

## Summary Cheat Sheet

```bash
# DEFAULTS: fp16 model, temp 0.5, speed 1.0
# Only change these if user explicitly requests

# Basic usage (uses fp16 quality by default)
speak "Hello world" --play                    # Text to speech
speak article.md --play                       # File to speech
speak -c --play                               # Clipboard to speech

# Long content (auto-use for >500 words)
speak article.md --stream                     # Stream as it generates

# Fast repeated use
speak "First" --daemon --play                 # Start daemon
speak "Second" --daemon --play                # Instant (model loaded)
speak daemon kill                             # Stop daemon

# Model selection
# DEFAULT: fp16 (best quality) - use unless user says "fast"
speak "Hi" --model mlx-community/chatterbox-turbo-fp16 --play  # Default/best
speak "Hi" --model mlx-community/chatterbox-turbo-8bit --play  # Fast mode

# Expressive speech
speak "[sigh] Monday again..." --play         # Emotion tags
speak "[laugh] That's hilarious!" --play      # Laughter

# Only adjust if user requests
speak "Hello" --temp 0.7 --play               # More expressive (if asked)
speak "Hello" --speed 0.85 --play             # Slower (if asked)
speak "Hello" --voice sample.wav --play       # Voice cloning

# Markdown handling
speak doc.md --markdown smart --play          # Smart headers
speak doc.md --code-blocks skip --play        # Skip code

# Preview before full gen
speak long.md --preview --play                # First sentence only

# Administration
speak setup                                    # Install Python env
speak setup --health                          # Check health
speak models                                  # List models
speak config                                  # Show config
```
