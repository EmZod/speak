/**
 * Daemon management for Python TTS server
 */

import { spawn, type ChildProcess } from "child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { CHATTER_DIR, SOCKET_PATH, VENV_PYTHON } from "../core/config.ts";
import { isServerRunning, shutdown } from "./client.ts";
import { logger } from "../ui/logger.ts";

/**
 * Path to PID file
 */
const PID_FILE = join(CHATTER_DIR, "speak.pid");

/**
 * Path to Python server script
 */
const SERVER_SCRIPT = join(import.meta.dir, "../python/server.py");

/**
 * Get the PID of running daemon (if any)
 */
export function getDaemonPid(): number | null {
  if (!existsSync(PID_FILE)) {
    return null;
  }

  try {
    const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
    if (isNaN(pid)) return null;

    // Check if process is actually running
    try {
      process.kill(pid, 0);
      return pid;
    } catch {
      // Process not running, clean up stale PID file
      unlinkSync(PID_FILE);
      return null;
    }
  } catch {
    return null;
  }
}

/**
 * Start the Python server as a daemon
 */
export async function startDaemon(): Promise<boolean> {
  // Check if already running
  if (await isServerRunning()) {
    logger.debug("Server already running");
    return true;
  }

  // Check PID file
  const existingPid = getDaemonPid();
  if (existingPid) {
    logger.debug(`Found existing PID ${existingPid}, but server not responding`);
    try {
      process.kill(existingPid, "SIGTERM");
    } catch {
      // Ignore errors killing stale process
    }
  }

  // Clean up stale socket
  if (existsSync(SOCKET_PATH)) {
    unlinkSync(SOCKET_PATH);
  }

  logger.status("Starting TTS server...");

  return new Promise((resolve) => {
    const serverProcess = spawn(VENV_PYTHON, [SERVER_SCRIPT], {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Save PID
    if (serverProcess.pid) {
      writeFileSync(PID_FILE, String(serverProcess.pid));
    }

    let started = false;
    let stdout = "";

    const detachProcess = () => {
      // Remove all listeners so they don't keep the event loop alive
      serverProcess.stdout?.removeAllListeners();
      serverProcess.stderr?.removeAllListeners();
      serverProcess.removeAllListeners();

      // Unref the streams and process so they don't keep event loop alive
      // Note: Don't destroy() the pipes - that sends SIGPIPE to the Python process
      if (serverProcess.stdout && "unref" in serverProcess.stdout) {
        (serverProcess.stdout as any).unref?.();
      }
      if (serverProcess.stderr && "unref" in serverProcess.stderr) {
        (serverProcess.stderr as any).unref?.();
      }
      serverProcess.unref();
    };

    serverProcess.stdout?.on("data", (data) => {
      stdout += data.toString();

      // Check for ready message
      if (stdout.includes('"status": "ready"') && !started) {
        started = true;
        detachProcess();
        logger.success("TTS server started");
        resolve(true);
      }
    });

    serverProcess.stderr?.on("data", (data) => {
      // Log server stderr (debug level)
      const lines = data.toString().split("\n");
      for (const line of lines) {
        if (line.trim()) {
          try {
            const entry = JSON.parse(line);
            logger.debug(`[server] ${entry.message}`);
          } catch {
            logger.debug(`[server] ${line}`);
          }
        }
      }
    });

    serverProcess.on("error", (err) => {
      logger.error(`Failed to start server: ${err.message}`);
      resolve(false);
    });

    serverProcess.on("exit", (code) => {
      if (!started) {
        logger.error(`Server exited with code ${code}`);
        resolve(false);
      }
    });

    // Timeout after 30 seconds
    setTimeout(() => {
      if (!started) {
        logger.error("Server start timeout");
        serverProcess.kill();
        resolve(false);
      }
    }, 30000);
  });
}

/**
 * Stop the daemon
 */
export async function stopDaemon(): Promise<boolean> {
  // Try graceful shutdown first
  try {
    if (await isServerRunning()) {
      logger.status("Sending shutdown command...");
      await shutdown();

      // Wait for server to stop
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 500));
        if (!(await isServerRunning())) {
          logger.success("Server stopped gracefully");
          cleanupPidFile();
          return true;
        }
      }
    }
  } catch {
    // Graceful shutdown failed, try SIGTERM
  }

  // Try SIGTERM
  const pid = getDaemonPid();
  if (pid) {
    logger.status(`Sending SIGTERM to PID ${pid}...`);
    try {
      process.kill(pid, "SIGTERM");

      // Wait for process to exit
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 500));
        try {
          process.kill(pid, 0);
        } catch {
          // Process exited
          logger.success("Server stopped");
          cleanupPidFile();
          return true;
        }
      }

      // Force kill
      logger.warn("Server not responding, sending SIGKILL...");
      process.kill(pid, "SIGKILL");
      cleanupPidFile();
      return true;
    } catch {
      // Process not running
      cleanupPidFile();
      return true;
    }
  }

  logger.info("Server not running");
  cleanupPidFile();
  return true;
}

/**
 * Clean up PID file and socket
 */
function cleanupPidFile(): void {
  if (existsSync(PID_FILE)) {
    unlinkSync(PID_FILE);
  }
  if (existsSync(SOCKET_PATH)) {
    unlinkSync(SOCKET_PATH);
  }
}

/**
 * Ensure daemon is running (start if needed)
 */
export async function ensureDaemon(): Promise<boolean> {
  if (await isServerRunning()) {
    return true;
  }
  return startDaemon();
}
