#!/usr/bin/env bun
/**
 * speak - Convert text to speech using Chatterbox TTS
 *
 * Entry point for the speak CLI tool.
 */

import { Command } from "commander";
import pc from "picocolors";
import { existsSync, writeFileSync } from "fs";
import {
  loadConfig,
  CONFIG_PATH,
  CHATTER_DIR,
  ensureChatterDir,
  generateDefaultConfig,
  expandPath,
} from "./core/config.ts";
import type { Config } from "./core/types.ts";

const VERSION = "1.1.0";

// Load configuration at startup
const config: Config = loadConfig();

const program = new Command();

program
  .name("speak")
  .description("Convert text to speech using Chatterbox TTS")
  .version(VERSION)
  .argument("[input...]", "Text to convert or file paths")
  .option("-c, --clipboard", "Read from system clipboard")
  .option("-o, --output <dir>", "Output directory", config.output_dir)
  .option("-m, --model <name>", "TTS model", config.model)
  .option("-t, --temp <value>", "Temperature (0-1)", String(config.temperature))
  .option("-s, --speed <value>", "Playback speed (0-2)", String(config.speed))
  .option("-v, --voice <name>", "Voice preset or path to .wav", config.voice)
  .option("--markdown <mode>", "Markdown mode: plain|smart", config.markdown_mode)
  .option("--code-blocks <mode>", "Code handling: read|skip|placeholder", config.code_blocks)
  .option("--play", "Play audio after generation")
  .option("--stream", "Stream audio as it generates")
  .option("--preview", "Generate first sentence only")
  .option("--daemon", "Use persistent server for faster calls", config.daemon)
  .option("--verbose", "Show detailed progress")
  .option("--quiet", "Suppress all output except errors")
  .action(async (input: string[], options) => {
    const { initLogger, logger } = await import("./ui/logger.ts");
    const { startDaemon, stopDaemon } = await import("./bridge/daemon.ts");
    const { generate } = await import("./bridge/client.ts");
    const { copyToOutput, playAudio, registerCleanupHandlers, stopAudio } = await import("./core/output.ts");
    const { isVenvValid, runSetup } = await import("./python/setup.ts");
    const { processMarkdown, isMarkdown, extractFirstSentence } = await import(
      "./core/markdown.ts"
    );

    // Register cleanup handlers for Ctrl+C
    registerCleanupHandlers(async () => {
      if (!options.quiet) {
        console.log(pc.dim("\n  Interrupted, cleaning up..."));
      }
      await stopDaemon();
    });

    initLogger({
      logLevel: config.log_level,
      quiet: options.quiet,
      verbose: options.verbose,
    });

    // Auto-setup on first run
    if (!isVenvValid()) {
      if (!options.quiet) {
        console.log(pc.cyan("First run detected - setting up Python environment...\n"));
      }
      const success = await runSetup({ showProgress: !options.quiet });
      if (!success) {
        console.log(pc.red("\nSetup failed. Please run 'speak setup' manually for details."));
        process.exit(1);
      }
      if (!options.quiet) {
        console.log(pc.green("\n✓ Setup complete!\n"));
      }
    }

    // Get text input
    let text = "";
    let isMarkdownFile = false;
    if (options.clipboard) {
      // Read from clipboard
      const { execSync } = await import("child_process");
      try {
        text = execSync("pbpaste", { encoding: "utf-8" });
      } catch {
        console.log(pc.red("Failed to read clipboard"));
        process.exit(1);
      }
    } else if (input.length > 0) {
      // Check if input is a file path or text
      const fs = await import("fs");
      if (input.length === 1 && fs.existsSync(input[0])) {
        text = fs.readFileSync(input[0], "utf-8");
        isMarkdownFile = input[0].endsWith(".md");
      } else {
        text = input.join(" ");
      }
    } else {
      console.log(pc.yellow("No input provided. Use --help for usage."));
      return;
    }

    if (!text.trim()) {
      console.log(pc.yellow("Empty input. Nothing to generate."));
      return;
    }

    // Process markdown if needed
    const shouldProcessMarkdown = isMarkdownFile || isMarkdown(text);
    if (shouldProcessMarkdown) {
      const originalLength = text.length;
      text = processMarkdown(text, {
        mode: options.markdown as "plain" | "smart",
        codeBlocks: options.codeBlocks as "read" | "skip" | "placeholder",
      });
      if (options.verbose && !options.quiet) {
        console.log(
          pc.dim(`Processed markdown: ${originalLength} → ${text.length} characters`)
        );
      }
    }

    // Preview mode: extract first sentence only
    if (options.preview) {
      text = extractFirstSentence(text);
      if (!options.quiet) {
        console.log(pc.dim(`Preview mode: "${text}"`));
      }
    }

    if (!options.quiet) {
      console.log(pc.cyan("speak") + " v" + VERSION);
      console.log(pc.dim(`Generating audio for ${text.length} characters...`));
    }

    try {
      // Start daemon
      const started = await startDaemon();
      if (!started) {
        console.log(pc.red("Failed to start TTS server"));
        process.exit(1);
      }

      // Streaming mode - uses new binary protocol streaming
      if (options.stream) {
        const { StreamOrchestrator } = await import("./streaming/orchestrator.ts");

        const orchestrator = new StreamOrchestrator(24000, {
          initialBufferSeconds: 3.0,
          minBufferSeconds: 1.0,
          resumeBufferSeconds: 2.0,
        });

        // Handle Ctrl+C
        const cancelHandler = () => {
          orchestrator.cancel("User interrupted");
        };
        process.once("SIGINT", cancelHandler);

        if (!options.quiet) {
          console.log(pc.dim("Streaming audio..."));
        }

        const result = await orchestrator.stream({
          text,
          model: options.model,
          temperature: parseFloat(options.temp),
          speed: parseFloat(options.speed),
          voice: options.voice,
          onProgress: (progress) => {
            if (!options.quiet && options.verbose) {
              process.stdout.write(
                `\r${pc.dim(`State: ${progress.state} | Buffer: ${progress.bufferedSeconds.toFixed(1)}s | Chunks: ${progress.chunksReceived}`)}`
              );
            }
          },
        });

        process.off("SIGINT", cancelHandler);

        if (!options.quiet) {
          if (result.success) {
            console.log(pc.green(`\n✓ Streamed ${result.totalChunks} chunks`));
            console.log(pc.dim(`  Duration: ${result.totalDurationSeconds.toFixed(1)}s`));
            if (result.rebufferCount > 0) {
              console.log(pc.yellow(`  Rebuffered: ${result.rebufferCount} time(s)`));
            }
            if (result.underrunCount > 0) {
              console.log(pc.yellow(`  Underruns: ${result.underrunCount} samples`));
            }
          } else {
            console.log(pc.red(`\n✗ Streaming failed: ${result.error}`));
          }
        }

        // Don't need daemon cleanup for streaming - orchestrator handles socket
        process.exit(result.success ? 0 : 1);
      } else {
        // Non-streaming mode with progress spinner
        const { createSpinner } = await import("./ui/progress.ts");

        const spinner = createSpinner({
          text,
          showEta: !options.quiet && text.length > 100,
          quiet: options.quiet,
        });

        spinner.start();

        try {
          const result = await generate({
            text,
            model: options.model,
            temperature: parseFloat(options.temp),
            speed: parseFloat(options.speed),
            voice: options.voice,
          });

          spinner.stop(true);

          // Copy to output directory
          const outputPath = copyToOutput(result.audio_path, options.output);

          if (!options.quiet) {
            console.log(pc.green(`✓ Generated ${result.duration.toFixed(1)}s of audio`));
            console.log(pc.dim(`  Output: ${outputPath}`));
            console.log(pc.dim(`  RTF: ${result.rtf.toFixed(2)}x`));
          }

          // Play audio if requested
          if (options.play) {
            if (!options.quiet) {
              console.log(pc.dim("  Playing..."));
            }
            await playAudio(outputPath);
          }
        } catch (error) {
          spinner.stop(false);
          throw error;
        }
      }

      // Stop daemon if not in daemon mode
      if (!options.daemon) {
        await stopDaemon();
      }

      // Exit cleanly - don't leave event loop hanging
      process.exit(0);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(pc.red(`Error: ${message}`));
      process.exit(1);
    }
  });

// Subcommand: setup
program
  .command("setup")
  .description("Set up Python environment")
  .option("--force", "Force reinstall even if environment exists")
  .option("--quiet", "Hide installation progress")
  .option("--health", "Only run health check, don't install")
  .action(async (options) => {
    const { runSetup, checkPython } = await import("./python/setup.ts");
    const { printHealthStatus } = await import("./python/health.ts");
    const { initLogger, logger } = await import("./ui/logger.ts");

    initLogger({ logLevel: config.log_level });

    if (options.health) {
      const healthy = await printHealthStatus();
      process.exit(healthy ? 0 : 1);
    }

    console.log(pc.cyan("Setting up Python environment for speak CLI...\n"));

    const success = await runSetup({
      force: options.force,
      showProgress: !options.quiet,
    });

    if (success) {
      console.log(pc.green("\n✓ Setup complete! You can now use speak to generate audio."));
      console.log(pc.dim("  Example: speak \"Hello, world!\" --play"));
    } else {
      console.log(pc.red("\n✗ Setup failed. Check the errors above."));
      process.exit(1);
    }
  });

// Subcommand: models
program
  .command("models")
  .description("List available TTS models")
  .action(async () => {
    console.log(pc.cyan("Available Chatterbox models:\n"));
    const models = [
      { name: "mlx-community/chatterbox-turbo-8bit", desc: "8-bit quantized, fastest, recommended" },
      { name: "mlx-community/chatterbox-turbo-fp16", desc: "Full precision, highest quality" },
      { name: "mlx-community/chatterbox-turbo-4bit", desc: "4-bit quantized, smallest memory" },
      { name: "mlx-community/chatterbox-turbo-5bit", desc: "5-bit quantized" },
      { name: "mlx-community/chatterbox-turbo-6bit", desc: "6-bit quantized" },
    ];

    for (const model of models) {
      const isDefault = model.name === config.model;
      const prefix = isDefault ? pc.green("* ") : "  ";
      const suffix = isDefault ? pc.dim(" (current)") : "";
      console.log(prefix + model.name + suffix);
      console.log(pc.dim("    " + model.desc));
    }
  });

// Subcommand: daemon
const daemonCmd = program.command("daemon").description("Daemon management");

daemonCmd
  .command("kill")
  .description("Stop running daemon")
  .action(async () => {
    const { stopDaemon } = await import("./bridge/daemon.ts");
    const { initLogger } = await import("./ui/logger.ts");

    initLogger({ logLevel: config.log_level });
    await stopDaemon();
  });

// Subcommand: completions
program
  .command("completions <shell>")
  .description("Generate shell completions (bash, zsh, fish)")
  .option("--install", "Show installation instructions")
  .action(async (shell, options) => {
    const validShells = ["bash", "zsh", "fish"];
    if (!validShells.includes(shell)) {
      console.log(pc.red(`Invalid shell: ${shell}`));
      console.log(pc.dim(`Supported shells: ${validShells.join(", ")}`));
      process.exit(1);
    }

    const { getCompletions, getInstallInstructions } = await import(
      "./utils/completions.ts"
    );

    if (options.install) {
      console.log(pc.cyan(`Installation instructions for ${shell}:\n`));
      console.log(getInstallInstructions(shell));
    } else {
      // Output completion script (for eval or redirect)
      console.log(getCompletions(shell));
    }
  });

// Subcommand: config
program
  .command("config")
  .description("Show current configuration")
  .option("--init", "Create default config file")
  .action(async (options) => {
    if (options.init) {
      ensureChatterDir();
      if (existsSync(CONFIG_PATH)) {
        console.log(pc.yellow(`Config file already exists: ${CONFIG_PATH}`));
        return;
      }
      writeFileSync(CONFIG_PATH, generateDefaultConfig());
      console.log(pc.green(`Created config file: ${CONFIG_PATH}`));
      return;
    }

    console.log(pc.cyan("Current Configuration:\n"));
    console.log(pc.dim(`  Config file: ${CONFIG_PATH}`));
    console.log(pc.dim(`  File exists: ${existsSync(CONFIG_PATH) ? "yes" : "no (using defaults)"}\n`));

    console.log("  " + pc.bold("output_dir") + ": " + config.output_dir);
    console.log("  " + pc.bold("model") + ": " + config.model);
    console.log("  " + pc.bold("temperature") + ": " + config.temperature);
    console.log("  " + pc.bold("speed") + ": " + config.speed);
    console.log("  " + pc.bold("markdown_mode") + ": " + config.markdown_mode);
    console.log("  " + pc.bold("code_blocks") + ": " + config.code_blocks);
    console.log("  " + pc.bold("voice") + ": " + (config.voice || "(none)"));
    console.log("  " + pc.bold("daemon") + ": " + config.daemon);
    console.log("  " + pc.bold("log_level") + ": " + config.log_level);
  });

// Subcommand: health
program
  .command("health")
  .description("Check system health")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const { runHealthChecks } = await import("./core/health.ts");

    const report = await runHealthChecks();

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      const statusIcon = {
        healthy: pc.green("✓"),
        degraded: pc.yellow("⚠"),
        unhealthy: pc.red("✗"),
      };

      console.log(`\n${statusIcon[report.overall]} System: ${report.overall.toUpperCase()}\n`);

      for (const check of report.checks) {
        const icon =
          check.status === "pass"
            ? pc.green("✓")
            : check.status === "warn"
              ? pc.yellow("⚠")
              : pc.red("✗");
        console.log(`  ${icon} ${check.name}: ${check.message}`);
      }

      console.log();
    }

    process.exit(report.overall === "unhealthy" ? 1 : 0);
  });

// Parse arguments
program.parse();
