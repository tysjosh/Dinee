/**
 * Unit tests for createLogger utility.
 *
 * Verifies that the extended LogContext fields (correlationId, tenantId,
 * vertical, endpoint, method, resourceId) are passed through to
 * structured JSON output.
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.7, 17.10
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createLogger } from "./logger";

describe("createLogger", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  function parseLastLog(): Record<string, unknown> {
    const call = logSpy.mock.calls[logSpy.mock.calls.length - 1];
    return JSON.parse(call[0] as string);
  }

  function parseLastError(): Record<string, unknown> {
    const call = errorSpy.mock.calls[errorSpy.mock.calls.length - 1];
    return JSON.parse(call[0] as string);
  }

  it("emits structured JSON with module and timestamp", () => {
    const logger = createLogger("test-module");
    logger.info("hello");
    const entry = parseLastLog();
    expect(entry.level).toBe("info");
    expect(entry.module).toBe("test-module");
    expect(entry.message).toBe("hello");
    expect(entry.timestamp).toBeDefined();
  });

  it("passes existing context fields through", () => {
    const logger = createLogger("auth");
    logger.info("request", { requestId: "req-1", partnerId: "p-1" });
    const entry = parseLastLog();
    expect(entry.requestId).toBe("req-1");
    expect(entry.partnerId).toBe("p-1");
  });

  it("passes correlationId through to JSON output (Req 17.10)", () => {
    const logger = createLogger("voice");
    logger.info("tool call", { correlationId: "voice-abc-123" });
    const entry = parseLastLog();
    expect(entry.correlationId).toBe("voice-abc-123");
  });

  it("passes tenantId, vertical, endpoint, method, resourceId through (Req 4.2)", () => {
    const logger = createLogger("logistics");
    logger.info("shipment created", {
      tenantId: "org-456",
      vertical: "logistics",
      endpoint: "/api/v1/logistics/shipments",
      method: "POST",
      resourceId: "ship-789",
    });
    const entry = parseLastLog();
    expect(entry.tenantId).toBe("org-456");
    expect(entry.vertical).toBe("logistics");
    expect(entry.endpoint).toBe("/api/v1/logistics/shipments");
    expect(entry.method).toBe("POST");
    expect(entry.resourceId).toBe("ship-789");
  });

  it("includes all new fields together in a single log entry", () => {
    const logger = createLogger("audit");
    logger.warn("status update", {
      requestId: "req-100",
      correlationId: "voice-xyz",
      tenantId: "org-1",
      vertical: "logistics",
      endpoint: "/api/v1/logistics/shipments/s1/status",
      method: "POST",
      resourceId: "s1",
      partnerId: "partner-a",
    });
    const entry = parseLastLog();
    expect(entry.level).toBe("warn");
    expect(entry.requestId).toBe("req-100");
    expect(entry.correlationId).toBe("voice-xyz");
    expect(entry.tenantId).toBe("org-1");
    expect(entry.vertical).toBe("logistics");
    expect(entry.endpoint).toBe("/api/v1/logistics/shipments/s1/status");
    expect(entry.method).toBe("POST");
    expect(entry.resourceId).toBe("s1");
    expect(entry.partnerId).toBe("partner-a");
  });

  it("error level logs to console.error with all context fields", () => {
    const logger = createLogger("error-test");
    logger.error("mutation failed", {
      correlationId: "voice-err",
      tenantId: "org-err",
      resourceId: "ship-err",
    });
    const entry = parseLastError();
    expect(entry.level).toBe("error");
    expect(entry.correlationId).toBe("voice-err");
    expect(entry.tenantId).toBe("org-err");
    expect(entry.resourceId).toBe("ship-err");
  });

  it("omits undefined optional fields from JSON output", () => {
    const logger = createLogger("sparse");
    logger.info("minimal", { requestId: "req-only" });
    const entry = parseLastLog();
    expect(entry.requestId).toBe("req-only");
    expect("correlationId" in entry).toBe(false);
    expect("tenantId" in entry).toBe(false);
    expect("vertical" in entry).toBe(false);
  });
});
