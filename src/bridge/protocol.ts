/**
 * Protocol definitions for IPC with Python server
 */

/**
 * Request message format
 */
export interface Request {
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * Successful response
 */
export interface SuccessResponse<T = unknown> {
  id: string;
  result: T;
}

/**
 * Error response
 */
export interface ErrorResponse {
  id: string;
  error: {
    code: number;
    message: string;
  };
}

/**
 * Any response
 */
export type Response<T = unknown> = SuccessResponse<T> | ErrorResponse;

/**
 * Check if response is an error
 */
export function isErrorResponse(response: Response): response is ErrorResponse {
  return "error" in response;
}

/**
 * Health check result
 */
export interface HealthResult {
  status: string;
  mlx_audio_version: string;
  model_loaded: string | null;
}

/**
 * Model info
 */
export interface ModelInfo {
  name: string;
  description: string;
}

/**
 * List models result
 */
export interface ListModelsResult {
  models: ModelInfo[];
}

/**
 * Generate params
 */
export interface GenerateParams {
  text: string;
  model?: string;
  temperature?: number;
  speed?: number;
  voice?: string;
}

/**
 * Progress event during generation
 */
export interface GenerateProgress {
  chunk: number;
  total_chunks: number;
  chars_done: number;
  chars_total: number;
}

/**
 * Generate result
 */
export interface GenerateResult {
  audio_path: string;
  duration: number;
  rtf: number;
  sample_rate: number;
  /** Whether generation completed fully */
  complete?: boolean;
  /** Number of text chunks that were generated */
  chunks_generated?: number;
  /** Total number of text chunks planned */
  chunks_total?: number;
  /** Reason for partial completion (if not complete) */
  reason?: string;
}

/**
 * Shutdown result
 */
export interface ShutdownResult {
  status: string;
}

/**
 * Generate a unique request ID
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
