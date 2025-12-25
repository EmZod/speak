/**
 * Python environment setup for speak CLI
 *
 * Creates and manages a Python virtual environment with mlx-audio
 * in ~/.chatter/env/
 */

import { existsSync, rmSync } from "fs";
import { spawn } from "child_process";
import { VENV_DIR, VENV_PYTHON, VENV_PIP, ensureChatterDir } from "../core/config.ts";
import { logger } from "../ui/logger.ts";

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

/**
 * Run full setup (create venv + install packages)
 */
export async function runSetup(options: { force?: boolean; showProgress?: boolean } = {}): Promise<boolean> {
  const { force = false, showProgress = true } = options;

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
  } else {
    logger.warn("Could not verify mlx-audio installation");
  }

  return true;
}
