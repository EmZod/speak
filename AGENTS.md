# For AI Agents: Using speak as a Skill

If you're building AI agents (like Claude Code agents) that need to generate speech, you can maximize `speak`'s capabilities by loading it as a skill.

## Quick Setup

1. **Copy the skill to your agent's skills directory:**
   ```bash
   cp -r .claude/skills/speak-tts ~/.claude/skills/
   ```

2. **The skill provides:**
   - Complete reference documentation for all features
   - Agent-optimized defaults (fp16 model, temp 0.5)
   - Content-type guidance (academic vs creative vs technical)
   - Decision trees for parameter selection
   - Common workflow patterns

## Agent Defaults (Recommended)

The skill documentation includes agent-specific defaults designed for quality and reliability:

**Model Selection:**
- **Default**: `mlx-community/chatterbox-turbo-fp16` (best quality)
- **Fast**: `mlx-community/chatterbox-turbo-8bit` (only when user requests speed)
- **Low memory**: `mlx-community/chatterbox-turbo-4bit` (only when requested)

**Parameters:**
- **Temperature**: `0.5` (balanced expressiveness)
- **Speed**: `1.0` (natural playback)
- **Streaming**: Auto-enable for content > 500 words

## Why Use the Skill?

**Without skill:** Agent must parse README, infer best practices, make uncertain parameter choices.

**With skill:** Agent gets:
- Clear decision rules: "Academic content → temp 0.5-0.6"
- Pre-configured defaults optimized for agent use
- Workflow patterns for common tasks
- Troubleshooting guidance

**Example:**
```bash
# Agent reads skill, sees content type mapping:
# "Academic papers, research" → temp 0.5-0.6
# Confidently chooses: --temp 0.5

speak research.md --voice alan_watts.wav --temp 0.5 --stream --play
```

## Skill Location

The complete skill documentation is in `.claude/skills/speak-tts/SKILL.md` and includes:
- Installation & setup guide
- Agent defaults and decision guidelines
- 10 usage patterns with examples
- Content-type → temperature mapping
- Model selection matrix
- Performance benchmarks
- Integration examples

This enables agents to use `speak` effectively without guesswork.
