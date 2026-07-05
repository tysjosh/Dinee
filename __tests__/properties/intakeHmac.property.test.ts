/**
 * Feature: dinee-voice-platform, Property 18: HMAC authentication of the intake path —
 * a correctly signed request authenticates; any altered signature/payload is rejected,
 * recorded, and creates no order (verified on the Dinee side via the Mock_Intake_Client);
 * runs the shared cross-language vectors from task 8.3.
 *
 * Validates: Requirements 11.1, 11.2, 11.7
 *
 * Req 11.1 — the Dinee_Platform computes the HMAC_Signature over the Canonical_Payload.
 * Req 11.2 — if the signature does not match the signature the Voice_Intake_Adapter
 *   computes over the same Canonical_Payload, the request is rejected, the rejection is
 *   recorded, and no Runsheet order is created.
 * Req 11.7 — the shared cross-language vectors prove TypeScript signing reproduces the
 *   exact canonical bytes and signature the Runsheet Python adapter verifies against.
 *
 * The intake-side security property is exercised on the Dinee side through the
 * Mock_Intake_Client (Req 20.6), which mirrors the adapter's verification order and
 * records a receipt for every attempt. Timestamps are held inside the freshness window
 * and tenant ids are matched so that the HMAC signature is the deciding factor.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  canonicalizeIntake,
  signIntake,
  type VoiceIntakePayload,
  type TranscriptTurn,
} from "../../src/lib/integrations/runsheet/voiceIntakeClient";
import { MockIntakeClient } from "../../src/lib/integrations/runsheet/mockIntakeClient";
import intakeVectors from "../fixtures/intakeVectors.json";

// --- Fixed test context so the HMAC signature is the sole deciding factor ---

/** Injected clock value; generated timestamps stay well inside the freshness window. */
const FIXED_NOW = 1_730_000_000_000;
/** Half-width of the freshness window the mock accepts (5 minutes). */
const FRESHNESS_WINDOW_MS = 5 * 60 * 1000;
/** The secret the authenticated integration is bound to (the "correct" key). */
const INTEGRATION_SECRET = "runsheet-hmac-integration-secret-Zx9-shared";
/** The tenant the authenticated integration is bound to. */
const TENANT = "tenant-hmac-01";

function makeClient(): MockIntakeClient {
  return new MockIntakeClient({
    secret: INTEGRATION_SECRET,
    expectedTenantId: TENANT,
    freshnessWindowMs: FRESHNESS_WINDOW_MS,
    canonicalization: "raw",
    now: () => FIXED_NOW,
  });
}

// --- Arbitraries: otherwise-valid payloads so only the signature decides ---

const jsonScalarArb = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.boolean(),
  fc.constant(null),
  fc.double({ min: -1_000_000, max: 1_000_000, noNaN: true }).map((n) => (Object.is(n, -0) ? 0 : n))
);

const slotsArb = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 12 }).filter((k) => k !== "__proto__"),
  jsonScalarArb,
  { maxKeys: 5 }
) as fc.Arbitrary<Record<string, unknown>>;

const transcriptTurnArb: fc.Arbitrary<TranscriptTurn> = fc.record({
  role: fc.constantFrom<TranscriptTurn["role"]>("caller", "agent"),
  text: fc.string(),
  at: fc.integer({ min: 0, max: 4_000_000_000_000 }),
});

/** A fully-valid payload: matching tenant, fresh timestamp, all required fields present. */
const validPayloadArb: fc.Arbitrary<VoiceIntakePayload> = fc.record({
  schemaVersion: fc.constantFrom("1.0.0", "1.2.0", "2.0.0-beta"),
  tenantId: fc.constant(TENANT),
  idempotencyKey: fc.string({ minLength: 1, maxLength: 32 }),
  timestamp: fc.integer({
    min: FIXED_NOW - (FRESHNESS_WINDOW_MS - 1000),
    max: FIXED_NOW + (FRESHNESS_WINDOW_MS - 1000),
  }),
  callId: fc.string({ minLength: 1, maxLength: 40 }),
  transcriptId: fc.string({ minLength: 1, maxLength: 40 }),
  transcript: fc.array(transcriptTurnArb, { maxLength: 6 }),
  recordingRef: fc.option(fc.string({ maxLength: 24 }), { nil: null }),
  confidenceScore: fc.double({ min: 0, max: 1, noNaN: true }).map((n) => (Object.is(n, -0) ? 0 : n)),
  agentId: fc.string({ minLength: 1, maxLength: 24 }),
  sessionId: fc.string({ minLength: 1, maxLength: 24 }),
  callerPhone: fc.string({ minLength: 1, maxLength: 20 }),
  reviewRequired: fc.boolean(),
  extractedSlots: slotsArb,
});

/** Any secret that is not the integration secret (models a forged / non-matching signature). */
const wrongSecretArb = fc.string({ maxLength: 48 }).filter((s) => s !== INTEGRATION_SECRET);

// --- Fixture typing (shared cross-language vectors from task 8.3) ---

interface IntakeVector {
  name: string;
  secret: string;
  payload: VoiceIntakePayload;
  canonical: string;
  signature: string;
}

const vectors = (intakeVectors as { vectors: IntakeVector[] }).vectors;

describe("Property 18: HMAC authentication of the intake path", () => {
  it("authenticates and accepts a request signed with the correct secret (Req 11.1)", () => {
    fc.assert(
      fc.asyncProperty(validPayloadArb, async (payload) => {
        const client = makeClient();

        const r = await client.submit(payload, INTEGRATION_SECRET);

        // A correctly signed, otherwise-valid request authenticates and is accepted.
        expect(r.status).toBe("accepted");
        expect(r.httpStatus).toBe(200);
        expect(r.reference).toBeTruthy();

        // Exactly one order is created and the attempt is recorded.
        expect(client.getOrdersCreated()).toBe(1);
        const receipts = client.getReceipts();
        expect(receipts).toHaveLength(1);
        expect(receipts[0].idempotentReplay).toBe(false);

        // The recorded signature is the HMAC over the canonical bytes with the correct key.
        const expectedSignature = signIntake(canonicalizeIntake(payload), INTEGRATION_SECRET);
        expect(receipts[0].signature).toBe(expectedSignature);
      }),
      { numRuns: 100 }
    );
  });

  it("rejects a request signed with a wrong secret, records it, and creates no order (Req 11.2)", () => {
    fc.assert(
      fc.asyncProperty(validPayloadArb, wrongSecretArb, async (payload, wrongSecret) => {
        const client = makeClient();

        const result = await client.submit(payload, wrongSecret);

        // A signature that does not match is rejected with 401 — HMAC is the deciding factor.
        expect(result.status).toBe("rejected");
        expect(result.httpStatus).toBe(401);

        // No order is created.
        expect(client.getOrdersCreated()).toBe(0);

        // The rejection is recorded in the receipts.
        const receipts = client.getReceipts();
        expect(receipts).toHaveLength(1);
        expect(receipts[0].result.httpStatus).toBe(401);
        expect(receipts[0].result.status).toBe("rejected");
      }),
      { numRuns: 100 }
    );
  });

  it("detects an altered payload: tampering changes the canonical bytes and the signature (Req 11.2)", () => {
    fc.assert(
      fc.asyncProperty(validPayloadArb, async (payload) => {
        // Altering any field after signing changes the Canonical_Payload. "T:" + callId is
        // strictly longer than callId, so the altered payload can never equal the original.
        const altered: VoiceIntakePayload = { ...payload, callId: `T:${payload.callId}` };

        const canonicalOriginal = canonicalizeIntake(payload);
        const canonicalAltered = canonicalizeIntake(altered);
        expect(canonicalAltered).not.toBe(canonicalOriginal);

        // The signature transmitted over the original body no longer matches the signature
        // the adapter recomputes over the altered body — so verification fails.
        const signatureOverOriginal = signIntake(canonicalOriginal, INTEGRATION_SECRET);
        const signatureOverAltered = signIntake(canonicalAltered, INTEGRATION_SECRET);
        expect(signatureOverAltered).not.toBe(signatureOverOriginal);

        // End-to-end: a request whose signature does not authenticate the transmitted body
        // is rejected, recorded, and creates no order.
        const client = makeClient();
        const result = await client.submit(altered, `${INTEGRATION_SECRET}-tampered`);
        expect(result.status).toBe("rejected");
        expect(result.httpStatus).toBe(401);
        expect(client.getOrdersCreated()).toBe(0);
        expect(client.getReceipts()).toHaveLength(1);
      }),
      { numRuns: 100 }
    );
  });

  describe("shared cross-language vectors (task 8.3, Req 11.7)", () => {
    it("has vectors to run", () => {
      expect(vectors.length).toBeGreaterThan(0);
    });

    for (const vector of vectors) {
      it(`signing vector "${vector.name}" reproduces the fixture canonical bytes and signature`, () => {
        // Signing each vector's payload with its secret reproduces the fixture signature.
        expect(canonicalizeIntake(vector.payload)).toBe(vector.canonical);
        expect(signIntake(canonicalizeIntake(vector.payload), vector.secret)).toBe(vector.signature);
        expect(signIntake(vector.canonical, vector.secret)).toBe(vector.signature);
      });

      it(`vector "${vector.name}" authenticates with the correct secret and is rejected with a wrong one`, async () => {
        // Bind a mock to the vector's secret/tenant and evaluate freshness at the vector's own
        // timestamp so the HMAC signature is the deciding factor.
        const client = new MockIntakeClient({
          secret: vector.secret,
          expectedTenantId: vector.payload.tenantId,
          freshnessWindowMs: FRESHNESS_WINDOW_MS,
          canonicalization: "raw",
          now: () => vector.payload.timestamp,
        });

        // Correct secret authenticates: it passes HMAC (never a 401 signature rejection).
        const accepted = await client.submit(vector.payload, vector.secret);
        expect(accepted.httpStatus).not.toBe(401);

        // Wrong secret is rejected as an invalid signature and creates no order.
        const ordersBefore = client.getOrdersCreated();
        const rejected = await client.submit(vector.payload, `${vector.secret}-forged`);
        expect(rejected.status).toBe("rejected");
        expect(rejected.httpStatus).toBe(401);
        expect(client.getOrdersCreated()).toBe(ordersBefore);
      });
    }
  });
});

/**
 * Feature: multi-platform-voice-integrations, Property 11: Intake signature round-trip
 *
 * Validates: Requirements 5.5, 5.6
 *
 * Req 5.5 — the Runsheet adapter's IntakeClient canonicalizes the generic payload, computes
 *   the HMAC signature over the Canonical_Payload, and transmits it so the receiver verifies
 *   the signed request against the same secret and canonical bytes.
 * Req 5.6 — signature verification is byte-exact over the Canonical_Payload: a signature
 *   produced over one canonical body only authenticates that exact body, so mutating ANY
 *   field of the payload (which changes the canonical bytes) causes verification to fail.
 *
 * This exercises the shared `canonicalizeIntake` / `signIntake` primitives the generic
 * Runsheet adapter (task 7.1) reuses without altering their wire behavior. "Verification"
 * is modeled the way the receiver performs it: recomputing the HMAC over the transmitted
 * canonical bytes with the shared secret and comparing it to the transmitted signature.
 */
describe("Feature: multi-platform-voice-integrations, Property 11: Intake signature round-trip", () => {
  /**
   * Receiver-side verification: authenticates iff the presented signature equals the HMAC the
   * receiver recomputes over the same canonical bytes with the same secret (Req 5.5, 5.6).
   */
  function verifyIntake(canonical: string, signature: string, secret: string): boolean {
    return signIntake(canonical, secret) === signature;
  }

  /** Any secret the integration may be bound to. */
  const secretArb = fc.string({ minLength: 1, maxLength: 48 });

  /** A fully-populated intake payload with a free (unconstrained) tenant id. */
  const anyPayloadArb: fc.Arbitrary<VoiceIntakePayload> = fc.record({
    schemaVersion: fc.constantFrom("1.0", "1.0.0", "1.2.0", "2.0.0-beta"),
    tenantId: fc.string({ minLength: 1, maxLength: 24 }),
    idempotencyKey: fc.string({ minLength: 1, maxLength: 32 }),
    timestamp: fc.integer({ min: 0, max: 4_000_000_000_000 }),
    callId: fc.string({ minLength: 1, maxLength: 40 }),
    transcriptId: fc.string({ minLength: 1, maxLength: 40 }),
    transcript: fc.array(transcriptTurnArb, { maxLength: 6 }),
    recordingRef: fc.option(fc.string({ maxLength: 24 }), { nil: null }),
    confidenceScore: fc
      .double({ min: 0, max: 1, noNaN: true })
      .map((n) => (Object.is(n, -0) ? 0 : n)),
    agentId: fc.string({ minLength: 1, maxLength: 24 }),
    sessionId: fc.string({ minLength: 1, maxLength: 24 }),
    callerPhone: fc.string({ minLength: 1, maxLength: 20 }),
    reviewRequired: fc.boolean(),
    extractedSlots: slotsArb,
  });

  /** Field selector for single-field mutation. */
  type MutableField =
    | "schemaVersion"
    | "tenantId"
    | "idempotencyKey"
    | "timestamp"
    | "callId"
    | "transcriptId"
    | "transcript"
    | "recordingRef"
    | "confidenceScore"
    | "agentId"
    | "sessionId"
    | "callerPhone"
    | "reviewRequired"
    | "extractedSlots";

  const fieldArb = fc.constantFrom<MutableField>(
    "schemaVersion",
    "tenantId",
    "idempotencyKey",
    "timestamp",
    "callId",
    "transcriptId",
    "transcript",
    "recordingRef",
    "confidenceScore",
    "agentId",
    "sessionId",
    "callerPhone",
    "reviewRequired",
    "extractedSlots"
  );

  /** Returns an object key guaranteed to be absent from `obj`. */
  function freshKey(obj: Record<string, unknown>): string {
    let key = "μ";
    while (Object.prototype.hasOwnProperty.call(obj, key)) {
      key += "μ";
    }
    return key;
  }

  /**
   * Mutates exactly one field of `payload` in a way that is GUARANTEED to change its
   * canonical bytes (a distinct string, a different number/boolean, an extra transcript
   * turn, or an added slot key), so the mutation is a genuine, observable payload change.
   */
  function mutateField(payload: VoiceIntakePayload, field: MutableField): VoiceIntakePayload {
    switch (field) {
      case "schemaVersion":
        return { ...payload, schemaVersion: `X:${payload.schemaVersion}` };
      case "tenantId":
        return { ...payload, tenantId: `X:${payload.tenantId}` };
      case "idempotencyKey":
        return { ...payload, idempotencyKey: `X:${payload.idempotencyKey}` };
      case "timestamp":
        return { ...payload, timestamp: payload.timestamp + 1 };
      case "callId":
        return { ...payload, callId: `X:${payload.callId}` };
      case "transcriptId":
        return { ...payload, transcriptId: `X:${payload.transcriptId}` };
      case "transcript":
        return {
          ...payload,
          transcript: [...payload.transcript, { role: "agent", text: "MUT", at: 1 }],
        };
      case "recordingRef":
        return {
          ...payload,
          recordingRef: payload.recordingRef === null ? "x" : `X:${payload.recordingRef}`,
        };
      case "confidenceScore":
        return { ...payload, confidenceScore: payload.confidenceScore === 0 ? 1 : 0 };
      case "agentId":
        return { ...payload, agentId: `X:${payload.agentId}` };
      case "sessionId":
        return { ...payload, sessionId: `X:${payload.sessionId}` };
      case "callerPhone":
        return { ...payload, callerPhone: `X:${payload.callerPhone}` };
      case "reviewRequired":
        return { ...payload, reviewRequired: !payload.reviewRequired };
      case "extractedSlots":
        return {
          ...payload,
          extractedSlots: { ...payload.extractedSlots, [freshKey(payload.extractedSlots)]: "MUT" },
        };
    }
  }

  it("round-trip: canonicalize→sign→verify authenticates against the same secret (Req 5.5)", () => {
    fc.assert(
      fc.property(anyPayloadArb, secretArb, (payload, secret) => {
        const canonical = canonicalizeIntake(payload);
        const signature = signIntake(canonical, secret);

        // The receiver recomputes the HMAC over the transmitted canonical bytes and confirms.
        expect(verifyIntake(canonical, signature, secret)).toBe(true);

        // Signing is deterministic: the same payload + secret always yields the same signature.
        expect(signIntake(canonicalizeIntake(payload), secret)).toBe(signature);
      }),
      { numRuns: 100 }
    );
  });

  it("mutating ANY single field changes the canonical bytes so the original signature fails verification (Req 5.6)", () => {
    fc.assert(
      fc.property(anyPayloadArb, secretArb, fieldArb, (payload, secret, field) => {
        const canonical = canonicalizeIntake(payload);
        const signature = signIntake(canonical, secret);

        const mutated = mutateField(payload, field);
        const mutatedCanonical = canonicalizeIntake(mutated);

        // The single-field mutation is a genuine, observable change to the canonical bytes.
        expect(mutatedCanonical).not.toBe(canonical);

        // The signature produced over the original body no longer authenticates the mutated
        // body: byte-exact verification over the Canonical_Payload rejects the tampering.
        expect(verifyIntake(mutatedCanonical, signature, secret)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });
});
