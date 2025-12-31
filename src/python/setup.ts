/**
 * Python environment setup for speak CLI
 *
 * Setup strategy:
 * 1. Check for existing working setup
 * 2. Try embedded Python (most reliable)
 * 3. Fall back to system Python with venv
 */

import { existsSync, rmSync } from "fs";
import { spawn } from "child_process";
import { VENV_DIR, VENV_PYTHON, VENV_PIP, ensureChatterDir } from "../core/config.ts";
import { logger, logDecision } from "../ui/logger.ts";
import {
  hasEmbeddedPython,
  installEmbeddedPython,
  installPackages as installEmbeddedPackages,
  getPythonPath,
} from "./embedded.ts";

/**
 * Required Python packages
 */
export const REQUIRED_PACKAGES = [
  "mlx-audio",
  "mlx-lm",
  "scipy",
  "sounddevice",
  "librosa",
  "einops",
];

// Re-export for convenience
export { VENV_PYTHON, VENV_PIP };

/**
 * Run a command and return stdout/stderr
 */
async function runCommand(
  command: string,
  args: string[],
  options?: { showOutput?: boolean; cwd?: string }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      cwd: options?.cwd,
      stdio: options?.showOutput ? "inherit" : "pipe",
    });

    let stdout = "";
    let stderr = "";

    if (!options?.showOutput) {
      proc.stdout?.on("data", (data) => (stdout += data.toString()));
      proc.stderr?.on("data", (data) => (stderr += data.toString()));
    }

    proc.on("close", (exitCode) => {
      resolve({ stdout, stderr, exitCode: exitCode ?? 1 });
    });

    proc.on("error", (error) => {
      resolve({ stdout, stderr: error.message, exitCode: 1 });
    });
  });
}

/**
 * Check if Python 3 is available
 */
export async function checkPython(): Promise<{ available: boolean; version?: string; path?: string }> {
  const result = await runCommand("python3", ["--version"]);
  if (result.exitCode !== 0) {
    return { available: false };
  }

  const version = result.stdout.trim() || result.stderr.trim(); // Some Python versions output to stderr
  const pathResult = await runCommand("which", ["python3"]);

  return {
    available: true,
    version: version.replace("Python ", ""),
    path: pathResult.stdout.trim(),
  };
}

/**
 * Check if venv exists and is valid
 */
export function isVenvValid(): boolean {
  return existsSync(VENV_PYTHON) && existsSync(VENV_PIP);
}

/**
 * Create Python virtual environment
 */
export async function createVenv(force: boolean = false): Promise<boolean> {
  // Check if already exists
  if (isVenvValid() && !force) {
    logger.info("Virtual environment already exists at " + VENV_DIR);
    return true;
  }

  // Remove existing if force
  if (existsSync(VENV_DIR) && force) {
    logger.status("Removing existing virtual environment...");
    rmSync(VENV_DIR, { recursive: true });
  }

  // Ensure parent directory exists
  ensureChatterDir();

  // Create venv
  logger.status("Creating virtual environment...");
  const result = await runCommand("python3", ["-m", "venv", VENV_DIR]);

  if (result.exitCode !== 0) {
    logger.error("Failed to create virtual environment", { stderr: result.stderr });
    return false;
  }

  logger.success("Created virtual environment at " + VENV_DIR);
  return true;
}

/**
 * Install required packages
 */
export async function installPackages(showProgress: boolean = true): Promise<boolean> {
  if (!isVenvValid()) {
    logger.error("Virtual environment not found. Run 'speak setup' first.");
    return false;
  }

  // Upgrade pip first
  logger.status("Upgrading pip...");
  const pipUpgrade = await runCommand(VENV_PIP, ["install", "--upgrade", "pip"], {
    showOutput: showProgress,
  });
  if (pipUpgrade.exitCode !== 0) {
    logger.warn("Failed to upgrade pip, continuing anyway...");
  }

  // Install packages
  logger.status("Installing packages: " + REQUIRED_PACKAGES.join(", "));
  const result = await runCommand(VENV_PIP, ["install", ...REQUIRED_PACKAGES], {
    showOutput: showProgress,
  });

  if (result.exitCode !== 0) {
    logger.error("Failed to install packages");
    if (!showProgress) {
      logger.error("Error output:", { stderr: result.stderr });
    }
    return false;
  }

  logger.success("All packages installed successfully");
  return true;
}

/**
 * Get installed package versions
 */
export async function getPackageVersions(): Promise<Record<string, string>> {
  if (!isVenvValid()) {
    return {};
  }

  const result = await runCommand(VENV_PIP, ["list", "--format=json"]);
  if (result.exitCode !== 0) {
    return {};
  }

  try {
    const packages = JSON.parse(result.stdout) as Array<{ name: string; version: string }>;
    const versions: Record<string, string> = {};
    for (const pkg of packages) {
      versions[pkg.name.toLowerCase()] = pkg.version;
    }
    return versions;
  } catch {
    return {};
  }
}

export interface SetupOptions {
  force?: boolean;
  showProgress?: boolean;
  useEmbedded?: boolean;
  onProgress?: (step: string, message: string, percent?: number) => void;
}

export interface SetupResult {
  success: boolean;
  pythonPath: string;
  method: "embedded" | "venv" | "system";
  error?: string;
}

/**
 * Check if existing setup is valid and working
 */
async function checkExistingSetup(): Promise<SetupResult> {
  try {
    const pythonPath = getPythonPath();
    const result = await runCommand(pythonPath, ["-c", "import mlx_audio; print('OK')"]);

    if (result.exitCode === 0) {
      return {
        success: true,
        pythonPath,
        method: hasEmbeddedPython() ? "embedded" : "venv",
      };
    }
  } catch {
    // Fall through
  }

  return {
    success: false,
    pythonPath: "",
    method: "system",
    error: "Existing setup not valid",
  };
}

/**
 * Run full setup (unified flow from implementation plan)
 *
 * Strategy:
 * 1. Check for existing working setup (unless force)
 * 2. Try embedded Python (most reliable)
 * 3. Fall back to system Python with venv
 */
export async function runSetup(options: SetupOptions = {}): Promise<boolean> {
  const { force = false, showProgress = true, useEmbedded = true, onProgress } = options;

  logDecision(
    "Starting setup",
    force ? "Force reinstall requested" : "Checking environment",
    { force, useEmbedded }
  );

  // Step 1: Check existing setup (unless force)
  if (!force) {
    const existing = await checkExistingSetup();
    if (existing.success) {
      logDecision("Using existing setup", "Environment already valid", {
        pythonPath: existing.pythonPath,
        method: existing.method,
      });
      if (showProgress) {
        logger.success(`Using existing ${existing.method} Python at ${existing.pythonPath}`);
      }
      return true;
    }
  }

  // Step 2: Try embedded Python (most reliable)
  if (useEmbedded) {
    if (showProgress) {
      logger.status("Setting up embedded Python...");
    }
    onProgress?.("python", "Setting up embedded Python...", 0);

    if (!hasEmbeddedPython() || force) {
      const installed = await installEmbeddedPython((msg, pct) => {
        onProgress?.("python", msg, pct);
        if (showProgress) {
          logger.status(msg);
        }
      });

      if (!installed) {
        logger.warn("Embedded Python installation failed, trying venv");
      }
    }

    if (hasEmbeddedPython()) {
      onProgress?.("packages", "Installing packages...", 50);
      if (showProgress) {
        logger.status("Installing packages with embedded Python...");
      }

      const packagesInstalled = await installEmbeddedPackages(REQUIRED_PACKAGES, (msg) => {
        onProgress?.("packages", msg);
        if (showProgress) {
          logger.status(msg);
        }
      });

      if (packagesInstalled) {
        // Verify
        const result = await checkExistingSetup();
        if (result.success) {
          onProgress?.("complete", "Setup complete!", 100);
          if (showProgress) {
            logger.success("Setup complete with embedded Python");
          }
          return true;
        }
      }
    }
  }

  // Step 3: Fall back to venv with system Python
  if (showProgress) {
    logger.status("Falling back to system Python with venv...");
  }
  onProgress?.("venv", "Creating virtual environment...", 0);

  // Check Python
  const python = await checkPython();
  if (!python.available) {
    logger.error("Python 3 not found. Please install Python 3.10+ to continue.");
    return false;
  }
  logger.info(`Found Python ${python.version} at ${python.path}`);

  // Create venv
  const venvCreated = await createVenv(force);
  if (!venvCreated) {
    return false;
  }

  // Install packages
  onProgress?.("packages", "Installing packages...", 50);
  const packagesInstalled = await installPackages(showProgress);
  if (!packagesInstalled) {
    return false;
  }

  // Verify installation
  logger.status("Verifying installation...");
  const versions = await getPackageVersions();
  const mlxAudio = versions["mlx-audio"];
  if (mlxAudio) {
    logger.success(`mlx-audio ${mlxAudio} installed successfully`);
    onProgress?.("complete", "Setup complete!", 100);
    return true;
  } else {
    logger.warn("Could not verify mlx-audio installation");
    return false;
  }
}
