/**
 * Unit tests for RunsheetClient — HMAC-SHA256 signature validation
 * and RunsheetClient class methods.
 *
 * Validates: Requirements 7.4, 8.2, 18.7
 */
import { describe, it, expect } from "vitest";
import crypto from "crypto";
import {
  validateRunsheetSignature,
  RunsheetClient,
  type RunsheetWebhookEvent,
  type RunsheetConfig,
} from "./runsheetClient";

describe("validateRunsheetSignature", () => {
  const secret = "test-webhook-secret-key";

  function sign(payload: string, key: string): string {
    return crypto.createHmac("sha256", key).update(payload).digest("hex");
  }

  it("returns true for a valid signature", () => {
    const payload = JSON.stringify({ shipmentId: "SHP-001", status: "delivered" });
    const signature = sign(payload, secret);

    expect(validateRunsheetSignature(payload, signature, secret)).toBe(true);
  });

  it("returns false for a tampered payload", () => {
    const original = JSON.stringify({ shipmentId: "SHP-001", status: "delivered" });
    const tampered = JSON.stringify({ shipmentId: "SHP-001", status: "failed" });
    const signature = sign(original, secret);

    expect(validateRunsheetSignature(tampered, signature, secret)).toBe(false);
  });

  it("returns false for a wrong secret", () => {
    const payload = JSON.stringify({ shipmentId: "SHP-001" });
    const signature = sign(payload, "wrong-secret");

    expect(validateRunsheetSignature(payload, signature, secret)).toBe(false);
  });

  it("returns false for a completely invalid signature string", () => {
    const payload = JSON.stringify({ data: "test" });

    expect(validateRunsheetSignature(payload, "not-a-valid-hex-sig", secret)).toBe(false);
  });

  it("returns false when signature length differs from expected", () => {
    const payload = JSON.stringify({ data: "test" });

    expect(validateRunsheetSignature(payload, "abc", secret)).toBe(false);
  });

  it("handles empty payload", () => {
    const payload = "";
    const signature = sign(payload, secret);

    expect(validateRunsheetSignature(payload, signature, secret)).toBe(true);
  });
});

describe("RunsheetClient.validateWebhookSignature", () => {
  const secret = "integration-webhook-secret";

  function sign(payload: string, key: string): string {
    return crypto.createHmac("sha256", key).update(payload).digest("hex");
  }

  it("validates a correctly signed webhook event", async () => {
    const config: RunsheetConfig = {
      apiKey: "test-api-key",
      tenantMapping: { loc1: "hub1" },
      webhookUrl: "https://example.com/webhook",
    };
    const client = new RunsheetClient(config);

    const payload: Record<string, unknown> = {
      shipmentId: "SHP-100",
      status: "in_transit",
    };
    const payloadStr = JSON.stringify(payload);
    const signature = sign(payloadStr, secret);

    const event: RunsheetWebhookEvent = {
      eventId: "evt-001",
      eventType: "shipment_status",
      timestamp: new Date().toISOString(),
      signature,
      payload,
    };

    const result = await client.validateWebhookSignature(event, secret);
    expect(result).toBe(true);
  });

  it("rejects a webhook event with an invalid signature", async () => {
    const config: RunsheetConfig = {
      apiKey: "test-api-key",
      tenantMapping: {},
      webhookUrl: "https://example.com/webhook",
    };
    const client = new RunsheetClient(config);

    const event: RunsheetWebhookEvent = {
      eventId: "evt-002",
      eventType: "rider_assignment",
      timestamp: new Date().toISOString(),
      signature: "deadbeef".repeat(8), // 64 hex chars but wrong
      payload: { riderId: "R-50", shipmentId: "SHP-200" },
    };

    const result = await client.validateWebhookSignature(event, secret);
    expect(result).toBe(false);
  });
});
