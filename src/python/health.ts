/**
 * Health check utilities for Python environment
 */

import { spawn } from "child_process";
import { VENV_PYTHON, isVenvValid, getPackageVersions, REQUIRED_PACKAGES } from "./setup.ts";
import { logger } from "../ui/logger.ts";

/**
 * Health check result
 */
export interface HealthCheckResult {
  healthy: boolean;
  venvExists: boolean;
  pythonWorks: boolean;
  mlxAudioImports: boolean;
  mlxAudioVersion?: string;
  missingPackages: string[];
  errors: string[];
}

/**
 * Run Python code and return result
 */
async function runPython(code: string): Promise<{ success: boolean; output: string; error: string }> {
  return new Promise((resolve) => {
    const proc = spawn(VENV_PYTHON, ["-c", code]);
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => (stdout += data.toString()));
    proc.stderr.on("data", (data) => (stderr += data.toString()));

    proc.on("close", (exitCode) => {
      resolve({
        success: exitCode === 0,
        output: stdout.trim(),
        error: stderr.trim(),
      });
    });

    proc.on("error", () => {
      resolve({ success: false, output: "", error: "Failed to run Python" });
    });
  });
}

/**
 * Run comprehensive health check
 */
export async function runHealthCheck(): Promise<HealthCheckResult> {
  const result: HealthCheckResult = {
    healthy: false,
    venvExists: false,
    pythonWorks: false,
    mlxAudioImports: false,
    missingPackages: [],
    errors: [],
  };

  // Check venv exists
  result.venvExists = isVenvValid();
  if (!result.venvExists) {
    result.errors.push("Virtual environment not found at ~/.chatter/env/");
    return result;
  }

  // Check Python works
  const pythonCheck = await runPython('print("ok")');
  result.pythonWorks = pythonCheck.success && pythonCheck.output === "ok";
  if (!result.pythonWorks) {
    result.errors.push("Python is not working: " + pythonCheck.error);
    return result;
  }

  // Check mlx-audio imports
  const mlxCheck = await runPython(`
import mlx_audio.tts
from importlib.metadata import version
print(version('mlx-audio'))
`);
  result.mlxAudioImports = mlxCheck.success;
  if (mlxCheck.success) {
    result.mlxAudioVersion = mlxCheck.output;
  } else {
    result.errors.push("Failed to import mlx_audio: " + mlxCheck.error);
  }

  // Check for missing packages
  const versions = await getPackageVersions();
  for (const pkg of REQUIRED_PACKAGES) {
    const normalizedName = pkg.toLowerCase().replace(/-/g, "_");
    const altName = pkg.toLowerCase();
    if (!versions[normalizedName] && !versions[altName]) {
      result.missingPackages.push(pkg);
    }
  }

  if (result.missingPackages.length > 0) {
    result.errors.push("Missing packages: " + result.missingPackages.join(", "));
  }

  // Overall health
  result.healthy =
    result.venvExists &&
    result.pythonWorks &&
    result.mlxAudioImports &&
    result.missingPackages.length === 0;

  return result;
}

/**
 * Print health check status
 */
export async function printHealthStatus(): Promise<boolean> {
  logger.status("Running health check...");
  const health = await runHealthCheck();

  if (health.healthy) {
    logger.success("Python environment is healthy");
    logger.info(`  mlx-audio version: ${health.mlxAudioVersion}`);
    return true;
  }

  logger.error("Python environment has issues:");
  for (const error of health.errors) {
    logger.error("  - " + error);
  }

  if (!health.venvExists) {
    logger.info("Run 'speak setup' to create the Python environment");
  } else if (health.missingPackages.length > 0) {
    logger.info("Run 'speak setup --force' to reinstall packages");
  }

  return false;
}
