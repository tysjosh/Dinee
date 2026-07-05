/**
 * Unit tests for voice tool retry wrapper (withRetry, isTransientError)
 *
 * Validates: Requirements 16.1, 16.2, 16.3, 16.4, 16.5, 16.6
 */
import { describe, it, expect, vi } from "vitest";
import {
  isTransientError,
  withRetry,
} from "../../src/lib/modules/packs/logistics/wrappers";

describe("isTransientError", () => {
  it("returns true for network errors", () => {
    expect(isTransientError(new Error("network error occurred"))).toBe(true);
  });

  it("returns true for timeout errors", () => {
    expect(isTransientError(new Error("request timeout"))).toBe(true);
  });

  it("returns true for ECONNREFUSED", () => {
    expect(isTransientError(new Error("connect ECONNREFUSED 127.0.0.1:3000"))).toBe(true);
  });

  it("returns true for mutation conflict", () => {
    expect(isTransientError(new Error("mutation conflict detected"))).toBe(true);
  });

  it("returns true for rate limit errors", () => {
    expect(isTransientError(new Error("rate limit exceeded"))).toBe(true);
  });

  it("returns true for 503 errors", () => {
    expect(isTransientError(new Error("HTTP 503 Service Unavailable"))).toBe(true);
  });

  it("returns true for 502 errors", () => {
    expect(isTransientError(new Error("502 Bad Gateway"))).toBe(true);
  });

  it("returns false for validation errors", () => {
    expect(isTransientError(new Error("Missing required field: shipmentId"))).toBe(false);
  });

  it("returns false for authorization errors", () => {
    expect(isTransientError(new Error("Unauthorized access"))).toBe(false);
  });

  it("returns false for generic errors", () => {
    expect(isTransientError(new Error("Invalid input data"))).toBe(false);
  });

  it("handles non-Error values", () => {
    expect(isTransientError("network failure")).toBe(true);
    expect(isTransientError("some random string")).toBe(false);
    expect(isTransientError(42)).toBe(false);
  });
});

describe("withRetry", () => {
  it("returns result on first success without retrying", async () => {
    const fn = vi.fn().mockResolvedValue({ success: true });
    const result = await withRetry("test_tool", fn);
    expect(result).toEqual({ success: true });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on transient error and succeeds on second attempt", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValue({ success: true });

    const result = await withRetry("test_tool", fn, 2, [0, 0]);
    expect(result).toEqual({ success: true });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries up to maxRetries times on transient errors", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValue({ success: true });

    const result = await withRetry("test_tool", fn, 2, [0, 0]);
    expect(result).toEqual({ success: true });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws after exhausting all retries on transient errors", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("network error"));

    await expect(withRetry("test_tool", fn, 2, [0, 0])).rejects.toThrow("network error");
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("does not retry non-transient errors", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("Invalid input data"));

    await expect(withRetry("test_tool", fn, 2, [0, 0])).rejects.toThrow("Invalid input data");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not retry validation errors (Req 16.6)", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("Missing required field"));

    await expect(withRetry("test_tool", fn, 2, [0, 0])).rejects.toThrow("Missing required field");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
