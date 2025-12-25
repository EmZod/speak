/**
 * Configuration loading and management
 *
 * Loads config from ~/.chatter/config.toml with fallback to defaults.
 * Environment variables override config file values.
 */

import { existsSync, readFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import TOML from "@iarna/toml";
import { ConfigSchema, DEFAULT_CONFIG, type Config } from "./types.ts";

/**
 * Base directory for speak configuration
 */
export const CHATTER_DIR = join(homedir(), ".chatter");

/**
 * Path to configuration file
 */
export const CONFIG_PATH = join(CHATTER_DIR, "config.toml");

/**
 * Path to logs directory
 */
export const LOGS_DIR = join(CHATTER_DIR, "logs");

/**
 * Path to voices directory
 */
export const VOICES_DIR = join(CHATTER_DIR, "voices");

/**
 * Path to Unix socket for IPC
 */
export const SOCKET_PATH = join(CHATTER_DIR, "speak.sock");

/**
 * Path to managed Python venv
 */
export const VENV_DIR = join(CHATTER_DIR, "env");

/**
 * Path to Python interpreter in venv
 */
export const VENV_PYTHON = join(VENV_DIR, "bin", "python3");

/**
 * Path to pip in venv
 */
export const VENV_PIP = join(VENV_DIR, "bin", "pip");

/**
 * Expand ~ to home directory in paths
 */
export function expandPath(path: string): string {
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

/**
 * Ensure the .chatter directory structure exists
 */
export function ensureChatterDir(): void {
  if (!existsSync(CHATTER_DIR)) {
    mkdirSync(CHATTER_DIR, { recursive: true });
  }
  if (!existsSync(LOGS_DIR)) {
    mkdirSync(LOGS_DIR, { recursive: true });
  }
  if (!existsSync(VOICES_DIR)) {
    mkdirSync(VOICES_DIR, { recursive: true });
  }
}

/**
 * Load configuration from TOML file
 * Returns null if file doesn't exist
 */
function loadConfigFile(): Partial<Config> | null {
  if (!existsSync(CONFIG_PATH)) {
    return null;
  }

  try {
    const content = readFileSync(CONFIG_PATH, "utf-8");
    const parsed = TOML.parse(content);
    return parsed as Partial<Config>;
  } catch (error) {
    console.error(`Warning: Failed to parse config file: ${error}`);
    return null;
  }
}

/**
 * Load configuration from environment variables
 * Uses SPEAK_ prefix (e.g., SPEAK_MODEL, SPEAK_TEMPERATURE)
 */
function loadEnvConfig(): Partial<Config> {
  const env: Partial<Config> = {};

  if (process.env.SPEAK_OUTPUT_DIR) {
    env.output_dir = process.env.SPEAK_OUTPUT_DIR;
  }
  if (process.env.SPEAK_MODEL) {
    env.model = process.env.SPEAK_MODEL;
  }
  if (process.env.SPEAK_TEMPERATURE) {
    const temp = parseFloat(process.env.SPEAK_TEMPERATURE);
    if (!isNaN(temp)) env.temperature = temp;
  }
  if (process.env.SPEAK_SPEED) {
    const speed = parseFloat(process.env.SPEAK_SPEED);
    if (!isNaN(speed)) env.speed = speed;
  }
  if (process.env.SPEAK_MARKDOWN_MODE) {
    env.markdown_mode = process.env.SPEAK_MARKDOWN_MODE as Config["markdown_mode"];
  }
  if (process.env.SPEAK_VOICE) {
    env.voice = process.env.SPEAK_VOICE;
  }
  if (process.env.SPEAK_DAEMON !== undefined) {
    env.daemon = process.env.SPEAK_DAEMON === "true" || process.env.SPEAK_DAEMON === "1";
  }
  if (process.env.SPEAK_LOG_LEVEL) {
    env.log_level = process.env.SPEAK_LOG_LEVEL as Config["log_level"];
  }

  return env;
}

/**
 * Load and merge configuration from all sources
 * Priority: CLI options > Environment > Config file > Defaults
 */
export function loadConfig(): Config {
  // Start with defaults
  let config = { ...DEFAULT_CONFIG };

  // Layer 1: Config file (if exists)
  const fileConfig = loadConfigFile();
  if (fileConfig) {
    config = { ...config, ...fileConfig };
  }

  // Layer 2: Environment variables
  const envConfig = loadEnvConfig();
  config = { ...config, ...envConfig };

  // Validate and return
  const result = ConfigSchema.safeParse(config);
  if (!result.success) {
    console.error("Warning: Invalid configuration values, using defaults");
    console.error(result.error.issues.map(i => `  - ${i.path.join(".")}: ${i.message}`).join("\n"));
    return DEFAULT_CONFIG;
  }

  return result.data;
}

/**
 * Generate default config file content
 */
export function generateDefaultConfig(): string {
  return `# speak CLI configuration
# Location: ~/.chatter/config.toml

# Default output directory
output_dir = "~/Audio/speak"

# Default model (chatterbox-turbo-8bit recommended for best performance)
model = "mlx-community/chatterbox-turbo-8bit"

# Default temperature (0-1)
temperature = 0.5

# Default speed (0-2)
speed = 1.0

# Markdown processing mode: "plain" or "smart"
markdown_mode = "plain"

# Code block handling: "read", "skip", or "placeholder"
code_blocks = "read"

# Default voice preset (optional)
# voice = "narrator"

# Enable daemon mode by default
daemon = false

# Check for updates (opt-in)
update_check = false

# Log level: "debug", "info", "warn", "error"
log_level = "info"
`;
}
