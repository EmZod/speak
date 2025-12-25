# speak

A CLI tool for converting text to speech using Chatterbox TTS on Apple Silicon.

## Quick Start

```bash
# Clone and install
git clone https://github.com/EmZod/speak.git
cd speak
bun install

# Generate speech (auto-sets up Python on first run)
bun run src/index.ts "Hello, world!" --play

# Or create an alias
alias speak="bun run $(pwd)/src/index.ts"
speak "Hello, world!" --play
```

That's it! On first run, speak automatically:
1. Creates a Python virtual environment at `~/.chatter/env/`
2. Installs mlx-audio and dependencies
3. Downloads the TTS model (cached at `~/.cache/huggingface/hub/`)

## Installation

### Prerequisites
- macOS with Apple Silicon (M1/M2/M3)
- [Bun](https://bun.sh) runtime
- Python 3.10+

### Manual Setup (optional)

If you prefer to set up manually or need to troubleshoot:

```bash
bun run src/index.ts setup          # Set up Python environment
bun run src/index.ts setup --health # Check environment health
```

### Making `speak` Available Globally

After installation, `speak` won't be available as a global command by default. Choose one of these options:

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

**Option 2: Symlink Wrapper**

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

## Usage

### Basic Usage

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

### Markdown Processing

```bash
# Strip markdown syntax (default)
speak document.md --markdown plain

# Smart mode: adds [clear throat] before headers for emphasis
speak document.md --markdown smart

# Code block handling
speak document.md --code-blocks read        # Read code verbatim (default)
speak document.md --code-blocks skip        # Skip code blocks
speak document.md --code-blocks placeholder # Replace with "[code block omitted]"
```

### Voice & Model Options

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

### Output Options

```bash
# Custom output directory
speak "Hello" --output ~/Desktop

# Preview mode: generate first sentence only
speak article.md --preview --play
```

### Daemon Mode

The TTS server can stay running between calls for faster subsequent generations:

```bash
# Keep server running after generation
speak "Hello" --daemon --play
speak "Another phrase" --daemon --play  # Much faster!

# Stop the daemon when done
speak daemon kill
```

### Streaming Mode

For long text, streaming plays audio as it generates with adaptive buffering:

```bash
speak article.md --stream
```

Features:
- Buffers 5 seconds before starting playback
- Maintains minimum 2-second buffer
- Auto-rebuffers if generation falls behind
- Press Ctrl+C to stop cleanly

## Commands

| Command | Description |
|---------|-------------|
| `speak <text\|file>` | Generate speech |
| `speak setup` | Set up Python environment |
| `speak setup --health` | Check environment health |
| `speak models` | List available TTS models |
| `speak config` | Show current configuration |
| `speak config --init` | Create default config file |
| `speak daemon kill` | Stop running TTS server |
| `speak completions <shell>` | Generate shell completions |

## Options

| Option | Description |
|--------|-------------|
| `-c, --clipboard` | Read from system clipboard |
| `-o, --output <dir>` | Output directory (default: ~/Audio/speak) |
| `-m, --model <name>` | TTS model (default: chatterbox-turbo-8bit) |
| `-t, --temp <0-1>` | Temperature (default: 0.5) |
| `-s, --speed <0-2>` | Playback speed (default: 1.0) |
| `-v, --voice <path>` | Voice preset or .wav for cloning |
| `--markdown <mode>` | Markdown mode: plain\|smart |
| `--code-blocks <mode>` | Code handling: read\|skip\|placeholder |
| `--play` | Play audio after generation |
| `--stream` | Stream audio as it generates |
| `--preview` | Generate first sentence only |
| `--daemon` | Keep server running |
| `--verbose` | Show detailed progress |
| `--quiet` | Suppress output except errors |

## Configuration

Configuration file: `~/.chatter/config.toml`

```toml
# Create default config
speak config --init
```

Example configuration:

```toml
output_dir = "~/Audio/speak"
model = "mlx-community/chatterbox-turbo-8bit"
temperature = 0.5
speed = 1.0
markdown_mode = "plain"
code_blocks = "read"
daemon = false
log_level = "info"
```

Environment variables override config (use `SPEAK_` prefix):
```bash
SPEAK_MODEL="mlx-community/chatterbox-turbo-fp16" speak "Hello"
```

## Shell Completions

```bash
# Bash
eval "$(speak completions bash)"

# Zsh
eval "$(speak completions zsh)"

# Fish
speak completions fish > ~/.config/fish/completions/speak.fish
```

## Available Models

| Model | Description |
|-------|-------------|
| `mlx-community/chatterbox-turbo-8bit` | 8-bit quantized, fastest (recommended) |
| `mlx-community/chatterbox-turbo-fp16` | Full precision, highest quality |
| `mlx-community/chatterbox-turbo-4bit` | 4-bit quantized, smallest memory |
| `mlx-community/chatterbox-turbo-5bit` | 5-bit quantized |
| `mlx-community/chatterbox-turbo-6bit` | 6-bit quantized |

## Performance

Benchmarked on MacBook Pro M1 Max (64GB):

| Mode | RTF | Speed | Notes |
|------|-----|-------|-------|
| Non-streaming | 0.3-0.5x | 2-3x real-time | Best for short text |
| Streaming | 0.5-0.8x | 1.2-2x real-time | Best for long text |

RTF = Real-Time Factor (lower is faster)

## Emotion Tags

Chatterbox supports inline emotion tags. The speak CLI passes all tags through to Chatterbox unchanged, so you can use any tag the model supports:

```bash
speak "[sigh] I can't believe it's Monday again." --play
speak "[laugh] That's hilarious!" --play
speak "[clear throat] Welcome to the presentation." --play
speak "[whisper] This is a secret." --play
```

Common tags include: `[laugh]`, `[chuckle]`, `[sigh]`, `[gasp]`, `[groan]`, `[clear throat]`, `[cough]`, `[sniff]`, `[shush]`, `[whisper]`, `[crying]`, `[singing]`, and more.

For the full list of supported emotion tags, see the [Chatterbox documentation](https://github.com/resemble-ai/chatterbox).

## Files & Directories

```
~/.chatter/
├── config.toml      # Configuration file
├── env/             # Python virtual environment
├── logs/            # Log files
├── voices/          # User voice presets
└── speak.sock       # Unix socket for IPC

~/Audio/speak/       # Default output directory
└── speak_2024-12-26_143052.wav
```

## Troubleshooting

### "Python environment not set up"
```bash
speak setup
```

### "Server not running"
```bash
speak daemon kill  # Clean up stale socket
speak setup --health  # Verify environment
```

### Audio still playing after Ctrl+C
```bash
pkill afplay
```

### Check logs
```bash
cat ~/.chatter/logs/speak_$(date +%Y-%m-%d).log
```
