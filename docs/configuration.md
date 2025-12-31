# Configuration

## Config File

Configuration file location: `~/.chatter/config.toml`

```bash
# Create default config
speak config --init

# Show current configuration
speak config
```

### Example Configuration

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

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `output_dir` | Default output directory | `~/Audio/speak` |
| `model` | TTS model to use | `chatterbox-turbo-8bit` |
| `temperature` | Voice variation (0-1) | `0.5` |
| `speed` | Playback speed (0-2) | `1.0` |
| `markdown_mode` | Markdown handling: `plain` or `smart` | `plain` |
| `code_blocks` | Code handling: `read`, `skip`, `placeholder` | `read` |
| `daemon` | Keep server running by default | `false` |
| `log_level` | Logging: `debug`, `info`, `warn`, `error` | `info` |

## Environment Variables

Environment variables override config file settings. Use the `SPEAK_` prefix:

```bash
# Override model for one command
SPEAK_MODEL="mlx-community/chatterbox-turbo-fp16" speak "Hello"

# Override output directory
SPEAK_OUTPUT_DIR="~/Desktop" speak "Hello"

# Override temperature
SPEAK_TEMPERATURE="0.7" speak "Hello"
```

## Shell Completions

Enable tab completion for your shell:

```bash
# Bash
eval "$(speak completions bash)"

# Zsh  
eval "$(speak completions zsh)"

# Fish
speak completions fish > ~/.config/fish/completions/speak.fish
```

To make completions permanent, add the eval line to your shell's rc file (`~/.bashrc` or `~/.zshrc`).

## Files & Directories

```
~/.chatter/
├── config.toml      # Configuration file
├── env/             # Python virtual environment
├── logs/            # Log files (speak_YYYY-MM-DD.log)
├── voices/          # User voice presets
├── speak.sock       # Unix socket for daemon IPC
└── speak.pid        # Daemon process ID

~/Audio/speak/       # Default output directory
└── speak_2024-12-26_143052.wav
```

## Making speak Available Globally

After installation, choose one of these options:

### Option 1: Shell Alias (Recommended)

Add to your `~/.zshrc` (or `~/.bashrc`):

```bash
alias speak="bun run /path/to/speak/src/index.ts"
```

Then reload: `source ~/.zshrc`

### Option 2: Symlink Wrapper

```bash
echo '#!/bin/bash
bun run /path/to/speak/src/index.ts "$@"' | sudo tee /usr/local/bin/speak
sudo chmod +x /usr/local/bin/speak
```

### Option 3: Add to PATH

Add to `~/.zshrc`:

```bash
export PATH="/path/to/speak:$PATH"
```

> Replace `/path/to/speak` with your actual installation directory.
