/**
 * Embedded Python management for speak TTS.
 *
 * Downloads and manages a standalone Python distribution for reliable setup.
 * Falls back to system Python if embedded fails.
 */

import { existsSync, mkdirSync, createWriteStream, unlinkSync } from "fs";
import { join } from "path";
import { pipeline } from "stream/promises";
import { createGunzip } from "zlib";
import { CHATTER_DIR, VENV_PYTHON } from "../core/config.ts";
import { logger, logDecision } from "../ui/logger.ts";

const PYTHON_VERSION = "3.11.7";
const PYTHON_BUILD = "20240107";

// Platform-specific download URLs from python-build-standalone
const PYTHON_URLS: Record<string, string> = {
  "darwin-arm64": `https://github.com/indygreg/python-build-standalone/releases/download/${PYTHON_BUILD}/cpython-${PYTHON_VERSION}+${PYTHON_BUILD}-aarch64-apple-darwin-install_only.tar.gz`,
  "darwin-x64": `https://github.com/indygreg/python-build-standalone/releases/download/${PYTHON_BUILD}/cpython-${PYTHON_VERSION}+${PYTHON_BUILD}-x86_64-apple-darwin-install_only.tar.gz`,
  "linux-arm64": `https://github.com/indygreg/python-build-standalone/releases/download/${PYTHON_BUILD}/cpython-${PYTHON_VERSION}+${PYTHON_BUILD}-aarch64-unknown-linux-gnu-install_only.tar.gz`,
  "linux-x64": `https://github.com/indygreg/python-build-standalone/releases/download/${PYTHON_BUILD}/cpython-${PYTHON_VERSION}+${PYTHON_BUILD}-x86_64-unknown-linux-gnu-install_only.tar.gz`,
};

const EMBEDDED_PYTHON_DIR = join(CHATTER_DIR, "python");
const EMBEDDED_PYTHON_BIN = join(EMBEDDED_PYTHON_DIR, "bin", "python3");
const EMBEDDED_PIP = join(EMBEDDED_PYTHON_DIR, "bin", "pip3");

/**
 * Check if embedded Python is available and working
 */
export function hasEmbeddedPython(): boolean {
  if (!existsSync(EMBEDDED_PYTHON_BIN)) {
    return false;
  }

  try {
    const { execSync } = require("child_process");
    execSync(`${EMBEDDED_PYTHON_BIN} --version`, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the path to the Python interpreter (embedded or system)
 */
export function getPythonPath(): string {
  if (hasEmbeddedPython()) {
    return EMBEDDED_PYTHON_BIN;
  }

  // Fall back to venv Python
  if (existsSync(VENV_PYTHON)) {
    return VENV_PYTHON;
  }

  // Last resort: system Python
  return "python3";
}

/**
 * Get the path to pip (embedded or system)
 */
export function getPipPath(): string {
  if (hasEmbeddedPython()) {
    return EMBEDDED_PIP;
  }

  // Fall back to venv pip
  const venvPip = VENV_PYTHON.replace("python", "pip");
  if (existsSync(venvPip)) {
    return venvPip;
  }

  return "pip3";
}

/**
 * Download and install embedded Python
 */
export async function installEmbeddedPython(
  onProgress?: (message: string, percent?: number) => void
): Promise<boolean> {
  const platform = `${process.platform}-${process.arch}`;
  const url = PYTHON_URLS[platform];

  if (!url) {
    logger.error("Unsupported platform for embedded Python", { platform });
    return false;
  }

  logDecision("Installing embedded Python", "No suitable Python found on system", {
    platform,
    url,
  });

  try {
    // Create directory
    if (!existsSync(CHATTER_DIR)) {
      mkdirSync(CHATTER_DIR, { recursive: true });
    }

    // Download
    onProgress?.("Downloading Python...", 0);
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Download failed: ${response.statusText}`);
    }

    const totalBytes = parseInt(response.headers.get("content-length") || "0", 10);
    let downloadedBytes = 0;

    // Create temp file
    const tempPath = join(CHATTER_DIR, "python-download.tar.gz");
    const writeStream = createWriteStream(tempPath);

    // Stream download with progress
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      writeStream.write(value);
      downloadedBytes += value.length;

      if (totalBytes > 0) {
        const percent = Math.round((downloadedBytes / totalBytes) * 50); // 0-50%
        onProgress?.(
          `Downloading Python... ${Math.round(downloadedBytes / 1024 / 1024)}MB`,
          percent
        );
      }
    }

    writeStream.end();
    await new Promise((resolve) => writeStream.on("finish", resolve));

    // Extract using tar command (simpler than js library)
    onProgress?.("Extracting Python...", 50);

    const { execSync } = require("child_process");

    // Remove old installation if exists
    if (existsSync(EMBEDDED_PYTHON_DIR)) {
      execSync(`rm -rf "${EMBEDDED_PYTHON_DIR}"`);
    }

    // Extract - the archive contains a 'python' directory
    execSync(`tar -xzf "${tempPath}" -C "${CHATTER_DIR}"`, { timeout: 60000 });

    // Cleanup temp file
    unlinkSync(tempPath);

    // Verify installation
    onProgress?.("Verifying Python...", 90);

    const version = execSync(`${EMBEDDED_PYTHON_BIN} --version`, {
      encoding: "utf-8",
    }).trim();

    logDecision("Embedded Python installed", version, { path: EMBEDDED_PYTHON_BIN });

    onProgress?.("Python ready", 100);
    return true;
  } catch (error) {
    logger.error("Failed to install embedded Python", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Install Python packages using embedded or system Python
 */
export async function installPackages(
  packages: string[],
  onProgress?: (message: string) => void
): Promise<boolean> {
  const pipPath = getPipPath();

  logDecision("Installing Python packages", `Using ${pipPath}`, { packages });

  try {
    const { spawn } = require("child_process");

    return new Promise((resolve) => {
      const proc = spawn(pipPath, ["install", "--upgrade", ...packages], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      proc.stdout.on("data", (data: Buffer) => {
        const line = data.toString().trim();
        if (line.includes("Installing") || line.includes("Successfully")) {
          onProgress?.(line);
        }
      });

      proc.stderr.on("data", (data: Buffer) => {
        logger.debug("pip stderr", { output: data.toString() });
      });

      proc.on("close", (code: number) => {
        resolve(code === 0);
      });
    });
  } catch (error) {
    logger.error("Failed to install packages", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Get embedded Python directory path
 */
export function getEmbeddedPythonDir(): string {
  return EMBEDDED_PYTHON_DIR;
}
