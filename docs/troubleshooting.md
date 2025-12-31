# Troubleshooting

## Common Issues

### "Python environment not set up"

Run setup:
```bash
speak setup
```

If that fails, try forcing a reinstall:
```bash
speak setup --force
```

### "Server not running" or connection errors

Clean up stale socket and restart:
```bash
speak daemon kill
speak health
```

### Audio still playing after Ctrl+C

Kill any lingering audio processes:
```bash
pkill afplay
```

### Generation hangs or times out

For long documents, use auto-chunking:
```bash
speak long-document.md --auto-chunk --output output.wav
```

If it still times out, increase the timeout:
```bash
speak document.md --timeout 600  # 10 minutes
```

### "sox not found" when using --auto-chunk or concat

Install sox:
```bash
brew install sox
```

### Poor audio quality

Try the full-precision model:
```bash
speak "Hello" --model mlx-community/chatterbox-turbo-fp16
```

Or adjust temperature (lower = more consistent, higher = more expressive):
```bash
speak "Hello" --temp 0.3  # More consistent
speak "Hello" --temp 0.7  # More expressive
```

### Out of memory errors

Use a smaller model:
```bash
speak "Hello" --model mlx-community/chatterbox-turbo-4bit
```

Or stop other memory-intensive applications.

## Health Check

Run a comprehensive health check:
```bash
speak health
```

This checks:
- Python environment
- Required packages
- Server status
- Audio device availability
- Disk space

## Logs

View today's log:
```bash
cat ~/.chatter/logs/speak_$(date +%Y-%m-%d).log
```

Enable verbose output for debugging:
```bash
speak "Hello" --verbose
```

Or set debug log level in config:
```toml
# ~/.chatter/config.toml
log_level = "debug"
```

## Resetting Everything

If all else fails, reset the environment:

```bash
# Stop daemon
speak daemon kill

# Remove environment
rm -rf ~/.chatter/env

# Reinstall
speak setup
```

This preserves your config file and voice presets.

## Getting Help

```bash
# Show all commands
speak --help

# Show help for a specific command
speak setup --help
speak concat --help
```
