/**
 * Logging infrastructure for speak CLI
 *
 * - File logging to ~/.chatter/logs/ (always at debug level)
 * - Console logging (respects config log_level)
 * - Structured JSON format for files
 * - Human-readable format for console
 */

import { appendFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import pc from "picocolors";
import { LOGS_DIR, ensureChatterDir } from "../core/config.ts";
import type { LogLevel } from "../core/types.ts";

/**
 * Log level priority (lower = more verbose)
 */
const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Logger state
 */
interface LoggerState {
  consoleLevel: LogLevel;
  quiet: boolean;
  verbose: boolean;
  initialized: boolean;
}

const state: LoggerState = {
  consoleLevel: "info",
  quiet: false,
  verbose: false,
  initialized: false,
};

/**
 * Get today's log file path
 */
function getLogFilePath(): string {
  const date = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  return join(LOGS_DIR, `speak_${date}.log`);
}

/**
 * Format timestamp for logging
 */
function timestamp(): string {
  return new Date().toISOString();
}

/**
 * Initialize logger with config
 */
export function initLogger(options: {
  logLevel?: LogLevel;
  quiet?: boolean;
  verbose?: boolean;
}): void {
  state.consoleLevel = options.logLevel ?? "info";
  state.quiet = options.quiet ?? false;
  state.verbose = options.verbose ?? false;
  state.initialized = true;

  // Ensure log directory exists
  ensureChatterDir();
}

/**
 * Write structured JSON to log file
 */
function writeToFile(level: LogLevel, message: string, data?: Record<string, unknown>): void {
  try {
    const logPath = getLogFilePath();
    const entry = {
      timestamp: timestamp(),
      level,
      message,
      ...(data && { data }),
    };
    appendFileSync(logPath, JSON.stringify(entry) + "\n");
  } catch {
    // Silently ignore file write errors to avoid infinite loops
  }
}

/**
 * Check if a log level should be shown on console
 */
function shouldLogToConsole(level: LogLevel): boolean {
  if (state.quiet && level !== "error") return false;
  if (state.verbose) return true;
  return LOG_LEVELS[level] >= LOG_LEVELS[state.consoleLevel];
}

/**
 * Format console output with colors
 */
function formatConsole(level: LogLevel, message: string): string {
  const prefix = {
    debug: pc.dim("[debug]"),
    info: pc.blue("[info]"),
    warn: pc.yellow("[warn]"),
    error: pc.red("[error]"),
  };
  return `${prefix[level]} ${message}`;
}

/**
 * Core logging function
 */
function log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
  // Always write to file at all levels
  writeToFile(level, message, data);

  // Console output based on level/quiet/verbose
  if (shouldLogToConsole(level)) {
    console.log(formatConsole(level, message));
    if (data && (state.verbose || level === "error")) {
      console.log(pc.dim(JSON.stringify(data, null, 2)));
    }
  }
}

/**
 * Public logging functions
 */
export const logger = {
  debug: (message: string, data?: Record<string, unknown>) => log("debug", message, data),
  info: (message: string, data?: Record<string, unknown>) => log("info", message, data),
  warn: (message: string, data?: Record<string, unknown>) => log("warn", message, data),
  error: (message: string, data?: Record<string, unknown>) => log("error", message, data),

  /**
   * Log an error with stack trace
   */
  exception: (message: string, error: unknown) => {
    const errorData: Record<string, unknown> = {};
    if (error instanceof Error) {
      errorData.name = error.name;
      errorData.message = error.message;
      errorData.stack = error.stack;
    } else {
      errorData.error = String(error);
    }
    log("error", message, errorData);
  },

  /**
   * Print to console without logging to file (for user output)
   */
  print: (message: string) => {
    if (!state.quiet) {
      console.log(message);
    }
  },

  /**
   * Print success message
   */
  success: (message: string) => {
    if (!state.quiet) {
      console.log(pc.green("✓ " + message));
    }
    writeToFile("info", message, { success: true });
  },

  /**
   * Print progress/status update
   */
  status: (message: string) => {
    if (!state.quiet) {
      console.log(pc.cyan("→ " + message));
    }
    writeToFile("info", message, { status: true });
  },
};
