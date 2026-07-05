/**
 * Feature: dinee-voice-platform, Property 17: Intake required-field validation
 *
 * Validates: Requirements 10.5
 *
 * IF a voice-originated order is submitted without the call identifier, the
 * caller phone number, or the extracted slots, THEN THE Voice_Intake_Adapter
 * SHALL reject the order, return an error indicating the missing field, and
 * SHALL NOT create a Runsheet order.
 *
 * Exercised on the Dinee side via the Mock_Intake_Client (Req 20.6). The
 * Mock_Intake_Client validates required fields only after the HMAC signature,
 * replay window, tenant match, and idempotency checks pass, so each generated
 * payload is otherwise-valid (correct signing secret, matching tenant, fresh
 * timestamp, unique idempotency key) with exactly ONE of `callId`,
 * `callerPhone`, or `extractedSlots` missing/empty/invalid. The assertion is
 * that the submission is rejected with `httpStatus` 400, the error names the
 * offending field, and no order is created (`getOrdersCreated()` stays 0).
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { MockIntakeClient } from "../../src/lib/integrations/runsheet/mockIntakeClient";
import type { VoiceIntakePayload } from "../../src/lib/integrations/runsheet/voiceIntakeClient";

// --- Arbitraries ---

/** Non-empty strings so the fields we intend to keep valid always pass. */
const nonEmptyStringArb = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter((s) => s.trim().length > 0);

const transcriptTurnArb = fc.record({
  role: fc.constantFrom<"caller" | "agent">("caller", "agent"),
  text: fc.string({ maxLength: 60 }),
  at: fc.integer({ min: 0, max: 4_000_000_000_000 }),
});

const CLOCK_MS = 1_700_000_000_000;

/**
 * Builds a fully-valid intake payload bound to `tenantId` with a `timestamp`
 * inside the freshness window (equal to the mock's fixed clock). Every required
 * field is populated; the property mutates exactly one required field per run.
 */
function validPayloadArb(tenantId: string): fc.Arbitrary<VoiceIntakePayload> {
  return fc.record({
    schemaVersion: fc.constantFrom("1.0.0", "1.2.0", "2.0.0"),
    tenantId: fc.constant(tenantId),
    idempotencyKey: nonEmptyStringArb,
    timestamp: fc.constant(CLOCK_MS),
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

type RequiredField = "callId" | "callerPhone" | "extractedSlots";

/** How a string required field can be made invalid. */
const stringBreakArb = fc.constantFrom<"missing" | "empty">("missing", "empty");
/** How the `extractedSlots` object field can be made invalid. */
const slotsBreakArb = fc.constantFrom<"missing" | "null" | "array">(
  "missing",
  "null",
  "array"
);

/**
 * Given a valid payload, breaks exactly the named required field and returns
 * the mutated payload. The other required fields remain valid so the error the
 * mock returns must name `field`.
 */
function breakField(
  payload: VoiceIntakePayload,
  field: RequiredField,
  mode: string
): VoiceIntakePayload {
  const mutated: Record<string, unknown> = { ...payload };
  if (field === "extractedSlots") {
    if (mode === "missing") {
      mutated.extractedSlots = undefined;
    } else if (mode === "null") {
      mutated.extractedSlots = null;
    } else {
      mutated.extractedSlots = [];
    }
  } else {
    // callId or callerPhone
    mutated[field] = mode === "missing" ? undefined : "";
  }
  return mutated as unknown as VoiceIntakePayload;
}

describe("Property 17: Intake required-field validation", () => {
  it("rejects a payload missing callId/callerPhone/extractedSlots naming the field, creating no order", async () => {
    await fc.assert(
      fc.asyncProperty(
        nonEmptyStringArb, // tenantId / signing secret seed
        fc.constantFrom<RequiredField>("callId", "callerPhone", "extractedSlots"),
        fc.oneof(stringBreakArb, slotsBreakArb),
        async (tenantId, field, mode) => {
          // Only the (field, mode) combinations that are meaningful for the field.
          const stringModes = ["missing", "empty"];
          const slotModes = ["missing", "null", "array"];
          const applicable =
            field === "extractedSlots"
              ? slotModes.includes(mode)
              : stringModes.includes(mode);
          fc.pre(applicable);

          const secret = `secret_${tenantId}`;
          const client = new MockIntakeClient({
            secret,
            expectedTenantId: tenantId,
            now: () => CLOCK_MS,
          });

          const validPayload = fc.sample(validPayloadArb(tenantId), 1)[0];
          const brokenPayload = breakField(validPayload, field, mode);

          const result = await client.submit(brokenPayload, secret);

          // Rejected with the required-field 400 status.
          expect(result.status).toBe("rejected");
          expect(result.httpStatus).toBe(400);
          // The error names the offending field.
          expect(result.error).toBeDefined();
          expect(result.error).toContain(field);
          // No order was created.
          expect(client.getOrdersCreated()).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("accepts the otherwise-identical payload once the broken field is restored (control)", async () => {
    await fc.assert(
      fc.asyncProperty(
        nonEmptyStringArb,
        fc.constantFrom<RequiredField>("callId", "callerPhone", "extractedSlots"),
        async (tenantId, field) => {
          const secret = `secret_${tenantId}`;
          const client = new MockIntakeClient({
            secret,
            expectedTenantId: tenantId,
            now: () => CLOCK_MS,
          });

          const validPayload = fc.sample(validPayloadArb(tenantId), 1)[0];

          // Break, then confirm rejection with no order.
          const broken = breakField(validPayload, field, "missing");
          const rejected = await client.submit(broken, secret);
          expect(rejected.status).toBe("rejected");
          expect(rejected.httpStatus).toBe(400);
          expect(rejected.error).toContain(field);
          expect(client.getOrdersCreated()).toBe(0);

          // The restored, fully-valid payload is accepted and creates one order.
          const accepted = await client.submit(validPayload, secret);
          expect(accepted.status).toBe("accepted");
          expect(accepted.httpStatus).toBe(200);
          expect(client.getOrdersCreated()).toBe(1);
        }
      ),
      { numRuns: 100 }
    );
  });
});
