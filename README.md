<p align="center">
  <img src="assets/banner.jpeg" alt="speak - High performance CLI tool your agent can use to generate life like speech, real time on Apple Silicon" width="100%">
</p>

A fast CLI tool for AI agents to convert their text output to speech using Chatterbox TTS on Apple Silicon.

## Quick Start

```bash
git clone https://github.com/EmZod/speak.git
cd speak
bun install

# First run auto-installs Python dependencies
bun run src/index.ts "Hello, world!" --play
```

Create an alias for easier access:
```bash
alias speak="bun run $(pwd)/src/index.ts"
```

## Requirements

- macOS with Apple Silicon (M1 Series)
- [Bun](https://bun.sh)
- Python 3.10+
- sox (for long documents): `brew install sox`

## Basic Usage

```bash
speak "Hello, world!" --play        # Generate and play
speak article.md --stream           # Stream long content
speak --clipboard --play            # Read from clipboard
speak document.md --output out.wav  # Save to file
```

## Key Features

```bash
# Long documents - auto-chunk for reliability
speak book.md --auto-chunk --output book.wav

# Resume interrupted generation
speak --resume manifest.json

# Batch processing
speak *.md --output-dir ~/Audio/

# Estimate duration before generating
speak --estimate document.md

# Concatenate audio files
speak concat part1.wav part2.wav --out combined.wav
```

## Commands

| Command | Description |
|---------|-------------|
| `speak <text\|file>` | Generate speech |
| `speak health` | Check system status |
| `speak models` | List available models |
| `speak concat <files>` | Combine audio files |
| `speak daemon kill` | Stop TTS server |

## Common Options

| Option | Description |
|--------|-------------|
| `--play` | Play after generation |
| `--stream` | Stream as it generates |
| `--output <path>` | Output file or directory |
| `--auto-chunk` | Chunk long documents |
| `--estimate` | Show duration estimate |
| `--dry-run` | Preview without generating |

## Documentation

- **[docs/usage.md](docs/usage.md)** - Complete usage guide
- **[docs/configuration.md](docs/configuration.md)** - Config file, environment variables, shell setup
- **[docs/troubleshooting.md](docs/troubleshooting.md)** - Common issues and fixes
- **[SKILL.md](SKILL.md)** - Agent-optimized reference
- **[CHANGELOG.md](CHANGELOG.md)** - Version history

## Development

```bash
bun install          # Install dependencies
bun test             # Run tests
bun run typecheck    # Type check
```

## For AI Agents

Copy [SKILL.md](SKILL.md) to your agent's skills directory:
```bash
cp SKILL.md ~/.claude/skills/speak-tts/SKILL.md
```

See [AGENTS.md](AGENTS.md) for setup details.

## License

MIT
