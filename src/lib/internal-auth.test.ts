/**
 * Unit tests for validateInternalApiKey utility.
 *
 * Tests all combinations:
 * - INTERNAL_API_KEY set + matching header → valid
 * - INTERNAL_API_KEY set + wrong/missing header → 401
 * - INTERNAL_API_KEY unset + NODE_ENV=development → valid (dev bypass)
 * - INTERNAL_API_KEY unset + NODE_ENV=production → 500 (fail-closed)
 *
 * Validates: Requirements 2.3
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { validateInternalApiKey } from "./internal-auth";
import { NextRequest } from "next/server";

function setNodeEnv(value: string) {
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
}

function makeRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost:3000/api/v1/upsert-order", {
    method: "POST",
    headers,
  });
}

describe("validateInternalApiKey", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("when INTERNAL_API_KEY is set", () => {
    it("returns valid when x-api-key matches", () => {
      process.env.INTERNAL_API_KEY = "test-secret-key";
      const req = makeRequest({ "x-api-key": "test-secret-key" });
      const result = validateInternalApiKey(req);
      expect(result).toEqual({ valid: true });
    });

    it("returns 401 when x-api-key does not match", () => {
      process.env.INTERNAL_API_KEY = "test-secret-key";
      const req = makeRequest({ "x-api-key": "wrong-key" });
      const result = validateInternalApiKey(req);
      expect(result).toEqual({
        valid: false,
        error: "Unauthorized",
        statusCode: 401,
      });
    });

    it("returns 401 when x-api-key header is missing", () => {
      process.env.INTERNAL_API_KEY = "test-secret-key";
      const req = makeRequest();
      const result = validateInternalApiKey(req);
      expect(result).toEqual({
        valid: false,
        error: "Unauthorized",
        statusCode: 401,
      });
    });

    it("returns 401 when x-api-key is empty string", () => {
      process.env.INTERNAL_API_KEY = "test-secret-key";
      const req = makeRequest({ "x-api-key": "" });
      const result = validateInternalApiKey(req);
      expect(result).toEqual({
        valid: false,
        error: "Unauthorized",
        statusCode: 401,
      });
    });
  });

  describe("when INTERNAL_API_KEY is unset and NODE_ENV=development", () => {
    it("allows requests (dev bypass)", () => {
      delete process.env.INTERNAL_API_KEY;
      setNodeEnv("development");
      const req = makeRequest();
      const result = validateInternalApiKey(req);
      expect(result).toEqual({ valid: true });
    });

    it("allows requests even with a random header value", () => {
      delete process.env.INTERNAL_API_KEY;
      setNodeEnv("development");
      const req = makeRequest({ "x-api-key": "anything" });
      const result = validateInternalApiKey(req);
      expect(result).toEqual({ valid: true });
    });
  });

  describe("when INTERNAL_API_KEY is unset and NODE_ENV is NOT development (fail-closed)", () => {
    it("returns 500 misconfiguration in production", () => {
      delete process.env.INTERNAL_API_KEY;
      setNodeEnv("production");
      const req = makeRequest();
      const result = validateInternalApiKey(req);
      expect(result).toEqual({
        valid: false,
        error: "Server misconfiguration: INTERNAL_API_KEY not set",
        statusCode: 500,
      });
    });

    it("returns 500 misconfiguration in staging", () => {
      delete process.env.INTERNAL_API_KEY;
      setNodeEnv("staging");
      const req = makeRequest();
      const result = validateInternalApiKey(req);
      expect(result).toEqual({
        valid: false,
        error: "Server misconfiguration: INTERNAL_API_KEY not set",
        statusCode: 500,
      });
    });

    it("returns 500 misconfiguration in test", () => {
      delete process.env.INTERNAL_API_KEY;
      setNodeEnv("test");
      const req = makeRequest();
      const result = validateInternalApiKey(req);
      expect(result).toEqual({
        valid: false,
        error: "Server misconfiguration: INTERNAL_API_KEY not set",
        statusCode: 500,
      });
    });
  });
});
