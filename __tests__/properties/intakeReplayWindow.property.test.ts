/**
 * Feature: dinee-voice-platform, Property 21: Replay-window freshness
 *
 * Validates: Requirements 11.5
 *
 * IF an intake request's timestamp is outside the accepted freshness window,
 * THEN THE Voice_Intake_Adapter SHALL reject the request as a replay and SHALL
 * NOT create an order; a request whose timestamp is inside the window (and is
 * otherwise valid) is accepted.
 *
 * Exercised on the Dinee side via the Mock_Intake_Client (Req 20.6) with a
 * fixed clock. The mock verifies the transmitted HMAC first (so every payload
 * here is signed with the correct secret to isolate freshness), then evaluates
 * the client timestamp against `freshnessWindowMs`: a timestamp differing from
 * the clock by more than the window is rejected with httpStatus 400 and creates
 * no order; a timestamp within the window (correct secret, matching tenant,
 * required fields present) is accepted with httpStatus 200 and creates one order.
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
 * Builds an otherwise-valid intake payload bound to `tenantId` with the given
 * `timestamp`. Every field required by the contract is populated so the only
 * relevant behavior under test is replay-window freshness.
 */
function payloadAtTimestampArb(
  tenantId: string,
  timestamp: number
): fc.Arbitrary<VoiceIntakePayload> {
  return fc.record({
    schemaVersion: fc.constantFrom("1.0.0", "1.2.0", "2.0.0"),
    tenantId: fc.constant(tenantId),
    idempotencyKey: nonEmptyStringArb,
    timestamp: fc.constant(timestamp),
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

/** Fixed clock the mock evaluates freshness against. */
const CLOCK_MS = 1_700_000_000_000;
/** Fixed freshness half-window used across the suite. */
const WINDOW_MS = 5 * 60 * 1000; // five minutes

describe("Property 21: Replay-window freshness", () => {
  it("rejects a timestamp outside the freshness window as a replay and creates no order", async () => {
    await fc.assert(
      fc.asyncProperty(
        nonEmptyStringArb, // tenantId / signing secret seed
        // Magnitude strictly greater than the window so |offset| > WINDOW_MS.
        fc.integer({ min: 1, max: 30 * 24 * 60 * 60 * 1000 }),
        fc.boolean(), // direction: past (replay) or future
        async (tenantId, excess, inFuture) => {
          const secret = `secret_${tenantId}`;
          const client = new MockIntakeClient({
            secret,
            expectedTenantId: tenantId,
            freshnessWindowMs: WINDOW_MS,
            now: () => CLOCK_MS,
          });

          const offset = WINDOW_MS + excess; // strictly outside the window
          const timestamp = inFuture ? CLOCK_MS + offset : CLOCK_MS - offset;

          const payload = fc.sample(payloadAtTimestampArb(tenantId, timestamp), 1)[0];

          // Signed with the correct secret, so HMAC passes and freshness is the
          // deciding check.
          const result = await client.submit(payload, secret);

          expect(result.status).toBe("rejected");
          expect(result.httpStatus).toBe(400); // replay / stale timestamp
          expect(result.reference).toBeUndefined();
          // No order is created for a rejected replay.
          expect(client.getOrdersCreated()).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("accepts an otherwise-valid request whose timestamp is inside the freshness window", async () => {
    await fc.assert(
      fc.asyncProperty(
        nonEmptyStringArb, // tenantId / signing secret seed
        // Magnitude within the window so |offset| <= WINDOW_MS.
        fc.integer({ min: 0, max: WINDOW_MS }),
        fc.boolean(), // direction: slightly past or slightly future
        async (tenantId, within, inFuture) => {
          const secret = `secret_${tenantId}`;
          const client = new MockIntakeClient({
            secret,
            expectedTenantId: tenantId,
            freshnessWindowMs: WINDOW_MS,
            now: () => CLOCK_MS,
          });

          const timestamp = inFuture ? CLOCK_MS + within : CLOCK_MS - within;

          const payload = fc.sample(payloadAtTimestampArb(tenantId, timestamp), 1)[0];

          const result = await client.submit(payload, secret);

          expect(result.status).toBe("accepted");
          expect(result.httpStatus).toBe(200);
          expect(result.reference).toBeDefined();
          // Exactly one order is created for the accepted request.
          expect(client.getOrdersCreated()).toBe(1);
        }
      ),
      { numRuns: 100 }
    );
  });
});
