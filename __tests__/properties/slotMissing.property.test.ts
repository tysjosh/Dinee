// Feature: dinee-voice-platform, Property 10: Unresolved slots are marked missing after the retry limit — a slot unresolved after 3 requests appears in missingSlots
//
// Validates: Requirements 5.9
//
// Req 5.9: IF a required slot remains unresolved after the Fuel_Intake_Agent has
// requested that slot 3 times, THEN THE Fuel_Intake_Agent SHALL mark that slot as
// missing on the Order_Draft.
//
// This property exercises the pure `buildOrderDraft` builder: for any REQUIRED
// slot (per the tenant config) that is still unresolved — no value offered, or a
// value that fails validation — after it has been requested at least
// `SLOT_MAX_REQUESTS` (3) times, the slot key must appear in `missingSlots`.
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  buildOrderDraft,
  getSlotDefinition,
  RUNSHEET_SLOT_DEFINITIONS,
  SLOT_MAX_REQUESTS,
  type RunsheetTenantConfig,
  type SlotKey,
} from "../../src/lib/modules/packs/runsheet/slots";

/** Every slot key defined by the fuel-intake pack. */
const slotKeyArb: fc.Arbitrary<SlotKey> = fc.constantFrom(
  ...RUNSHEET_SLOT_DEFINITIONS.map((definition) => definition.key)
);

/** Tenant config — randomizes whether a purchase-order number is required (Req 5.6). */
const tenantArb: fc.Arbitrary<RunsheetTenantConfig> = fc.record({
  requiresPurchaseOrder: fc.boolean(),
});

/**
 * An "unresolved" raw value for a slot: either nothing offered (`undefined`) or
 * a value that fails validation. The property preconditions on the validator
 * actually rejecting any offered value, so the slot is guaranteed unresolved.
 */
const unresolvedRawArb: fc.Arbitrary<string | undefined> = fc.oneof(
  fc.constant(undefined),
  fc.constant(""),
  fc.constant("   "),
  fc.constantFrom("\t", "\n", "0", "-1", "abc", "whenever", "!!!")
);

/** Request counts at or beyond the retry limit (Req 5.9). */
const atOrOverLimitArb: fc.Arbitrary<number> = fc.integer({
  min: SLOT_MAX_REQUESTS,
  max: SLOT_MAX_REQUESTS + 5,
});

describe("Property 10: Unresolved slots are marked missing after the retry limit", () => {
  it("marks a required slot missing once it is unresolved after 3 requests", () => {
    fc.assert(
      fc.property(
        slotKeyArb,
        unresolvedRawArb,
        atOrOverLimitArb,
        tenantArb,
        fc.double({ min: 0, max: 1, noNaN: true }),
        (key, rawValue, requestCount, tenant, confidenceScore) => {
          const definition = getSlotDefinition(key)!;

          // Only consider slots that are REQUIRED for this tenant (Req 5.9).
          fc.pre(definition.required(tenant));
          // The slot must be genuinely unresolved: any offered value must fail
          // validation (an unoffered `undefined` value is unresolved by nature).
          fc.pre(rawValue === undefined || !definition.validate(rawValue).ok);

          const slotState =
            rawValue === undefined ? { requestCount } : { rawValue, requestCount };

          const draft = buildOrderDraft(
            {
              slots: { [key]: slotState },
              confidenceScore,
            },
            tenant
          );

          // The unresolved required slot appears in missingSlots (Req 5.9).
          expect(draft.missingSlots).toContain(key);
          // And it was never recorded as a collected value.
          expect(Object.prototype.hasOwnProperty.call(draft.slots, key)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("does not mark a slot missing before the retry limit is reached", () => {
    // Complementary boundary check: below 3 requests, an unresolved required
    // slot is not yet marked missing (Req 5.9).
    fc.assert(
      fc.property(
        slotKeyArb,
        fc.integer({ min: 0, max: SLOT_MAX_REQUESTS - 1 }),
        tenantArb,
        (key, requestCount, tenant) => {
          const definition = getSlotDefinition(key)!;
          fc.pre(definition.required(tenant));

          const draft = buildOrderDraft(
            {
              slots: { [key]: { requestCount } },
              confidenceScore: 0.5,
            },
            tenant
          );

          expect(draft.missingSlots).not.toContain(key);
        }
      ),
      { numRuns: 100 }
    );
  });
});
