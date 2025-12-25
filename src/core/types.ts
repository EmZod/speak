/**
 * Core types and schemas for speak CLI
 */

import { z } from "zod";

/**
 * Markdown processing modes
 */
export const MarkdownMode = z.enum(["plain", "smart"]);
export type MarkdownMode = z.infer<typeof MarkdownMode>;

/**
 * Code block handling modes
 */
export const CodeBlockMode = z.enum(["read", "skip", "placeholder"]);
export type CodeBlockMode = z.infer<typeof CodeBlockMode>;

/**
 * Log levels
 */
export const LogLevel = z.enum(["debug", "info", "warn", "error"]);
export type LogLevel = z.infer<typeof LogLevel>;

/**
 * Configuration schema matching plan.md Section 5
 */
export const ConfigSchema = z.object({
  // Output
  output_dir: z.string().default("~/Audio/speak"),

  // Model settings
  model: z.string().default("mlx-community/chatterbox-turbo-8bit"),
  temperature: z.number().min(0).max(1).default(0.5),
  speed: z.number().min(0).max(2).default(1.0),

  // Processing
  markdown_mode: MarkdownMode.default("plain"),
  code_blocks: CodeBlockMode.default("read"),

  // Voice
  voice: z.string().optional(),

  // Behavior
  daemon: z.boolean().default(false),
  update_check: z.boolean().default(false),

  // Logging
  log_level: LogLevel.default("info"),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: Config = ConfigSchema.parse({});

/**
 * CLI options that can override config
 */
export interface CliOptions {
  clipboard?: boolean;
  output?: string;
  model?: string;
  temp?: string;
  speed?: string;
  voice?: string;
  markdown?: string;
  codeBlocks?: string;
  play?: boolean;
  stream?: boolean;
  preview?: boolean;
  daemon?: boolean;
  verbose?: boolean;
  quiet?: boolean;
}

/**
 * Resolved options (config + CLI merged)
 */
export interface ResolvedOptions {
  config: Config;
  cli: CliOptions;
  input: string[];
}
