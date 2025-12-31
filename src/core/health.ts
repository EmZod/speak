/**
 * Comprehensive health check system for speak CLI
 *
 * Aggregates health status from multiple subsystems to answer
 * "how do you know it's broken?"
 */

import { existsSync, statSync } from "fs";
import { execSync } from "child_process";
import { CHATTER_DIR, SOCKET_PATH, VENV_PYTHON } from "./config.ts";
import { isKillswitchEngaged, getKillswitchData, KILLSWITCH_FILE } from "./killswitch.ts";
import { isServerRunning, checkHealth as checkServerHealth } from "../bridge/client.ts";
import { logger } from "../ui/logger.ts";

/**
 * Individual health check result
 */
export interface HealthCheck {
  name: string;
  status: "pass" | "fail" | "warn";
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Overall health report
 */
export interface HealthReport {
  overall: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  checks: HealthCheck[];
  summary: string;
}

/**
 * Run all health checks and return aggregated report
 */
export async function runHealthChecks(): Promise<HealthReport> {
  const checks: HealthCheck[] = [];

  // Check 1: Python environment
  checks.push(await checkPythonEnvironment());

  // Check 2: Disk space
  checks.push(await checkDiskSpace());

  // Check 3: Socket accessibility
  checks.push(checkSocket());

  // Check 4: Server health (if running)
  checks.push(await checkServer());

  // Check 5: Audio device
  checks.push(await checkAudioDevice());

  // Check 6: Killswitch status
  checks.push(checkKillswitchStatus());

  // Determine overall status
  const failCount = checks.filter((c) => c.status === "fail").length;
  const warnCount = checks.filter((c) => c.status === "warn").length;

  let overall: "healthy" | "degraded" | "unhealthy";
  if (failCount > 0) {
    overall = "unhealthy";
  } else if (warnCount > 0) {
    overall = "degraded";
  } else {
    overall = "healthy";
  }

  const summary =
    checks
      .filter((c) => c.status !== "pass")
      .map((c) => c.message)
      .join("; ") || "All systems operational";

  return {
    overall,
    timestamp: new Date().toISOString(),
    checks,
    summary,
  };
}

/**
 * Check Python environment validity
 */
async function checkPythonEnvironment(): Promise<HealthCheck> {
  if (!existsSync(VENV_PYTHON)) {
    return {
      name: "python_environment",
      status: "fail",
      message: "Python environment not found. Run: speak setup",
    };
  }

  // Verify Python actually works
  try {
    execSync(`"${VENV_PYTHON}" -c "import mlx_audio"`, { timeout: 10000 });
    return {
      name: "python_environment",
      status: "pass",
      message: "Python environment is valid",
    };
  } catch (error) {
    return {
      name: "python_environment",
      status: "fail",
      message: "Python environment is broken. Run: speak setup --force",
      details: { error: String(error) },
    };
  }
}

/**
 * Check available disk space
 */
async function checkDiskSpace(): Promise<HealthCheck> {
  try {
    const output = execSync(`df -m "${CHATTER_DIR}" | tail -1 | awk '{print $4}'`, {
      timeout: 5000,
    });
    const freeMB = parseInt(output.toString().trim(), 10);

    if (isNaN(freeMB)) {
      return {
        name: "disk_space",
        status: "warn",
        message: "Could not determine free disk space",
      };
    }

    if (freeMB < 100) {
      return {
        name: "disk_space",
        status: "fail",
        message: `Critical: Only ${freeMB}MB free disk space`,
        details: { free_mb: freeMB },
      };
    } else if (freeMB < 500) {
      return {
        name: "disk_space",
        status: "warn",
        message: `Low disk space: ${freeMB}MB free`,
        details: { free_mb: freeMB },
      };
    }

    return {
      name: "disk_space",
      status: "pass",
      message: `${freeMB}MB free disk space`,
      details: { free_mb: freeMB },
    };
  } catch {
    return {
      name: "disk_space",
      status: "warn",
      message: "Could not check disk space",
    };
  }
}

/**
 * Check socket file status
 */
function checkSocket(): HealthCheck {
  if (!existsSync(SOCKET_PATH)) {
    return {
      name: "socket",
      status: "pass",
      message: "Socket not present (server not running)",
    };
  }

  // Check if socket is stale
  try {
    const stat = statSync(SOCKET_PATH);
    const ageMs = Date.now() - stat.mtimeMs;
    const ageHours = ageMs / (1000 * 60 * 60);

    if (ageHours > 24) {
      return {
        name: "socket",
        status: "warn",
        message: "Socket file is stale (>24h old)",
        details: { age_hours: parseFloat(ageHours.toFixed(1)) },
      };
    }

    return {
      name: "socket",
      status: "pass",
      message: "Socket file present",
    };
  } catch {
    return {
      name: "socket",
      status: "warn",
      message: "Could not check socket file status",
    };
  }
}

/**
 * Check server status
 */
async function checkServer(): Promise<HealthCheck> {
  try {
    const running = await isServerRunning();
    if (!running) {
      return {
        name: "server",
        status: "pass",
        message: "Server not running (will start on demand)",
      };
    }

    const health = await checkServerHealth();
    return {
      name: "server",
      status: "pass",
      message: `Server running, model: ${health.model_loaded || "none"}`,
      details: {
        status: health.status,
        mlx_audio_version: health.mlx_audio_version,
        model_loaded: health.model_loaded,
      },
    };
  } catch (error) {
    return {
      name: "server",
      status: "warn",
      message: "Server health check failed",
      details: { error: String(error) },
    };
  }
}

/**
 * Check audio playback availability
 */
async function checkAudioDevice(): Promise<HealthCheck> {
  try {
    // Check if afplay exists (macOS)
    execSync("which afplay", { timeout: 1000 });
    return {
      name: "audio_device",
      status: "pass",
      message: "Audio playback available (afplay)",
    };
  } catch {
    // afplay not found - this is expected on non-macOS
    try {
      // Try aplay (Linux)
      execSync("which aplay", { timeout: 1000 });
      return {
        name: "audio_device",
        status: "pass",
        message: "Audio playback available (aplay)",
      };
    } catch {
      return {
        name: "audio_device",
        status: "warn",
        message: "Audio playback tool not found (afplay/aplay)",
      };
    }
  }
}

/**
 * Check killswitch status
 */
function checkKillswitchStatus(): HealthCheck {
  if (isKillswitchEngaged()) {
    const data = getKillswitchData();
    return {
      name: "killswitch",
      status: "warn",
      message: "Killswitch is engaged - operations disabled",
      details: {
        engaged_at: data?.engaged_at,
        reason: data?.reason,
        file: KILLSWITCH_FILE,
      },
    };
  }
  return {
    name: "killswitch",
    status: "pass",
    message: "Killswitch not engaged",
  };
}
