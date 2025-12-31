/**
 * IPC client for communicating with Python TTS server
 */

import { connect } from "net";
import { SOCKET_PATH } from "../core/config.ts";
import {
  type Request,
  type Response,
  type GenerateParams,
  type GenerateResult,
  type HealthResult,
  type ListModelsResult,
  type ShutdownResult,
  isErrorResponse,
  generateId,
} from "./protocol.ts";
import { logger } from "../ui/logger.ts";

/**
 * Default timeout for requests (5 minutes for TTS generation)
 * Can be overridden per-request via timeoutMs parameter.
 */
const DEFAULT_TIMEOUT = 5 * 60 * 1000;

/**
 * Connection timeout (5 seconds)
 */
const CONNECT_TIMEOUT = 5000;

/**
 * Send a request to the server and wait for response
 */
export async function sendRequest<T>(
  method: string,
  params?: Record<string, unknown>,
  timeout: number = DEFAULT_TIMEOUT
): Promise<T> {
  const requestId = generateId();
  const request: Request = { id: requestId, method, params };

  return new Promise((resolve, reject) => {
    let responseBuffer = "";
    let timeoutId: Timer | null = null;
    let connectTimeoutId: Timer | null = null;

    const socket = connect({ path: SOCKET_PATH });

    // Connection timeout
    connectTimeoutId = setTimeout(() => {
      socket.destroy();
      reject(new Error("Connection timeout - server not running?"));
    }, CONNECT_TIMEOUT);

    socket.on("connect", () => {
      if (connectTimeoutId) clearTimeout(connectTimeoutId);

      // Request timeout
      timeoutId = setTimeout(() => {
        socket.destroy();
        reject(new Error(`Request timeout after ${timeout}ms`));
      }, timeout);

      // Send request
      const requestLine = JSON.stringify(request) + "\n";
      socket.write(requestLine);
    });

    socket.on("data", (data) => {
      responseBuffer += data.toString();

      // Check for complete response (ends with newline)
      if (responseBuffer.includes("\n")) {
        const lines = responseBuffer.split("\n");
        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const response = JSON.parse(line) as Response<T>;

            // Check if this is our response
            if (response.id === requestId) {
              if (timeoutId) clearTimeout(timeoutId);
              socket.end();

              if (isErrorResponse(response)) {
                reject(new Error(response.error.message));
              } else {
                resolve(response.result);
              }
              return;
            }
          } catch (e) {
            // Ignore parse errors for incomplete lines
          }
        }
      }
    });

    socket.on("error", (err) => {
      if (connectTimeoutId) clearTimeout(connectTimeoutId);
      if (timeoutId) clearTimeout(timeoutId);

      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error("Server not running - socket not found"));
      } else if ((err as NodeJS.ErrnoException).code === "ECONNREFUSED") {
        reject(new Error("Server not running - connection refused"));
      } else {
        reject(err);
      }
    });

    socket.on("close", (hadError) => {
      if (timeoutId) clearTimeout(timeoutId);
      if (hadError) {
        reject(new Error("Socket closed with error"));
      }
    });
  });
}

/**
 * Check if server is healthy
 */
export async function checkHealth(): Promise<HealthResult> {
  return sendRequest<HealthResult>("health", {}, 5000);
}

/**
 * List available models
 */
export async function listModels(): Promise<ListModelsResult> {
  return sendRequest<ListModelsResult>("list-models", {}, 5000);
}

/**
 * Progress callback for generation
 */
export interface GenerateProgressCallback {
  (progress: {
    chunk: number;
    totalChunks: number;
    charsDone: number;
    charsTotal: number;
  }): void;
}

/**
 * Status callback for generation phases
 */
export interface GenerateStatusCallback {
  (status: {
    phase: "loading_model" | "model_loaded" | "generating";
    model?: string;
    loadTimeMs?: number;
  }): void;
}

/**
 * Generate TTS audio with optional progress and status callbacks
 * 
 * @param params - Generation parameters
 * @param timeoutMs - Timeout in milliseconds (default: 5 minutes, 0 = no timeout)
 * @param onProgress - Optional callback for progress updates
 * @param onStatus - Optional callback for status updates
 */
export async function generate(
  params: GenerateParams,
  timeoutMs?: number,
  onProgress?: GenerateProgressCallback,
  onStatus?: GenerateStatusCallback
): Promise<GenerateResult> {
  const timeout = timeoutMs === 0 ? 24 * 60 * 60 * 1000 : (timeoutMs ?? DEFAULT_TIMEOUT);
  const requestId = generateId();
  const request: Request = { id: requestId, method: "generate", params: { ...params } };

  return new Promise((resolve, reject) => {
    let responseBuffer = "";
    let timeoutId: Timer | null = null;
    let connectTimeoutId: Timer | null = null;

    const socket = connect({ path: SOCKET_PATH });

    // Connection timeout
    connectTimeoutId = setTimeout(() => {
      socket.destroy();
      reject(new Error("Connection timeout - server not running?"));
    }, CONNECT_TIMEOUT);

    socket.on("connect", () => {
      if (connectTimeoutId) clearTimeout(connectTimeoutId);

      // Request timeout
      timeoutId = setTimeout(() => {
        socket.destroy();
        reject(new Error(`Request timeout after ${timeout}ms`));
      }, timeout);

      // Send request
      const requestLine = JSON.stringify(request) + "\n";
      socket.write(requestLine);
    });

    socket.on("data", (data) => {
      responseBuffer += data.toString();

      // Process complete lines
      while (responseBuffer.includes("\n")) {
        const newlineIndex = responseBuffer.indexOf("\n");
        const line = responseBuffer.slice(0, newlineIndex).trim();
        responseBuffer = responseBuffer.slice(newlineIndex + 1);

        if (!line) continue;

        try {
          const message = JSON.parse(line);

          // Check if this is our response
          if (message.id !== requestId) continue;

          // Handle status events
          if (message.status && onStatus) {
            onStatus({
              phase: message.status.phase,
              model: message.status.model,
              loadTimeMs: message.status.load_time_ms,
            });
            continue;
          }

          // Handle progress events
          if (message.progress && onProgress) {
            onProgress({
              chunk: message.progress.chunk,
              totalChunks: message.progress.total_chunks,
              charsDone: message.progress.chars_done,
              charsTotal: message.progress.chars_total,
            });
            continue;
          }

          // Handle error
          if (message.error) {
            if (timeoutId) clearTimeout(timeoutId);
            socket.destroy();
            reject(new Error(message.error.message));
            return;
          }

          // Handle result
          if (message.result) {
            if (timeoutId) clearTimeout(timeoutId);
            socket.destroy();
            resolve(message.result as GenerateResult);
            return;
          }
        } catch (e) {
          // Ignore parse errors for incomplete lines
        }
      }
    });

    socket.on("error", (err) => {
      if (connectTimeoutId) clearTimeout(connectTimeoutId);
      if (timeoutId) clearTimeout(timeoutId);

      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error("Server not running - socket not found"));
      } else if ((err as NodeJS.ErrnoException).code === "ECONNREFUSED") {
        reject(new Error("Server not running - connection refused"));
      } else {
        reject(err);
      }
    });

    socket.on("close", (hadError) => {
      if (timeoutId) clearTimeout(timeoutId);
      if (hadError) {
        reject(new Error("Socket closed with error"));
      }
    });
  });
}

/**
 * Streaming chunk response
 */
export interface StreamChunk {
  id: string;
  chunk: number;
  audio_path: string;
  duration: number;
  sample_rate: number;
}

/**
 * Streaming completion response
 */
export interface StreamComplete {
  id: string;
  complete: true;
  total_chunks: number;
  total_duration: number;
  rtf: number;
}

/**
 * Generate TTS audio with streaming - calls onChunk for each audio chunk
 */
export async function generateStream(
  params: GenerateParams & { streaming_interval?: number },
  onChunk: (chunk: StreamChunk) => Promise<void>
): Promise<StreamComplete> {
  const requestId = generateId();
  const request: Request = {
    id: requestId,
    method: "generate",
    params: { ...params, stream: true },
  };

  return new Promise((resolve, reject) => {
    let responseBuffer = "";
    let timeoutId: Timer | null = null;
    let connectTimeoutId: Timer | null = null;
    let completed = false; // Track if we received the complete message
    // Longer timeout for streaming (10 minutes)
    const timeout = 10 * 60 * 1000;

    const socket = connect({ path: SOCKET_PATH });

    connectTimeoutId = setTimeout(() => {
      socket.destroy();
      reject(new Error("Connection timeout - server not running?"));
    }, CONNECT_TIMEOUT);

    socket.on("connect", () => {
      if (connectTimeoutId) clearTimeout(connectTimeoutId);

      timeoutId = setTimeout(() => {
        socket.destroy();
        reject(new Error(`Streaming timeout after ${timeout}ms`));
      }, timeout);

      const requestLine = JSON.stringify(request) + "\n";
      socket.write(requestLine);
    });

    socket.on("data", async (data) => {
      responseBuffer += data.toString();

      // Process all complete lines
      while (responseBuffer.includes("\n")) {
        const newlineIndex = responseBuffer.indexOf("\n");
        const line = responseBuffer.slice(0, newlineIndex).trim();
        responseBuffer = responseBuffer.slice(newlineIndex + 1);

        if (!line) continue;

        try {
          const response = JSON.parse(line);

          if (response.id !== requestId) continue;

          // Check for error
          if (response.error) {
            if (timeoutId) clearTimeout(timeoutId);
            socket.end();
            reject(new Error(response.error.message));
            return;
          }

          // Check for chunk
          if (response.chunk !== undefined) {
            // Reset timeout on each chunk
            if (timeoutId) clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
              socket.destroy();
              reject(new Error("Streaming timeout between chunks"));
            }, 60000); // 1 minute between chunks

            await onChunk(response as StreamChunk);
          }

          // Check for completion
          if (response.complete) {
            completed = true;
            if (timeoutId) clearTimeout(timeoutId);
            socket.end();
            resolve(response as StreamComplete);
            return;
          }
        } catch (e) {
          // Ignore parse errors for incomplete data
        }
      }
    });

    socket.on("error", (err) => {
      if (connectTimeoutId) clearTimeout(connectTimeoutId);
      if (timeoutId) clearTimeout(timeoutId);

      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error("Server not running - socket not found"));
      } else if ((err as NodeJS.ErrnoException).code === "ECONNREFUSED") {
        reject(new Error("Server not running - connection refused"));
      } else {
        reject(err);
      }
    });

    socket.on("close", (hadError) => {
      if (timeoutId) clearTimeout(timeoutId);
      // If socket closes before we got a complete message, reject to prevent hanging
      if (!completed) {
        reject(new Error(hadError
          ? "Socket closed with error before streaming completed"
          : "Socket closed before receiving completion message"));
      }
    });
  });
}

/**
 * Shutdown the server
 */
export async function shutdown(): Promise<ShutdownResult> {
  return sendRequest<ShutdownResult>("shutdown", {}, 5000);
}

/**
 * Check if server is running
 */
export async function isServerRunning(): Promise<boolean> {
  try {
    await checkHealth();
    return true;
  } catch {
    return false;
  }
}
