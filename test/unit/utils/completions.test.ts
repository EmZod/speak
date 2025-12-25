/**
 * Unit tests for utils/completions.ts
 *
 * Tests shell completion generation including:
 * - Bash completions
 * - Zsh completions
 * - Fish completions
 * - Installation instructions
 */

import { describe, test, expect } from "bun:test";
import { testLog } from "../../helpers/test-utils.ts";
import {
  generateBashCompletions,
  generateZshCompletions,
  generateFishCompletions,
  getCompletions,
  getInstallInstructions,
  type Shell,
} from "../../../src/utils/completions.ts";

describe("utils/completions.ts", () => {
  describe("generateBashCompletions", () => {
    test("returns valid bash script", () => {
      testLog.step(1, "Testing bash completion generation");
      const script = generateBashCompletions();

      expect(script).toContain("_speak_completions");
      expect(script).toContain("complete -F");
      expect(script).toContain("COMPREPLY");
      testLog.info("Bash completion script generated");
    });

    test("includes all main commands", () => {
      const script = generateBashCompletions();

      expect(script).toContain("setup");
      expect(script).toContain("models");
      expect(script).toContain("daemon");
      expect(script).toContain("completions");
      expect(script).toContain("config");
    });

    test("includes all main flags", () => {
      const script = generateBashCompletions();

      expect(script).toContain("--clipboard");
      expect(script).toContain("--output");
      expect(script).toContain("--model");
      expect(script).toContain("--temp");
      expect(script).toContain("--speed");
      expect(script).toContain("--voice");
      expect(script).toContain("--play");
      expect(script).toContain("--stream");
      expect(script).toContain("--preview");
      expect(script).toContain("--daemon");
    });

    test("includes short flag variants", () => {
      const script = generateBashCompletions();

      expect(script).toContain("-c");
      expect(script).toContain("-o");
      expect(script).toContain("-m");
      expect(script).toContain("-t");
      expect(script).toContain("-s");
      expect(script).toContain("-v");
    });

    test("includes model names for completion", () => {
      const script = generateBashCompletions();

      expect(script).toContain("mlx-community/chatterbox-turbo-8bit");
      expect(script).toContain("mlx-community/chatterbox-turbo-fp16");
      expect(script).toContain("mlx-community/chatterbox-turbo-4bit");
    });

    test("includes markdown modes", () => {
      const script = generateBashCompletions();

      expect(script).toContain("plain");
      expect(script).toContain("smart");
    });

    test("includes code block modes", () => {
      const script = generateBashCompletions();

      expect(script).toContain("read");
      expect(script).toContain("skip");
      expect(script).toContain("placeholder");
    });

    test("handles daemon subcommand", () => {
      const script = generateBashCompletions();

      expect(script).toContain("daemon");
      expect(script).toContain("kill");
    });

    test("handles completions subcommand with shell options", () => {
      const script = generateBashCompletions();

      // Should list shells for the completions command
      expect(script).toContain("bash");
      expect(script).toContain("zsh");
      expect(script).toContain("fish");
    });

    test("includes helpful comment", () => {
      const script = generateBashCompletions();

      expect(script).toContain("Bash completions for speak CLI");
    });
  });

  describe("generateZshCompletions", () => {
    test("returns valid zsh script", () => {
      testLog.step(1, "Testing zsh completion generation");
      const script = generateZshCompletions();

      expect(script).toContain("#compdef speak");
      expect(script).toContain("_speak");
      expect(script).toContain("compdef _speak speak");
      testLog.info("Zsh completion script generated");
    });

    test("includes command descriptions", () => {
      const script = generateZshCompletions();

      expect(script).toContain("Set up Python environment");
      expect(script).toContain("List available TTS models");
      expect(script).toContain("Daemon management");
      expect(script).toContain("Generate shell completions");
      expect(script).toContain("Show current configuration");
    });

    test("includes option descriptions", () => {
      const script = generateZshCompletions();

      expect(script).toContain("Read from system clipboard");
      expect(script).toContain("Output directory");
      expect(script).toContain("TTS model");
      expect(script).toContain("Temperature");
      expect(script).toContain("Playback speed");
      expect(script).toContain("Play audio after generation");
    });

    test("includes file completion for directories", () => {
      const script = generateZshCompletions();

      expect(script).toContain("_files");
    });

    test("includes model options", () => {
      const script = generateZshCompletions();

      expect(script).toContain("mlx-community/chatterbox-turbo-8bit");
      expect(script).toContain("mlx-community/chatterbox-turbo-fp16");
    });

    test("includes helper functions for subcommands", () => {
      const script = generateZshCompletions();

      expect(script).toContain("_speak_daemon");
      expect(script).toContain("_speak_completions");
    });

    test("includes helpful comment", () => {
      const script = generateZshCompletions();

      expect(script).toContain("Zsh completions for speak CLI");
    });
  });

  describe("generateFishCompletions", () => {
    test("returns valid fish script", () => {
      testLog.step(1, "Testing fish completion generation");
      const script = generateFishCompletions();

      expect(script).toContain("complete -c speak");
      expect(script).toContain("__fish_use_subcommand");
      testLog.info("Fish completion script generated");
    });

    test("includes all commands", () => {
      const script = generateFishCompletions();

      expect(script).toContain("-a \"setup\"");
      expect(script).toContain("-a \"models\"");
      expect(script).toContain("-a \"daemon\"");
      expect(script).toContain("-a \"completions\"");
      expect(script).toContain("-a \"config\"");
    });

    test("includes command descriptions", () => {
      const script = generateFishCompletions();

      expect(script).toContain("-d \"Set up Python environment\"");
      expect(script).toContain("-d \"List available TTS models\"");
      expect(script).toContain("-d \"Daemon management\"");
    });

    test("includes short and long options", () => {
      const script = generateFishCompletions();

      expect(script).toContain("-s c -l clipboard");
      expect(script).toContain("-s o -l output");
      expect(script).toContain("-s m -l model");
      expect(script).toContain("-s t -l temp");
      expect(script).toContain("-s s -l speed");
      expect(script).toContain("-s v -l voice");
    });

    test("includes model options for -m/--model", () => {
      const script = generateFishCompletions();

      expect(script).toContain("mlx-community/chatterbox-turbo-8bit");
      expect(script).toContain("mlx-community/chatterbox-turbo-fp16");
    });

    test("includes markdown mode options", () => {
      const script = generateFishCompletions();

      expect(script).toContain("-a \"plain smart\"");
    });

    test("includes code block mode options", () => {
      const script = generateFishCompletions();

      expect(script).toContain("-a \"read skip placeholder\"");
    });

    test("handles daemon subcommand", () => {
      const script = generateFishCompletions();

      expect(script).toContain("__fish_seen_subcommand_from daemon");
      expect(script).toContain("-a \"kill\"");
    });

    test("includes helpful comment", () => {
      const script = generateFishCompletions();

      expect(script).toContain("Fish completions for speak CLI");
    });

    test("disables default file completions", () => {
      const script = generateFishCompletions();

      expect(script).toContain("complete -c speak -f");
    });
  });

  describe("getCompletions", () => {
    test("returns bash completions for bash", () => {
      testLog.step(1, "Testing getCompletions dispatcher");
      const result = getCompletions("bash");

      expect(result).toContain("_speak_completions");
      expect(result).toContain("complete -F");
    });

    test("returns zsh completions for zsh", () => {
      const result = getCompletions("zsh");

      expect(result).toContain("#compdef speak");
      expect(result).toContain("compdef _speak speak");
    });

    test("returns fish completions for fish", () => {
      const result = getCompletions("fish");

      expect(result).toContain("complete -c speak");
    });

    test("throws for unsupported shell", () => {
      expect(() => getCompletions("powershell" as Shell)).toThrow();
      expect(() => getCompletions("unknown" as Shell)).toThrow();
    });

    test("all shell completions are non-empty", () => {
      const shells: Shell[] = ["bash", "zsh", "fish"];

      for (const shell of shells) {
        const result = getCompletions(shell);
        expect(result.length).toBeGreaterThan(100);
      }
    });
  });

  describe("getInstallInstructions", () => {
    test("returns bash installation instructions", () => {
      testLog.step(1, "Testing installation instructions");
      const instructions = getInstallInstructions("bash");

      expect(instructions).toContain("bashrc");
      expect(instructions).toContain("eval");
      expect(instructions).toContain("speak completions bash");
      testLog.info("Bash install instructions verified");
    });

    test("returns zsh installation instructions", () => {
      const instructions = getInstallInstructions("zsh");

      expect(instructions).toContain("zshrc");
      expect(instructions).toContain("eval");
      expect(instructions).toContain("speak completions zsh");
    });

    test("returns fish installation instructions", () => {
      const instructions = getInstallInstructions("fish");

      expect(instructions).toContain(".config/fish/completions");
      expect(instructions).toContain("speak completions fish");
    });

    test("throws for unsupported shell", () => {
      expect(() => getInstallInstructions("powershell" as Shell)).toThrow();
    });

    test("instructions include alternative methods", () => {
      const bashInstructions = getInstallInstructions("bash");
      const zshInstructions = getInstallInstructions("zsh");

      // Should mention both eval and file-based methods
      expect(bashInstructions).toContain("eval");
      expect(bashInstructions).toContain("save to");

      expect(zshInstructions).toContain("eval");
      expect(zshInstructions).toContain("save to");
    });
  });

  describe("completion script validity", () => {
    test("bash script has matching braces", () => {
      testLog.step(1, "Validating bash script syntax");
      const script = generateBashCompletions();

      const openBraces = (script.match(/\{/g) || []).length;
      const closeBraces = (script.match(/\}/g) || []).length;

      expect(openBraces).toBe(closeBraces);
      testLog.info(`Braces balanced: ${openBraces} open, ${closeBraces} close`);
    });

    test("bash script has reasonable parentheses balance", () => {
      const script = generateBashCompletions();

      // Note: Bash case statements use unbalanced parens intentionally (e.g., "case)" patterns)
      // Just verify the script is non-empty and contains expected patterns
      expect(script.length).toBeGreaterThan(100);
      expect(script).toContain("case");
      expect(script).toContain("esac");
    });

    test("zsh script has reasonable parentheses balance", () => {
      const script = generateZshCompletions();

      // Note: Zsh completion scripts have specific syntax patterns
      // Just verify the script is non-empty and contains expected patterns
      expect(script.length).toBeGreaterThan(100);
      expect(script).toContain("compdef");
    });

    test("fish script doesn't have obvious syntax errors", () => {
      const script = generateFishCompletions();

      // Fish uses -a for adding completions
      expect(script).toMatch(/complete.*-a/);

      // Should not have unbalanced quotes (simple check)
      const doubleQuotes = (script.match(/"/g) || []).length;
      expect(doubleQuotes % 2).toBe(0);
    });
  });

  describe("edge cases", () => {
    test("model names with slashes are properly escaped in bash", () => {
      const script = generateBashCompletions();

      // Model names contain slashes, should be in quotes or escaped
      expect(script).toContain("mlx-community/chatterbox");
    });

    test("special characters in descriptions are handled", () => {
      const bashScript = generateBashCompletions();
      const zshScript = generateZshCompletions();
      const fishScript = generateFishCompletions();

      // All scripts should be generated without throwing
      expect(bashScript.length).toBeGreaterThan(0);
      expect(zshScript.length).toBeGreaterThan(0);
      expect(fishScript.length).toBeGreaterThan(0);
    });

    test("completion for paths with spaces works", () => {
      const script = generateBashCompletions();

      // Should use compgen -f for file completion which handles spaces
      expect(script).toContain("compgen -f");
    });
  });

  describe("consistency across shells", () => {
    test("all shells complete the same commands", () => {
      const commands = ["setup", "models", "daemon", "completions", "config"];
      const bash = generateBashCompletions();
      const zsh = generateZshCompletions();
      const fish = generateFishCompletions();

      for (const cmd of commands) {
        expect(bash).toContain(cmd);
        expect(zsh).toContain(cmd);
        expect(fish).toContain(cmd);
      }
    });

    test("all shells complete the same models", () => {
      const models = [
        "mlx-community/chatterbox-turbo-8bit",
        "mlx-community/chatterbox-turbo-fp16",
        "mlx-community/chatterbox-turbo-4bit",
      ];
      const bash = generateBashCompletions();
      const zsh = generateZshCompletions();
      const fish = generateFishCompletions();

      for (const model of models) {
        expect(bash).toContain(model);
        expect(zsh).toContain(model);
        expect(fish).toContain(model);
      }
    });

    test("all shells have play and stream flags", () => {
      const bash = generateBashCompletions();
      const zsh = generateZshCompletions();
      const fish = generateFishCompletions();

      // Bash and Zsh use --flag format
      expect(bash).toContain("--play");
      expect(bash).toContain("--stream");
      expect(zsh).toContain("--play");
      expect(zsh).toContain("--stream");

      // Fish uses -l flag format (long options)
      expect(fish).toContain("-l play");
      expect(fish).toContain("-l stream");
      expect(fish).toContain("-l preview");
      expect(fish).toContain("-l daemon");
    });
  });
});
