/**
 * Feature: dinee-voice-platform, Property 20: Tenant match on the intake path
 *
 * Validates: Requirements 11.4
 *
 * For any intake request whose tenant identifier does not match the tenant of
 * the authenticated integration, the request is rejected (403), the tenant
 * mismatch is recorded, and no Runsheet order is created.
 *
 * Exercised on the Dinee side via the Mock_Intake_Client (Req 20.6): the mock
 * is bound to `expectedTenantId` and mirrors the Runsheet-backend verification
 * order. A payload signed with the correct secret and a fresh timestamp, with
 * all required fields present, isolates the tenant identifier as the deciding
 * factor. A mismatched tenant is rejected with `403`, recorded in the receipts,
 * and never increments `getOrdersCreated()`; a matching tenant is accepted.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { MockIntakeClient } from "../../src/lib/integrations/runsheet/mockIntakeClient";
import type { VoiceIntakePayload } from "../../src/lib/integrations/runsheet/voiceIntakeClient";

// --- Arbitraries ---

/** Non-empty strings so required-field checks (callId, callerPhone) always pass. */
const nonEmptyStringArb = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter((s) => s.trim().length > 0);

const transcriptTurnArb = fc.record({
  role: fc.constantFrom<"caller" | "agent">("caller", "agent"),
  text: fc.string({ maxLength: 60 }),
  at: fc.integer({ min: 0, max: 4_000_000_000_000 }),
});

/**
 * Builds a valid intake payload bound to `tenantId` with a `timestamp` inside
 * the freshness window (equal to the mock's fixed clock). Every field required
 * by the contract is populated so the tenant identifier is the only field that
 * can decide acceptance versus rejection.
 */
function validPayloadArb(tenantId: string, clockMs: number): fc.Arbitrary<VoiceIntakePayload> {
  return fc.record({
    schemaVersion: fc.constantFrom("1.0.0", "1.2.0", "2.0.0"),
    tenantId: fc.constant(tenantId),
    idempotencyKey: nonEmptyStringArb,
    timestamp: fc.constant(clockMs),
    callId: nonEmptyStringArb,
    transcriptId: nonEmptyStringArb,
    transcript: fc.array(transcriptTurnArb, { maxLength: 5 }),
    recordingRef: fc.option(nonEmptyStringArb, { nil: null }),
    confidenceScore: fc
      .double({ min: 0, max: 1, noNaN: true })
      .map((n) => (Object.is(n, -0) ? 0 : n)),
    agentId: nonEmptyStringArb,
    sessionId: nonEmptyStringArb,
    callerPhone: nonEmptyStringArb,
    reviewRequired: fc.boolean(),
    extractedSlots: fc.dictionary(
      fc.string({ minLength: 1, maxLength: 10 }),
      fc.oneof(fc.string(), fc.integer(), fc.boolean()),
      { maxKeys: 5 }
    ) as fc.Arbitrary<Record<string, unknown>>,
  });
}

/**
 * A pair of DISTINCT tenant identifiers: the tenant the integration is bound to
 * (`expectedTenantId`) and a different tenant id carried in the payload.
 */
const distinctTenantPairArb = fc
  .tuple(nonEmptyStringArb, nonEmptyStringArb)
  .filter(([expected, payloadTenant]) => expected !== payloadTenant);

const CLOCK_MS = 1_700_000_000_000;

describe("Property 20: Tenant match on the intake path", () => {
  it("rejects a mismatched tenant with 403, records it, and creates no order", async () => {
    await fc.assert(
      fc.asyncProperty(distinctTenantPairArb, async ([expectedTenantId, payloadTenantId]) => {
        // Correct signing secret so the HMAC check passes; the mock's clock
        // equals the payload timestamp so the freshness check passes. Tenant
        // match is therefore the only deciding factor.
        const secret = `secret_${expectedTenantId}`;
        const client = new MockIntakeClient({
          secret,
          expectedTenantId,
          now: () => CLOCK_MS,
        });

        const payload = fc.sample(validPayloadArb(payloadTenantId, CLOCK_MS), 1)[0];

        const result = await client.submit(payload, secret);

        // Rejected with 403 (tenant mismatch).
        expect(result.status).toBe("rejected");
        expect(result.httpStatus).toBe(403);

        // The mismatch attempt is recorded in the receipts.
        const receipts = client.getReceipts();
        expect(receipts).toHaveLength(1);
        expect(receipts[0].tenantId).toBe(payloadTenantId);
        expect(receipts[0].result.httpStatus).toBe(403);
        expect(receipts[0].result.status).toBe("rejected");

        // No order was created.
        expect(client.getOrdersCreated()).toBe(0);
      }),
      { numRuns: 100 }
    );
  });

  it("accepts a matching tenant and creates exactly one order", async () => {
    await fc.assert(
      fc.asyncProperty(nonEmptyStringArb, async (tenantId) => {
        const secret = `secret_${tenantId}`;
        const client = new MockIntakeClient({
          secret,
          expectedTenantId: tenantId,
          now: () => CLOCK_MS,
        });

        // Payload tenant matches the integration tenant.
        const payload = fc.sample(validPayloadArb(tenantId, CLOCK_MS), 1)[0];

        const result = await client.submit(payload, secret);

        expect(result.status).toBe("accepted");
        expect(result.httpStatus).toBe(200);
        expect(result.reference).toBeDefined();
        expect(client.getOrdersCreated()).toBe(1);
      }),
      { numRuns: 100 }
    );
  });
});
