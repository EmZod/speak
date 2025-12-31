/**
 * Binary protocol reader for streaming audio from Python server.
 *
 * Protocol specification:
 * - All integers are little-endian
 * - Magic: "SPKR" (4 bytes)
 *
 * CHUNK MESSAGE:
 *   [magic:4][id:4][count:4][rate:4][samples:float32[]]
 *
 * END MESSAGE:
 *   [magic:4][0xFFFFFFFF:4][totalChunks:4][0:4]
 *
 * ERROR MESSAGE:
 *   [magic:4][0xFFFFFFFE:4][msgLen:4][0:4][message:utf8]
 */

import { Socket } from "net";
import { logger, logDecision } from "../ui/logger.ts";

const MAGIC = Buffer.from("SPKR");
const HEADER_SIZE = 16;
const END_MARKER = 0xffffffff;
const ERROR_MARKER = 0xfffffffe;

export interface AudioChunk {
  type: "chunk";
  id: number;
  samples: Float32Array;
  sampleRate: number;
}

export interface StreamEnd {
  type: "end";
  totalChunks: number;
}

export interface StreamError {
  type: "error";
  message: string;
}

export type StreamMessage = AudioChunk | StreamEnd | StreamError;

/**
 * Async generator that reads binary audio stream from socket.
 * Yields AudioChunk, StreamEnd, or StreamError messages.
 */
export async function* readBinaryStream(socket: Socket): AsyncGenerator<StreamMessage> {
  let buffer = Buffer.alloc(0);

  /**
   * Read exactly N bytes from socket, buffering as needed.
   * 
   * IMPORTANT: We must copy all buffers because Bun may reuse them
   * after the data event callback returns.
   */
  async function readExact(n: number): Promise<Buffer> {
    while (buffer.length < n) {
      const chunk = await new Promise<Buffer | null>((resolve, reject) => {
        const onData = (data: Buffer) => {
          cleanup();
          // MUST copy immediately - Bun/Node may reuse the buffer
          resolve(Buffer.from(data));
        };
        const onError = (err: Error) => {
          cleanup();
          reject(err);
        };
        const onClose = () => {
          cleanup();
          resolve(null);
        };
        const cleanup = () => {
          socket.off("data", onData);
          socket.off("error", onError);
          socket.off("close", onClose);
        };

        socket.once("data", onData);
        socket.once("error", onError);
        socket.once("close", onClose);
      });

      if (chunk === null) {
        throw new Error("Socket closed before receiving complete message");
      }

      // Allocate new buffer and copy both old and new data
      const newBuffer = Buffer.alloc(buffer.length + chunk.length);
      buffer.copy(newBuffer, 0);
      chunk.copy(newBuffer, buffer.length);
      buffer = newBuffer;
    }

    // Copy requested bytes to new buffer (don't return a view)
    const result = Buffer.alloc(n);
    buffer.copy(result, 0, 0, n);
    
    // Copy remaining bytes to new buffer
    const remaining = Buffer.alloc(buffer.length - n);
    buffer.copy(remaining, 0, n);
    buffer = remaining;
    
    return result;
  }

  try {
    while (true) {
      // Read header
      const header = await readExact(HEADER_SIZE);

      // Validate magic
      if (!header.subarray(0, 4).equals(MAGIC)) {
        throw new Error(`Invalid protocol magic: ${header.subarray(0, 4).toString("hex")}`);
      }

      const id = header.readUInt32LE(4);
      const count = header.readUInt32LE(8);
      const rate = header.readUInt32LE(12);

      // Check for end marker
      if (id === END_MARKER) {
        logDecision("Received stream end marker", "Generation complete", { total_chunks: count });
        yield { type: "end", totalChunks: count };
        return;
      }

      // Check for error marker
      if (id === ERROR_MARKER) {
        const msgBytes = await readExact(count);
        const message = msgBytes.toString("utf-8");
        logger.error("Received stream error", { message });
        yield { type: "error", message };
        return;
      }

      // Read samples
      const sampleBytes = await readExact(count * 4);

      // Create Float32Array by parsing bytes
      const samples = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        samples[i] = sampleBytes.readFloatLE(i * 4);
      }

      logger.debug("Received audio chunk", {
        chunk_id: id,
        samples: count,
        sample_rate: rate,
        duration_seconds: count / rate,
      });

      yield {
        type: "chunk",
        id,
        samples,
        sampleRate: rate,
      };
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("Socket closed")) {
      // Connection closed unexpectedly
      logger.error("Socket closed during stream", {
        buffered_bytes: buffer.length,
      });
    }
    throw error;
  }
}

/**
 * Parse a single message from a buffer (for testing).
 * Returns the message and remaining buffer, or null if incomplete.
 */
export function parseMessage(
  buffer: Buffer
): { message: StreamMessage; remaining: Buffer } | null {
  // Need at least header
  if (buffer.length < HEADER_SIZE) {
    return null;
  }

  // Validate magic
  if (!buffer.subarray(0, 4).equals(MAGIC)) {
    throw new Error(`Invalid protocol magic: ${buffer.subarray(0, 4).toString("hex")}`);
  }

  const id = buffer.readUInt32LE(4);
  const count = buffer.readUInt32LE(8);
  const rate = buffer.readUInt32LE(12);

  // End marker
  if (id === END_MARKER) {
    return {
      message: { type: "end", totalChunks: count },
      remaining: buffer.subarray(HEADER_SIZE),
    };
  }

  // Error marker
  if (id === ERROR_MARKER) {
    const totalSize = HEADER_SIZE + count;
    if (buffer.length < totalSize) {
      return null; // Need more data
    }
    const message = buffer.subarray(HEADER_SIZE, totalSize).toString("utf-8");
    return {
      message: { type: "error", message },
      remaining: buffer.subarray(totalSize),
    };
  }

  // Audio chunk
  const totalSize = HEADER_SIZE + count * 4;
  if (buffer.length < totalSize) {
    return null; // Need more data
  }

  const samples = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    samples[i] = buffer.readFloatLE(HEADER_SIZE + i * 4);
  }

  return {
    message: { type: "chunk", id, samples, sampleRate: rate },
    remaining: buffer.subarray(totalSize),
  };
}

/**
 * Build a chunk message (for testing).
 */
export function buildChunkMessage(
  id: number,
  samples: Float32Array,
  sampleRate: number = 24000
): Buffer {
  const header = Buffer.alloc(HEADER_SIZE);
  MAGIC.copy(header, 0);
  header.writeUInt32LE(id, 4);
  header.writeUInt32LE(samples.length, 8);
  header.writeUInt32LE(sampleRate, 12);

  const sampleBuffer = Buffer.alloc(samples.length * 4);
  for (let i = 0; i < samples.length; i++) {
    sampleBuffer.writeFloatLE(samples[i]!, i * 4);
  }

  return Buffer.concat([header, sampleBuffer]);
}

/**
 * Build an end message (for testing).
 */
export function buildEndMessage(totalChunks: number): Buffer {
  const header = Buffer.alloc(HEADER_SIZE);
  MAGIC.copy(header, 0);
  header.writeUInt32LE(END_MARKER, 4);
  header.writeUInt32LE(totalChunks, 8);
  header.writeUInt32LE(0, 12);
  return header;
}

/**
 * Build an error message (for testing).
 */
export function buildErrorMessage(message: string): Buffer {
  const msgBytes = Buffer.from(message, "utf-8");
  const header = Buffer.alloc(HEADER_SIZE);
  MAGIC.copy(header, 0);
  header.writeUInt32LE(ERROR_MARKER, 4);
  header.writeUInt32LE(msgBytes.length, 8);
  header.writeUInt32LE(0, 12);
  return Buffer.concat([header, msgBytes]);
}
