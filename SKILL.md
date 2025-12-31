# speak - Text to Speech for Agents

Convert text to natural speech audio using Chatterbox TTS on Apple Silicon.

## Quick Start

```bash
# Stream audio (recommended - starts playing immediately)
speak "Hello, I'm your AI assistant." --stream

# Generate and play after completion
speak "Let me read that for you." --play

# Generate audio file only
speak "Hello" --output ~/Audio/greeting.wav
```

## Common Patterns

### Reading Documents to Users

```bash
# Best for long documents - starts playing within ~3s
speak document.md --stream
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
```

## Options Reference

| Option | Description | Default |
|--------|-------------|---------|
| `--stream` | Stream audio as it generates (recommended) | false |
| `--play` | Play audio after full generation | false |
| `--output <path>` | Output directory or file | ~/Audio/speak/ |
| `--voice <name>` | Voice preset or .wav file | default |

## Performance

- **Cold start**: ~4-8s to first audio (model loading + generation)
- **Warm start**: ~3-8s to first audio (model already loaded)
- **Generation speed**: ~0.3-0.7x real-time on Apple Silicon
- **Streaming**: For long text, audio starts after first chunk generates (~250 chars)

**Note:** There's always a delay before audio starts because the TTS model must generate audio before playback. For short text, this means waiting for full generation. For long text with `--stream`, playback begins after the first chunk while remaining chunks generate in parallel.

## Setup

First run automatically sets up the environment:

```bash
speak "test"  # Auto-setup on first run
```

Or manually:

```bash
speak setup
```

## Server Management

The server auto-starts when needed and stays running for faster subsequent requests. It automatically shuts down after 1 hour of no TTS usage.

```bash
# Check server status
speak health

# Stop the server manually
speak daemon kill
```

## Notes

- Requires Apple Silicon Mac (M1/M2/M3)
- Audio files are WAV format at 24kHz mono
- Use `--stream` for text longer than a few sentences
- Server stays running after requests for faster follow-ups
