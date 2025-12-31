# For AI Agents: Using speak as a Skill

If you're building AI agents (like Claude Code) that need to generate speech, the [SKILL.md](SKILL.md) file provides agent-optimized documentation.

## Quick Setup

Copy the skill file to your agent's skills directory:

```bash
# For Claude Code
mkdir -p ~/.claude/skills/speak-tts
cp SKILL.md ~/.claude/skills/speak-tts/SKILL.md

# For Pi
mkdir -p ~/.pi/skills/speak-tts
cp SKILL.md ~/.pi/skills/speak-tts/SKILL.md
```

## What the Skill Provides

The [SKILL.md](SKILL.md) includes:
- Quick start commands
- Common workflow patterns (streaming, batch, long documents)
- All CLI options in a reference table
- Performance expectations
- Long document handling (auto-chunk, resume)
- Emotion tags reference

## Key Features for Agents (v1.1)

**Long Document Reliability:**
```bash
# Auto-chunk prevents timeouts on long content
speak book-chapter.md --auto-chunk --output chapter.wav

# Resume if interrupted
speak --resume manifest.json

# Estimate duration before committing
speak --estimate document.md
```

**Batch Processing:**
```bash
# Process multiple files
speak *.md --output-dir ~/Audio/ --skip-existing
```

**Concatenation:**
```bash
# Combine audio files
speak concat part1.wav part2.wav --out combined.wav
```

## Recommended Defaults

| Parameter | Default | Notes |
|-----------|---------|-------|
| Model | `chatterbox-turbo-8bit` | Good balance of speed/quality |
| Temperature | `0.5` | Balanced expressiveness |
| Speed | `1.0` | Natural playback |
| Timeout | `300` | 5 minutes, use `--auto-chunk` for longer |

## When to Use Each Mode

| Content | Recommendation |
|---------|----------------|
| Short text (<500 chars) | `speak "text" --play` |
| Medium text | `speak file.md --stream` |
| Long documents (>10 min audio) | `speak file.md --auto-chunk --output out.wav` |
| Multiple files | `speak *.md --output-dir dir/` |

See [SKILL.md](SKILL.md) for complete documentation.
