/**
 * Feature: multi-platform-voice-integrations, Property 12: Runsheet adapter preserves
 * the existing wire contract.
 *
 * Validates: Requirements 11.2
 *
 * Req 11.2 — WHEN a Runsheet call submits a voice-originated order, THE Runsheet
 *   Integration_Adapter SHALL submit over the existing HMAC-signed intake contract
 *   using the existing path prefix, timestamp format, and schema version.
 *
 * Property statement: The generic Runsheet adapter's intake path (`submitViaRunsheet`
 * + its `toVoiceIntakePayload` mapping) produces a byte-identical canonical body and a
 * byte-identical signed signature compared to the pre-generalization `VoiceIntakeClient`
 * path.
 *
 * Approach: `toVoiceIntakePayload` is not exported, so we drive the exported
 * `submitViaRunsheet` helper with a fake `RunsheetIntakeClient` (`CapturingIntakeClient`)
 * that records the exact `VoiceIntakePayload` + secret handed to `.submit()`. We then
 * compare the canonicalization/signature of the captured payload against the equivalent
 * `VoiceIntakePayload` the pre-generalization caller would have built directly. If the
 * adapter preserves the wire contract, the two canonicalize to identical bytes and sign
 * to identical signatures.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  submitViaRunsheet,
} from "../../src/lib/integrations/runsheet/adapter";
import {
  canonicalizeIntake,
  signIntake,
  type IntakeClient as RunsheetIntakeClient,
  type VoiceIntakePayload,
  type IntakeResult,
  type TranscriptTurn,
} from "../../src/lib/integrations/runsheet/voiceIntakeClient";
import type { IntakePayload } from "../../src/lib/integrations/platform/adapter";

/**
 * A fake Runsheet intake client that captures the exact payload + secret passed to
 * `.submit()` without performing any I/O, so we can inspect what the adapter mapped
 * the generic envelope onto.
 */
class CapturingIntakeClient implements RunsheetIntakeClient {
  public captured: { payload: VoiceIntakePayload; secret: string } | null = null;

  submit(payload: VoiceIntakePayload, secret: string): Promise<IntakeResult> {
    this.captured = { payload, secret };
    return Promise.resolve({ status: "accepted", httpStatus: 200, reference: "order-1", disposition: "placed" });
  }
}

// --- Arbitraries: modeled on __tests__/properties/intakeHmac.property.test.ts ---

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

const secretArb = fc.string({ minLength: 1, maxLength: 48 });

/**
 * The source voice-order fields shared by both the generic envelope and the
 * directly-built pre-generalization payload. Generating them once guarantees both
 * paths derive from identical data, so any byte difference is attributable to the
 * adapter's mapping rather than divergent inputs.
 */
const voiceOrderArb = fc.record({
  schemaVersion: fc.constant("1.0"),
  tenantId: fc.string({ minLength: 1, maxLength: 32 }),
  idempotencyKey: fc.string({ minLength: 1, maxLength: 32 }),
  timestamp: fc.integer({ min: 0, max: 4_000_000_000_000 }),
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

type VoiceOrder = {
  schemaVersion: string;
  tenantId: string;
  idempotencyKey: string;
  timestamp: number;
  callId: string;
  transcriptId: string;
  transcript: TranscriptTurn[];
  recordingRef: string | null;
  confidenceScore: number;
  agentId: string;
  sessionId: string;
  callerPhone: string;
  reviewRequired: boolean;
  extractedSlots: Record<string, unknown>;
};

/** The generic envelope the ws-server would hand to the adapter (Req 5.5, 11.2). */
function toGenericEnvelope(o: VoiceOrder): IntakePayload {
  return {
    schemaVersion: o.schemaVersion,
    tenantId: o.tenantId,
    idempotencyKey: o.idempotencyKey,
    timestamp: o.timestamp,
    fields: {
      callId: o.callId,
      transcriptId: o.transcriptId,
      transcript: o.transcript,
      recordingRef: o.recordingRef,
      confidenceScore: o.confidenceScore,
      agentId: o.agentId,
      sessionId: o.sessionId,
      callerPhone: o.callerPhone,
      reviewRequired: o.reviewRequired,
      extractedSlots: o.extractedSlots,
    },
  };
}

/** The payload the pre-generalization VoiceIntakeClient caller would have built directly. */
function toDirectVoiceIntakePayload(o: VoiceOrder): VoiceIntakePayload {
  return {
    schemaVersion: o.schemaVersion,
    tenantId: o.tenantId,
    idempotencyKey: o.idempotencyKey,
    timestamp: o.timestamp,
    callId: o.callId,
    transcriptId: o.transcriptId,
    transcript: o.transcript,
    recordingRef: o.recordingRef,
    confidenceScore: o.confidenceScore,
    agentId: o.agentId,
    sessionId: o.sessionId,
    callerPhone: o.callerPhone,
    reviewRequired: o.reviewRequired,
    extractedSlots: o.extractedSlots,
  };
}

describe("Property 12: Runsheet adapter preserves the existing wire contract", () => {
  it("produces byte-identical canonical body and signature vs the pre-generalization path (Req 11.2)", () => {
    fc.assert(
      fc.asyncProperty(voiceOrderArb, secretArb, async (order, secret) => {
        const envelope = toGenericEnvelope(order as VoiceOrder);
        const direct = toDirectVoiceIntakePayload(order as VoiceOrder);

        // Generic adapter path: capture what submitViaRunsheet hands the intake client.
        const client = new CapturingIntakeClient();
        const result = await submitViaRunsheet(client, envelope, secret);

        // The adapter delegates to the client's submit unchanged.
        expect(result.status).toBe("accepted");
        expect(client.captured).not.toBeNull();
        const captured = client.captured!;

        // The secret is passed through untouched.
        expect(captured.secret).toBe(secret);

        // Byte-identical canonical body: what gets signed AND transmitted on the wire.
        const canonicalAdapter = canonicalizeIntake(captured.payload);
        const canonicalDirect = canonicalizeIntake(direct);
        expect(canonicalAdapter).toBe(canonicalDirect);

        // Byte-identical HMAC signature over the canonical bytes with the same secret.
        const signatureAdapter = signIntake(canonicalAdapter, secret);
        const signatureDirect = signIntake(canonicalDirect, secret);
        expect(signatureAdapter).toBe(signatureDirect);
      }),
      { numRuns: 100 }
    );
  });
});
