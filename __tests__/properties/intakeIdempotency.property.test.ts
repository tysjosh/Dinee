/**
 * Feature: dinee-voice-platform, Property 19: Idempotent intake submission
 *
 * Validates: Requirements 11.3
 *
 * IF an intake request presents an Idempotency_Key that matches a previously
 * accepted request, THEN THE Voice_Intake_Adapter SHALL return the original
 * result and SHALL NOT create a duplicate order.
 *
 * Exercised on the Dinee side via the Mock_Intake_Client (Req 20.6): a valid
 * payload (correct signing secret, matching tenant, fresh timestamp, required
 * fields present) is accepted and creates exactly one order; resubmitting with
 * the same idempotency key — any number of times — returns the original stored
 * result (same `reference`) and never increments `getOrdersCreated()`.
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
 * by the contract is populated so the only relevant behavior under test is
 * idempotency.
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
    confidenceScore: fc.double({ min: 0, max: 1, noNaN: true }).map((n) => (Object.is(n, -0) ? 0 : n)),
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

const CLOCK_MS = 1_700_000_000_000;

describe("Property 19: Idempotent intake submission", () => {
  it("returns the original result and creates no duplicate order on repeated idempotency keys", async () => {
    await fc.assert(
      fc.asyncProperty(
        nonEmptyStringArb, // tenantId / signing secret seed
        fc.integer({ min: 1, max: 10 }), // number of repeat resubmissions (varied)
        async (tenantId, repeats) => {
          const secret = `secret_${tenantId}`;
          const client = new MockIntakeClient({
            secret,
            expectedTenantId: tenantId,
            now: () => CLOCK_MS,
          });

          const payload = fc.sample(validPayloadArb(tenantId, CLOCK_MS), 1)[0];

          // First submission: valid, so it is accepted and creates exactly one order.
          const first = await client.submit(payload, secret);
          expect(first.status).toBe("accepted");
          expect(first.httpStatus).toBe(200);
          expect(first.reference).toBeDefined();
          expect(client.getOrdersCreated()).toBe(1);

          // Resubmit with the SAME idempotency key `repeats` times.
          for (let i = 0; i < repeats; i++) {
            const replay = await client.submit(payload, secret);
            // The original stored result is returned (same status + reference).
            expect(replay.status).toBe("accepted");
            expect(replay.httpStatus).toBe(200);
            expect(replay.reference).toBe(first.reference);
            // No duplicate order is ever created.
            expect(client.getOrdersCreated()).toBe(1);
          }

          // Total orders remains one regardless of how many repeats occurred.
          expect(client.getOrdersCreated()).toBe(1);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("distinct idempotency keys each create one order; repeats of any key add none", async () => {
    await fc.assert(
      fc.asyncProperty(
        nonEmptyStringArb,
        fc.uniqueArray(nonEmptyStringArb, { minLength: 1, maxLength: 5 }),
        fc.integer({ min: 1, max: 4 }),
        async (tenantId, idempotencyKeys, repeatsPerKey) => {
          const secret = `secret_${tenantId}`;
          const client = new MockIntakeClient({
            secret,
            expectedTenantId: tenantId,
            now: () => CLOCK_MS,
          });

          const base = fc.sample(validPayloadArb(tenantId, CLOCK_MS), 1)[0];
          const referenceByKey = new Map<string, string | undefined>();

          for (const key of idempotencyKeys) {
            const payload: VoiceIntakePayload = { ...base, idempotencyKey: key };

            const first = await client.submit(payload, secret);
            expect(first.status).toBe("accepted");
            referenceByKey.set(key, first.reference);

            for (let i = 0; i < repeatsPerKey; i++) {
              const replay = await client.submit(payload, secret);
              expect(replay.status).toBe("accepted");
              expect(replay.reference).toBe(referenceByKey.get(key));
            }
          }

          // One order per distinct key, none added by the repeats.
          expect(client.getOrdersCreated()).toBe(idempotencyKeys.length);
        }
      ),
      { numRuns: 100 }
    );
  });
});
