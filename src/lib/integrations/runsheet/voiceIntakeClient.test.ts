/**
 * Unit tests for the signed Intake_Contract client — canonicalization
 * round-trip, deterministic HMAC signing, and the signed POST surface.
 *
 * Validates: Requirements 10.2, 10.3, 10.6, 10.9, 11.1, 11.7, 20.4
 */
import { describe, it, expect, vi } from "vitest";
import crypto from "crypto";
import {
  canonicalizeIntake,
  deserializeIntake,
  signIntake,
  submitVoiceIntake,
  VoiceIntakeClient,
  type FetchLike,
  type VoiceIntakePayload,
} from "./voiceIntakeClient";

function makePayload(overrides: Partial<VoiceIntakePayload> = {}): VoiceIntakePayload {
  return {
    schemaVersion: "1.0.0",
    tenantId: "tenant-abc",
    idempotencyKey: "idem-123",
    timestamp: 1_700_000_000_000,
    callId: "call-1",
    transcriptId: "trans-1",
    transcript: [
      { role: "caller", text: "I need 500 litres of diesel", at: 1_700_000_000_100 },
      { role: "agent", text: "Delivered to which site?", at: 1_700_000_000_200 },
    ],
    recordingRef: "rec-1",
    confidenceScore: 0.92,
    agentId: "agent-1",
    sessionId: "sess-1",
    callerPhone: "+15555550123",
    reviewRequired: true,
    extractedSlots: { product: "diesel", quantity: 500, note: "gate code 12" },
    ...overrides,
  };
}

describe("canonicalizeIntake / deserializeIntake", () => {
  it("round-trips to equivalent values (Req 11.6)", () => {
    const payload = makePayload();
    const canonical = canonicalizeIntake(payload);
    const restored = deserializeIntake(canonical);
    expect(restored).toEqual(payload);
  });

  it("re-canonicalizing reconstructed values is byte-identical (Req 11.6, 11.7)", () => {
    const payload = makePayload();
    const canonical = canonicalizeIntake(payload);
    const recanonical = canonicalizeIntake(deserializeIntake(canonical));
    expect(recanonical).toBe(canonical);
  });

  it("is deterministic regardless of key insertion order", () => {
    const a = makePayload({ extractedSlots: { a: 1, b: 2, z: "x" } });
    const b = makePayload({ extractedSlots: { z: "x", b: 2, a: 1 } });
    expect(canonicalizeIntake(a)).toBe(canonicalizeIntake(b));
  });

  it("preserves the full transcript content in the payload (Req 10.9)", () => {
    const payload = makePayload();
    const restored = deserializeIntake(canonicalizeIntake(payload));
    expect(restored.transcript).toEqual(payload.transcript);
    expect(restored.transcriptId).toBe(payload.transcriptId);
  });

  it("handles awkward slot values (unicode, empty, numbers-as-strings, nested)", () => {
    const payload = makePayload({
      extractedSlots: {
        unicode: "café — ☕",
        empty: "",
        numberString: "007",
        nested: { deep: { list: [1, "two", null, true] } },
      },
    });
    const restored = deserializeIntake(canonicalizeIntake(payload));
    expect(restored).toEqual(payload);
  });

  it("jcs mode produces the same canonical bytes as raw mode for this payload", () => {
    const payload = makePayload();
    expect(canonicalizeIntake(payload, "jcs")).toBe(canonicalizeIntake(payload, "raw"));
  });
});

describe("signIntake", () => {
  it("computes a stable HMAC-SHA256 hex over the canonical bytes (Req 11.1)", () => {
    const canonical = canonicalizeIntake(makePayload());
    const secret = "webhook-secret";
    const expected = crypto.createHmac("sha256", secret).update(canonical, "utf8").digest("hex");
    expect(signIntake(canonical, secret)).toBe(expected);
  });

  it("changes when the payload changes", () => {
    const secret = "webhook-secret";
    const sigA = signIntake(canonicalizeIntake(makePayload()), secret);
    const sigB = signIntake(canonicalizeIntake(makePayload({ callerPhone: "+15555550999" })), secret);
    expect(sigA).not.toBe(sigB);
  });
});

describe("submitVoiceIntake", () => {
  it("POSTs the canonical body with all contract headers (Req 10.6, 11.1)", async () => {
    const payload = makePayload();
    const secret = "webhook-secret";
    const canonical = canonicalizeIntake(payload);
    const expectedSig = `sha256=${signIntake(canonical, secret)}`;

    const fetchImpl = vi.fn<FetchLike>(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ accepted: true, orderId: "order-9", disposition: "placed" }),
      text: async () => "",
    }));

    const result = await submitVoiceIntake(payload, secret, {
      baseUrl: "https://runsheet.example.com/",
      fetchImpl,
    });

    expect(result).toEqual({
      status: "accepted",
      httpStatus: 200,
      reference: "order-9",
      disposition: "placed",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://runsheet.example.com/voice-intake");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(canonical);
    expect(init.headers["X-Runsheet-Tenant"]).toBe(payload.tenantId);
    expect(init.headers["X-Idempotency-Key"]).toBe(payload.idempotencyKey);
    expect(init.headers["X-Timestamp"]).toBe(new Date(payload.timestamp).toISOString());
    expect(init.headers["X-Signature"]).toBe(expectedSig);
    expect(init.headers["X-Schema-Version"]).toBe(payload.schemaVersion);
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("maps a non-2xx response to a rejected result", async () => {
    const fetchImpl: FetchLike = async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
      text: async () => "signature mismatch",
    });

    const result = await submitVoiceIntake(makePayload(), "s", {
      baseUrl: "https://runsheet.example.com",
      fetchImpl,
    });

    expect(result.status).toBe("rejected");
    expect(result.httpStatus).toBe(401);
    expect(result.error).toBe("signature mismatch");
  });

  it("VoiceIntakeClient.submit delegates to the contract POST", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ accepted: true, orderId: "o-1", disposition: "placed" }),
      text: async () => "",
    }));
    const client = new VoiceIntakeClient({ baseUrl: "https://rs.example.com", fetchImpl });
    const result = await client.submit(makePayload(), "secret");
    expect(result.status).toBe("accepted");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
