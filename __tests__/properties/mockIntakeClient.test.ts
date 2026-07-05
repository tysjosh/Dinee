/**
 * Feature: dinee-voice-platform, Task 8.10 — Mock_Intake_Client contract conformance.
 *
 * Validates: Requirements 20.6
 *
 * Asserts that {@link MockIntakeClient}:
 *   1. implements the {@link IntakeClient} contract (it is assignable to the
 *      interface and exposes the `submit(payload, secret) => Promise<IntakeResult>`
 *      signature), so it is interchangeable with the real VoiceIntakeClient; and
 *   2. passes the shared cross-language contract vectors from task 8.3
 *      (`__tests__/fixtures/intakeVectors.json`): a mock bound to each vector's
 *      secret/tenant, with its clock fixed at the vector's timestamp, authenticates
 *      the correctly-signed payload (HMAC never rejects), and records a receipt whose
 *      Canonical_Payload bytes equal the vector's `canonical` and whose signature
 *      equals the vector's `signature`; and the round-trip deserialized payload
 *      equals the submitted payload (fidelity).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  canonicalizeIntake,
  signIntake,
  type IntakeClient,
  type IntakeResult,
  type VoiceIntakePayload,
} from "../../src/lib/integrations/runsheet/voiceIntakeClient";
import { MockIntakeClient } from "../../src/lib/integrations/runsheet/mockIntakeClient";

interface IntakeVector {
  name: string;
  description: string;
  secret: string;
  payload: VoiceIntakePayload;
  canonical: string;
  signature: string;
}

interface IntakeVectorFixture {
  vectors: IntakeVector[];
}

const fixture: IntakeVectorFixture = JSON.parse(
  readFileSync(path.join(__dirname, "..", "fixtures", "intakeVectors.json"), "utf8")
);

/** Half-width of the accepted freshness window (5 minutes). */
const FRESHNESS_WINDOW_MS = 5 * 60 * 1000;

/** Builds a mock bound to a vector's secret/tenant with its clock at the vector timestamp. */
function makeClientForVector(vector: IntakeVector): MockIntakeClient {
  return new MockIntakeClient({
    secret: vector.secret,
    expectedTenantId: vector.payload.tenantId,
    freshnessWindowMs: FRESHNESS_WINDOW_MS,
    canonicalization: "raw",
    now: () => vector.payload.timestamp,
  });
}

/** A vector is a fully-valid intake (accepted) iff its required fields are present. */
function requiredFieldsPresent(payload: VoiceIntakePayload): boolean {
  return (
    typeof payload.callId === "string" &&
    payload.callId.length > 0 &&
    typeof payload.callerPhone === "string" &&
    payload.callerPhone.length > 0 &&
    payload.extractedSlots !== null &&
    typeof payload.extractedSlots === "object" &&
    !Array.isArray(payload.extractedSlots)
  );
}

describe("Task 8.10: Mock_Intake_Client contract conformance (Req 20.6)", () => {
  describe("implements the IntakeClient contract", () => {
    it("is assignable to IntakeClient and exposes the submit signature", () => {
      // Assignment itself is the compile-time proof that MockIntakeClient
      // satisfies the IntakeClient interface (submit signature).
      const client: IntakeClient = new MockIntakeClient({
        secret: "conformance-secret",
        expectedTenantId: "tenant-conformance",
      });
      expect(typeof client.submit).toBe("function");
      // submit takes exactly (payload, secret).
      expect(client.submit.length).toBe(2);
    });

    it("submit returns a Promise resolving to an IntakeResult", async () => {
      const client: IntakeClient = new MockIntakeClient({
        secret: "conformance-secret",
        expectedTenantId: "tenant-conformance",
        now: () => 1_730_000_000_000,
      });
      const payload: VoiceIntakePayload = {
        schemaVersion: "1.0.0",
        tenantId: "tenant-conformance",
        idempotencyKey: "idem-conf-1",
        timestamp: 1_730_000_000_000,
        callId: "call-conf-1",
        transcriptId: "transcript-conf-1",
        transcript: [{ role: "caller", text: "Hello", at: 1_730_000_000_001 }],
        recordingRef: null,
        confidenceScore: 0.9,
        agentId: "agent-conf",
        sessionId: "sess-conf",
        callerPhone: "+2348000000000",
        reviewRequired: true,
        extractedSlots: { product: "LPG" },
      };

      const returned = client.submit(payload, "conformance-secret");
      expect(returned).toBeInstanceOf(Promise);

      const result: IntakeResult = await returned;
      expect(result).toHaveProperty("status");
      expect(result).toHaveProperty("httpStatus");
      expect(["accepted", "rejected"]).toContain(result.status);
    });
  });

  describe("passes the shared contract vectors (task 8.3)", () => {
    it("has vectors to run", () => {
      expect(fixture.vectors.length).toBeGreaterThan(0);
    });

    for (const vector of fixture.vectors) {
      describe(`vector: ${vector.name}`, () => {
        it("records a receipt whose canonical bytes equal the vector canonical", async () => {
          const client = makeClientForVector(vector);
          await client.submit(vector.payload, vector.secret);

          const receipt = client.getLastReceipt();
          expect(receipt).toBeDefined();
          expect(receipt!.canonical).toBe(vector.canonical);
          // Sanity: the client's own canonicalizer reproduces the fixture bytes.
          expect(canonicalizeIntake(vector.payload)).toBe(vector.canonical);
        });

        it("records a receipt whose signature equals the vector signature", async () => {
          const client = makeClientForVector(vector);
          await client.submit(vector.payload, vector.secret);

          const receipt = client.getLastReceipt();
          expect(receipt).toBeDefined();
          expect(receipt!.signature).toBe(vector.signature);
          // Sanity: HMAC over the canonical bytes with the vector secret matches.
          expect(signIntake(vector.canonical, vector.secret)).toBe(vector.signature);
        });

        it("authenticates the correctly-signed payload (HMAC never rejects)", async () => {
          const client = makeClientForVector(vector);
          const result = await client.submit(vector.payload, vector.secret);

          // A correctly-signed payload passes HMAC verification: it is never a
          // 401 signature rejection.
          expect(result.httpStatus).not.toBe(401);

          if (requiredFieldsPresent(vector.payload)) {
            // A complete, correctly-signed, tenant-matched, fresh payload is accepted
            // and creates exactly one order.
            expect(result.status).toBe("accepted");
            expect(result.httpStatus).toBe(200);
            expect(result.reference).toBeTruthy();
            expect(client.getOrdersCreated()).toBe(1);
          }
        });

        it("round-trips the deserialized payload equal to the submitted payload (fidelity)", async () => {
          const client = makeClientForVector(vector);
          await client.submit(vector.payload, vector.secret);

          const receipt = client.getLastReceipt();
          expect(receipt).toBeDefined();
          // Deserializing the canonical bytes reconstructs the submitted payload
          // (deep equality is key-order independent).
          expect(receipt!.deserialized).toEqual(vector.payload);
        });
      });
    }
  });
});
