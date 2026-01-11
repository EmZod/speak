# Focus Group Test Runs

Raw output from each Agent Focus Group test run during the SKILL.md optimization process.

## Run Index

| File | Round | Skill Version | Task | Models |
|------|-------|---------------|------|--------|
| `round1a-v0-pdf-audiobook.md` | 1 | v0 (original) | Convert 50-page PDF to audiobook | haiku, sonnet, opus, qwen |
| `round1b-v0-podcast.md` | 1 | v0 (original) | Create 3-voice podcast debate | haiku, sonnet, qwen |
| `round2a-v1-pdf-audiobook.md` | 2 | v1 | Convert 50-page PDF to audiobook | haiku, sonnet |
| `round2b-v1-podcast.md` | 2 | v1 | Create 3-voice podcast debate | haiku, sonnet |
| `round3-v2-news-article.md` | 3 | v2 | Read news article and save | haiku, sonnet, opus |
| `round4-v3-voice-clone.md` | 4 | v3 | Clone voice and read presentation | haiku, sonnet, opus |
| `round5a-v4-voice-clone.md` | 5 | v4 | Clone voice and read presentation | haiku, sonnet, opus |
| `round5b-v4-pdf-audiobook.md` | 5 | v4 | Convert 100-page PDF to audiobook | haiku, sonnet |
| `round5c-v5-combined.md` | 5 | v5 (final) | Clone voice + PDF audiobook | sonnet, opus |

## Models Used

- `anthropic/claude-haiku-4.5` — Fast, cost-effective
- `anthropic/claude-sonnet-4.5` — Balanced quality/cost
- `anthropic/claude-opus-4.5` — Highest quality
- `qwen/qwen3-coder:free` — Free tier (used in early rounds)

## How to Read These Files

Each file contains:
1. **Run metadata** — Date, skill file, task, status
2. **Per-model responses** including:
   - Understanding — What the model understood
   - Approach — How it would complete the task
   - Confusions — What was unclear in the docs
   - Potential Failures — What could go wrong
   - Suggested Improvements — Specific recommendations

## Key Insights by Round

### Round 1 (v0 → v1)
- PDF support completely missing
- Voice path confusion (relative vs absolute)
- --out vs --output inconsistency
- Prerequisites buried at bottom

### Round 2 (v1 → v2)
- Batch + auto-chunk interaction unclear
- Voice availability/default not explained
- Emotion tag behavior ambiguous

### Round 3 (v2 → v3)  
- Clipboard/URL input not documented
- Default output behavior unclear
- Output mode decision tree needed

### Round 4 (v3 → v4)
- Voice cloning workflow incomplete
- Audio format conversion missing
- Sox command unexplained

### Round 5 (v4 → v5)
- Minor polish items only
- Directory creation order clarified
- Complete workflows validated
