/**
 * Killswitch system for emergency operation disabling
 *
 * Every automated operation must check the killswitch before proceeding.
 * When engaged, operations fail fast with a clear error message.
 *
 * Usage:
 *   checkKillswitch('generate');  // throws if engaged
 *   engageKillswitch('Model OOM detected');  // emergency stop
 *   disengageKillswitch();  // re-enable operations
 */

import { existsSync, writeFileSync, unlinkSync, readFileSync } from "fs";
import { join } from "path";
import { CHATTER_DIR } from "./config.ts";

/**
 * Path to killswitch file
 */
export const KILLSWITCH_FILE = join(CHATTER_DIR, ".killswitch");

/**
 * Killswitch file contents
 */
export interface KillswitchData {
  engaged_at: string;
  reason: string;
}

/**
 * Check if the killswitch is engaged
 */
export function isKillswitchEngaged(): boolean {
  return existsSync(KILLSWITCH_FILE);
}

/**
 * Read killswitch data if engaged
 */
export function getKillswitchData(): KillswitchData | null {
  if (!isKillswitchEngaged()) {
    return null;
  }

  try {
    const content = readFileSync(KILLSWITCH_FILE, "utf-8");
    return JSON.parse(content) as KillswitchData;
  } catch {
    // If file is malformed, treat as engaged with unknown reason
    return {
      engaged_at: "unknown",
      reason: "Killswitch file exists but could not be parsed",
    };
  }
}

/**
 * Check killswitch and throw if engaged.
 * Call this at the entry to every operation.
 *
 * @param operation - Name of the operation being attempted
 * @throws Error if killswitch is engaged
 */
export function checkKillswitch(operation: string): void {
  if (isKillswitchEngaged()) {
    const data = getKillswitchData();
    const reason = data?.reason ?? "unknown";
    throw new Error(
      `Operation "${operation}" is disabled by killswitch. ` +
      `Reason: ${reason}. ` +
      `Remove ${KILLSWITCH_FILE} to re-enable.`
    );
  }
}

/**
 * Engage the killswitch (for emergency stops)
 *
 * @param reason - Why the killswitch was engaged
 */
export function engageKillswitch(reason: string): void {
  const data: KillswitchData = {
    engaged_at: new Date().toISOString(),
    reason,
  };
  writeFileSync(KILLSWITCH_FILE, JSON.stringify(data, null, 2));
}

/**
 * Disengage the killswitch
 */
export function disengageKillswitch(): void {
  if (existsSync(KILLSWITCH_FILE)) {
    unlinkSync(KILLSWITCH_FILE);
  }
}
