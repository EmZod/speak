/**
 * Unit tests for bridge/protocol.ts
 *
 * Tests IPC protocol definitions including:
 * - Request/Response type structures
 * - Error response detection
 * - ID generation
 * - Type guards
 */

import { describe, test, expect } from "bun:test";
import { testLog } from "../../helpers/test-utils.ts";
import {
  isErrorResponse,
  generateId,
  type Request,
  type SuccessResponse,
  type ErrorResponse,
  type Response,
  type HealthResult,
  type GenerateParams,
  type GenerateResult,
} from "../../../src/bridge/protocol.ts";

describe("bridge/protocol.ts", () => {
  describe("isErrorResponse", () => {
    test("returns true for error responses", () => {
      testLog.step(1, "Testing error response detection");
      const errorResponse: ErrorResponse = {
        id: "test-123",
        error: {
          code: 1,
          message: "Test error",
        },
      };

      expect(isErrorResponse(errorResponse)).toBe(true);
      testLog.info("Error response correctly identified");
    });

    test("returns false for success responses", () => {
      const successResponse: SuccessResponse<string> = {
        id: "test-456",
        result: "success data",
      };

      expect(isErrorResponse(successResponse)).toBe(false);
    });

    test("handles error response with code 0", () => {
      const errorWithZero: ErrorResponse = {
        id: "test-789",
        error: {
          code: 0,
          message: "Error with zero code",
        },
      };

      expect(isErrorResponse(errorWithZero)).toBe(true);
    });

    test("handles error response with negative code", () => {
      const errorWithNegative: ErrorResponse = {
        id: "test-neg",
        error: {
          code: -32700,
          message: "Parse error",
        },
      };

      expect(isErrorResponse(errorWithNegative)).toBe(true);
    });

    test("handles success response with null result", () => {
      const successWithNull: SuccessResponse<null> = {
        id: "test-null",
        result: null,
      };

      expect(isErrorResponse(successWithNull)).toBe(false);
    });

    test("handles success response with object result", () => {
      const successWithObject: SuccessResponse<HealthResult> = {
        id: "test-obj",
        result: {
          status: "healthy",
          mlx_audio_version: "0.1.0",
          model_loaded: null,
        },
      };

      expect(isErrorResponse(successWithObject)).toBe(false);
    });
  });

  describe("generateId", () => {
    test("generates string IDs", () => {
      testLog.step(1, "Testing ID generation");
      const id = generateId();

      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
      testLog.info(`Generated ID: ${id}`);
    });

    test("generates unique IDs", () => {
      testLog.step(1, "Testing ID uniqueness");
      const ids = new Set<string>();

      for (let i = 0; i < 100; i++) {
        ids.add(generateId());
      }

      expect(ids.size).toBe(100);
      testLog.info("All 100 generated IDs are unique");
    });

    test("ID includes timestamp component", () => {
      const id = generateId();

      // ID format is timestamp-random
      expect(id).toContain("-");
    });

    test("ID format is consistent", () => {
      const id = generateId();
      const parts = id.split("-");

      expect(parts.length).toBe(2);
      // First part should be numeric (timestamp)
      expect(parseInt(parts[0], 10)).not.toBeNaN();
      // Second part should be alphanumeric
      expect(parts[1]).toMatch(/^[a-z0-9]+$/);
    });

    test("IDs are safe for JSON", () => {
      const id = generateId();

      // Should serialize/deserialize cleanly
      const json = JSON.stringify({ id });
      const parsed = JSON.parse(json);

      expect(parsed.id).toBe(id);
    });

    test("timestamp portion increases over time", async () => {
      const id1 = generateId();
      await new Promise((r) => setTimeout(r, 10));
      const id2 = generateId();

      const ts1 = parseInt(id1.split("-")[0], 10);
      const ts2 = parseInt(id2.split("-")[0], 10);

      expect(ts2).toBeGreaterThan(ts1);
    });
  });

  describe("Request type structure", () => {
    test("valid request with params", () => {
      const request: Request = {
        id: generateId(),
        method: "generate",
        params: {
          text: "Hello world",
          model: "test-model",
        },
      };

      expect(request.id).toBeDefined();
      expect(request.method).toBe("generate");
      expect(request.params).toBeDefined();
      expect(request.params!.text).toBe("Hello world");
    });

    test("valid request without params", () => {
      const request: Request = {
        id: generateId(),
        method: "health",
      };

      expect(request.id).toBeDefined();
      expect(request.method).toBe("health");
      expect(request.params).toBeUndefined();
    });

    test("request serializes to valid JSON", () => {
      const request: Request = {
        id: "test-123",
        method: "generate",
        params: { text: "Hello" },
      };

      const json = JSON.stringify(request);
      const parsed = JSON.parse(json);

      expect(parsed.id).toBe("test-123");
      expect(parsed.method).toBe("generate");
      expect(parsed.params.text).toBe("Hello");
    });
  });

  describe("SuccessResponse type structure", () => {
    test("health result response", () => {
      const response: SuccessResponse<HealthResult> = {
        id: "health-req-1",
        result: {
          status: "healthy",
          mlx_audio_version: "0.5.0",
          model_loaded: "chatterbox-turbo-8bit",
        },
      };

      expect(response.id).toBe("health-req-1");
      expect(response.result.status).toBe("healthy");
      expect(response.result.mlx_audio_version).toBe("0.5.0");
      expect(response.result.model_loaded).toBe("chatterbox-turbo-8bit");
    });

    test("generate result response", () => {
      const response: SuccessResponse<GenerateResult> = {
        id: "gen-req-1",
        result: {
          audio_path: "/tmp/speak_123.wav",
          duration: 5.5,
          rtf: 0.35,
          sample_rate: 24000,
        },
      };

      expect(response.result.audio_path).toContain(".wav");
      expect(response.result.duration).toBe(5.5);
      expect(response.result.rtf).toBe(0.35);
      expect(response.result.sample_rate).toBe(24000);
    });

    test("response serializes to valid JSON", () => {
      const response: SuccessResponse<GenerateResult> = {
        id: "test-1",
        result: {
          audio_path: "/tmp/test.wav",
          duration: 1.0,
          rtf: 0.5,
          sample_rate: 22050,
        },
      };

      const json = JSON.stringify(response);
      const parsed = JSON.parse(json);

      expect(parsed.result.audio_path).toBe("/tmp/test.wav");
    });
  });

  describe("ErrorResponse type structure", () => {
    test("basic error response", () => {
      const response: ErrorResponse = {
        id: "error-req-1",
        error: {
          code: 1,
          message: "No text provided",
        },
      };

      expect(response.id).toBe("error-req-1");
      expect(response.error.code).toBe(1);
      expect(response.error.message).toBe("No text provided");
    });

    test("JSON-RPC style error codes", () => {
      const parseError: ErrorResponse = {
        id: "parse-1",
        error: {
          code: -32700,
          message: "Parse error: invalid JSON",
        },
      };

      expect(parseError.error.code).toBe(-32700);
    });

    test("error response serializes correctly", () => {
      const error: ErrorResponse = {
        id: "err-1",
        error: {
          code: 500,
          message: "Internal server error",
        },
      };

      const json = JSON.stringify(error);
      const parsed = JSON.parse(json);

      expect(parsed.error.code).toBe(500);
      expect(parsed.error.message).toBe("Internal server error");
    });
  });

  describe("GenerateParams type structure", () => {
    test("minimal generate params", () => {
      const params: GenerateParams = {
        text: "Hello world",
      };

      expect(params.text).toBe("Hello world");
      expect(params.model).toBeUndefined();
      expect(params.temperature).toBeUndefined();
      expect(params.speed).toBeUndefined();
      expect(params.voice).toBeUndefined();
    });

    test("full generate params", () => {
      const params: GenerateParams = {
        text: "Full params test",
        model: "mlx-community/chatterbox-turbo-fp16",
        temperature: 0.7,
        speed: 1.2,
        voice: "/path/to/voice.wav",
      };

      expect(params.text).toBe("Full params test");
      expect(params.model).toBe("mlx-community/chatterbox-turbo-fp16");
      expect(params.temperature).toBe(0.7);
      expect(params.speed).toBe(1.2);
      expect(params.voice).toBe("/path/to/voice.wav");
    });

    test("params serialize correctly", () => {
      const params: GenerateParams = {
        text: "Serialize test",
        temperature: 0.5,
      };

      const json = JSON.stringify(params);
      const parsed = JSON.parse(json);

      expect(parsed.text).toBe("Serialize test");
      expect(parsed.temperature).toBe(0.5);
    });
  });

  describe("HealthResult type structure", () => {
    test("healthy with model loaded", () => {
      const result: HealthResult = {
        status: "healthy",
        mlx_audio_version: "0.1.5",
        model_loaded: "chatterbox-turbo-8bit",
      };

      expect(result.status).toBe("healthy");
      expect(result.model_loaded).toBe("chatterbox-turbo-8bit");
    });

    test("healthy without model loaded", () => {
      const result: HealthResult = {
        status: "healthy",
        mlx_audio_version: "0.1.5",
        model_loaded: null,
      };

      expect(result.status).toBe("healthy");
      expect(result.model_loaded).toBeNull();
    });
  });

  describe("Response union type", () => {
    test("can hold success response", () => {
      const response: Response<string> = {
        id: "test",
        result: "success",
      };

      if (!isErrorResponse(response)) {
        expect(response.result).toBe("success");
      }
    });

    test("can hold error response", () => {
      const response: Response<string> = {
        id: "test",
        error: {
          code: 1,
          message: "error",
        },
      };

      if (isErrorResponse(response)) {
        expect(response.error.message).toBe("error");
      }
    });

    test("type narrowing works correctly", () => {
      testLog.step(1, "Testing type narrowing");
      const successResponse: Response<number> = {
        id: "num",
        result: 42,
      };

      const errorResponse: Response<number> = {
        id: "err",
        error: { code: 1, message: "err" },
      };

      if (isErrorResponse(successResponse)) {
        // This branch should not be reached
        expect(true).toBe(false);
      } else {
        expect(successResponse.result).toBe(42);
      }

      if (isErrorResponse(errorResponse)) {
        expect(errorResponse.error.code).toBe(1);
      } else {
        // This branch should not be reached
        expect(true).toBe(false);
      }

      testLog.info("Type narrowing works as expected");
    });
  });

  describe("protocol compliance", () => {
    test("request and response IDs should match", () => {
      testLog.step(1, "Testing ID matching in request/response cycle");
      const requestId = generateId();

      const request: Request = {
        id: requestId,
        method: "health",
      };

      const response: SuccessResponse<HealthResult> = {
        id: requestId,
        result: {
          status: "healthy",
          mlx_audio_version: "0.1.0",
          model_loaded: null,
        },
      };

      expect(request.id).toBe(response.id);
      testLog.info("Request/response ID matching verified");
    });

    test("JSON Lines format (newline-delimited JSON)", () => {
      testLog.step(1, "Testing JSON Lines format");
      const request: Request = {
        id: "line-1",
        method: "generate",
        params: { text: "Test" },
      };

      // JSON Lines format: each message is on a single line
      const requestLine = JSON.stringify(request);

      // Should not contain newlines in the JSON itself
      expect(requestLine).not.toContain("\n");

      // Can be parsed back
      const parsed = JSON.parse(requestLine);
      expect(parsed.id).toBe("line-1");

      testLog.info("JSON Lines format verified");
    });
  });
});
