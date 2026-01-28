<div align="center">

```
███████╗██████╗ ███████╗ █████╗ ██╗  ██╗
██╔════╝██╔══██╗██╔════╝██╔══██╗██║ ██╔╝
███████╗██████╔╝█████╗  ███████║█████╔╝ 
╚════██║██╔═══╝ ██╔══╝  ██╔══██║██╔═██╗ 
███████║██║     ███████╗██║  ██║██║  ██╗
╚══════╝╚═╝     ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝
```

</div>

<h3 align="center">Talk to your Claude.</h3>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
  <img src="https://img.shields.io/badge/voice%20cloning-✓-brightgreen.svg" alt="Voice Cloning">
  <img src="https://img.shields.io/badge/platform-Apple%20Silicon-orange.svg" alt="Platform">
</p>

<p align="center">
  <strong>Voice cloning. Long documents. Audiobook quality. Local & private.</strong>
</p>

<p align="center">
  <code>speak article.md --stream</code> → Audio starts in seconds
</p>

---

## Install

**For AI Agents** (Claude Code, Cursor, Windsurf):
```bash
npx skills add EmZod/speak
```

**CLI:**
```bash
git clone https://github.com/EmZod/speak.git
cd speak && bun install
alias speak="bun run $(pwd)/src/index.ts"
```

**Requirements:** macOS Apple Silicon · Bun · Python 3.10+ · sox (`brew install sox`)

---

## Usage

```bash
speak "Hello, world!" --play        # Generate and play
speak article.md --stream           # Stream long content  
speak document.md --output out.wav  # Save to file
speak --clipboard --play            # Read from clipboard
```

---

## Voice Cloning

Clone any voice from a 10-30 second sample:

```bash
# Use your cloned voice
speak "Hello" --voice ~/.chatter/voices/morgan_freeman.wav --play
```

---

## Long Documents

```bash
speak book.md --auto-chunk --output book.wav    # Auto-chunk for reliability
speak --resume manifest.json                     # Resume interrupted generation
speak *.md --output-dir ~/Audio/                 # Batch processing
speak --estimate document.md                     # Estimate duration first
```

---

## Commands

```
speak <text|file>      Generate speech
speak health           Check system status
speak models           List available models
speak concat <files>   Combine audio files
speak daemon kill      Stop TTS server
```

---

## Options

```
--play          Play after generation
--stream        Stream as it generates
--output        Output file or directory
--voice         Custom voice file (WAV)
--auto-chunk    Chunk long documents
--estimate      Show duration estimate
--dry-run       Preview without generating
```

---

## Performance

```
Long documents     ████████████████████  Streaming, auto-chunk
Voice cloning      ████████████████████  Any voice from sample
Emotion tags       ████████████████████  [laugh], [sigh], etc.
Quality            ████████████████████  Audiobook grade
```

---

## See Also

Need instant audio (~90ms)? Try [**speakturbo**](https://github.com/EmZod/Speak-Turbo).

---

## Documentation

| File | Content |
|------|---------|
| [SKILL.md](SKILL.md) | Full usage guide for agents |
| [docs/usage.md](docs/usage.md) | Complete CLI reference |
| [docs/troubleshooting.md](docs/troubleshooting.md) | Common issues & fixes |
| [AGENTS.md](AGENTS.md) | Architecture & development |

---

<p align="center">
  <sub>MIT License · Built on <a href="https://github.com/resemble-ai/chatterbox">Chatterbox TTS</a></sub>
</p>
