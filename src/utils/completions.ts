/**
 * Shell completions generator for speak CLI
 */

export type Shell = "bash" | "zsh" | "fish";

const COMMANDS = ["setup", "models", "daemon", "completions", "config"];
const DAEMON_SUBCOMMANDS = ["kill"];
const SHELL_OPTIONS = ["bash", "zsh", "fish"];

const FLAGS = [
  "-c",
  "--clipboard",
  "-o",
  "--output",
  "-m",
  "--model",
  "-t",
  "--temp",
  "-s",
  "--speed",
  "-v",
  "--voice",
  "--markdown",
  "--code-blocks",
  "--play",
  "--stream",
  "--preview",
  "--daemon",
  "--verbose",
  "--quiet",
  "--help",
  "--version",
];

const MODELS = [
  "mlx-community/chatterbox-turbo-8bit",
  "mlx-community/chatterbox-turbo-fp16",
  "mlx-community/chatterbox-turbo-4bit",
  "mlx-community/chatterbox-turbo-5bit",
  "mlx-community/chatterbox-turbo-6bit",
];

const MARKDOWN_MODES = ["plain", "smart"];
const CODE_BLOCK_MODES = ["read", "skip", "placeholder"];

/**
 * Generate bash completion script
 */
export function generateBashCompletions(): string {
  return `# Bash completions for speak CLI
# Add to ~/.bashrc or ~/.bash_profile:
# eval "$(speak completions bash)"

_speak_completions() {
    local cur prev opts commands
    COMPREPLY=()
    cur="\${COMP_WORDS[COMP_CWORD]}"
    prev="\${COMP_WORDS[COMP_CWORD-1]}"

    commands="${COMMANDS.join(" ")}"
    opts="${FLAGS.join(" ")}"

    # Handle subcommands
    case "\${COMP_WORDS[1]}" in
        daemon)
            COMPREPLY=( $(compgen -W "${DAEMON_SUBCOMMANDS.join(" ")}" -- "\${cur}") )
            return 0
            ;;
        completions)
            COMPREPLY=( $(compgen -W "${SHELL_OPTIONS.join(" ")}" -- "\${cur}") )
            return 0
            ;;
    esac

    # Handle option arguments
    case "\${prev}" in
        -m|--model)
            COMPREPLY=( $(compgen -W "${MODELS.join(" ")}" -- "\${cur}") )
            return 0
            ;;
        --markdown)
            COMPREPLY=( $(compgen -W "${MARKDOWN_MODES.join(" ")}" -- "\${cur}") )
            return 0
            ;;
        --code-blocks)
            COMPREPLY=( $(compgen -W "${CODE_BLOCK_MODES.join(" ")}" -- "\${cur}") )
            return 0
            ;;
        -o|--output|-v|--voice)
            # File/directory completion
            COMPREPLY=( $(compgen -f -- "\${cur}") )
            return 0
            ;;
    esac

    # Complete commands or options
    if [[ \${cur} == -* ]]; then
        COMPREPLY=( $(compgen -W "\${opts}" -- "\${cur}") )
    elif [[ \${COMP_CWORD} -eq 1 ]]; then
        COMPREPLY=( $(compgen -W "\${commands}" -- "\${cur}") )
    else
        # Default to file completion for text/file arguments
        COMPREPLY=( $(compgen -f -- "\${cur}") )
    fi

    return 0
}

complete -F _speak_completions speak
`;
}

/**
 * Generate zsh completion script
 */
export function generateZshCompletions(): string {
  return `#compdef speak
# Zsh completions for speak CLI
# Add to ~/.zshrc:
# eval "$(speak completions zsh)"

_speak() {
    local -a commands options

    commands=(
        'setup:Set up Python environment'
        'models:List available TTS models'
        'daemon:Daemon management'
        'completions:Generate shell completions'
        'config:Show current configuration'
    )

    options=(
        '-c[Read from system clipboard]'
        '--clipboard[Read from system clipboard]'
        '-o[Output directory]:directory:_files -/'
        '--output[Output directory]:directory:_files -/'
        '-m[TTS model]:model:(${MODELS.join(" ")})'
        '--model[TTS model]:model:(${MODELS.join(" ")})'
        '-t[Temperature (0-1)]:temperature:'
        '--temp[Temperature (0-1)]:temperature:'
        '-s[Playback speed (0-2)]:speed:'
        '--speed[Playback speed (0-2)]:speed:'
        '-v[Voice preset or path to .wav]:voice:_files -g "*.wav"'
        '--voice[Voice preset or path to .wav]:voice:_files -g "*.wav"'
        '--markdown[Markdown mode]:mode:(${MARKDOWN_MODES.join(" ")})'
        '--code-blocks[Code handling]:mode:(${CODE_BLOCK_MODES.join(" ")})'
        '--play[Play audio after generation]'
        '--stream[Stream audio as it generates]'
        '--preview[Generate first sentence only]'
        '--daemon[Use persistent server]'
        '--verbose[Show detailed progress]'
        '--quiet[Suppress all output except errors]'
        '--help[Show help]'
        '--version[Show version]'
    )

    _arguments -s \\
        $options \\
        '1:command:->command' \\
        '*:file:_files'

    case $state in
        command)
            _describe -t commands 'speak commands' commands
            ;;
    esac
}

_speak_daemon() {
    local -a subcommands
    subcommands=(
        'kill:Stop running daemon'
    )
    _describe -t subcommands 'daemon subcommands' subcommands
}

_speak_completions() {
    local -a shells
    shells=(bash zsh fish)
    _describe -t shells 'shell' shells
}

compdef _speak speak
`;
}

/**
 * Generate fish completion script
 */
export function generateFishCompletions(): string {
  return `# Fish completions for speak CLI
# Save to ~/.config/fish/completions/speak.fish
# Or run: speak completions fish > ~/.config/fish/completions/speak.fish

# Disable file completions by default
complete -c speak -f

# Commands
complete -c speak -n "__fish_use_subcommand" -a "setup" -d "Set up Python environment"
complete -c speak -n "__fish_use_subcommand" -a "models" -d "List available TTS models"
complete -c speak -n "__fish_use_subcommand" -a "daemon" -d "Daemon management"
complete -c speak -n "__fish_use_subcommand" -a "completions" -d "Generate shell completions"
complete -c speak -n "__fish_use_subcommand" -a "config" -d "Show current configuration"

# Daemon subcommands
complete -c speak -n "__fish_seen_subcommand_from daemon" -a "kill" -d "Stop running daemon"

# Completions subcommands
complete -c speak -n "__fish_seen_subcommand_from completions" -a "bash zsh fish"

# Options
complete -c speak -s c -l clipboard -d "Read from system clipboard"
complete -c speak -s o -l output -d "Output directory" -r -a "(__fish_complete_directories)"
complete -c speak -s m -l model -d "TTS model" -r -a "${MODELS.map((m) => `"${m}"`).join(" ")}"
complete -c speak -s t -l temp -d "Temperature (0-1)" -r
complete -c speak -s s -l speed -d "Playback speed (0-2)" -r
complete -c speak -s v -l voice -d "Voice preset or .wav file" -r -F
complete -c speak -l markdown -d "Markdown mode" -r -a "${MARKDOWN_MODES.join(" ")}"
complete -c speak -l code-blocks -d "Code handling" -r -a "${CODE_BLOCK_MODES.join(" ")}"
complete -c speak -l play -d "Play audio after generation"
complete -c speak -l stream -d "Stream audio as it generates"
complete -c speak -l preview -d "Generate first sentence only"
complete -c speak -l daemon -d "Use persistent server"
complete -c speak -l verbose -d "Show detailed progress"
complete -c speak -l quiet -d "Suppress all output except errors"
complete -c speak -l help -d "Show help"
complete -c speak -l version -d "Show version"

# Enable file completions for main command (text files)
complete -c speak -n "__fish_use_subcommand" -a "(__fish_complete_suffix .txt .md)"
`;
}

/**
 * Get completions for a specific shell
 */
export function getCompletions(shell: Shell): string {
  switch (shell) {
    case "bash":
      return generateBashCompletions();
    case "zsh":
      return generateZshCompletions();
    case "fish":
      return generateFishCompletions();
    default:
      throw new Error(`Unsupported shell: ${shell}`);
  }
}

/**
 * Get installation instructions for a specific shell
 */
export function getInstallInstructions(shell: Shell): string {
  switch (shell) {
    case "bash":
      return `# Add to ~/.bashrc or ~/.bash_profile:
eval "$(speak completions bash)"

# Or save to a file:
speak completions bash > ~/.local/share/bash-completion/completions/speak`;
    case "zsh":
      return `# Add to ~/.zshrc:
eval "$(speak completions zsh)"

# Or save to a file in your fpath:
speak completions zsh > ~/.zfunc/_speak`;
    case "fish":
      return `# Save to fish completions directory:
speak completions fish > ~/.config/fish/completions/speak.fish`;
    default:
      throw new Error(`Unsupported shell: ${shell}`);
  }
}
