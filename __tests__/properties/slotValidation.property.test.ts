// Feature: dinee-voice-platform, Property 9: Invalid slot values are never recorded — for any value failing a slot validator, it is absent from the transient draft and the slot stays unresolved
//
// Validates: Requirements 5.10
//
// Req 5.10: IF the caller provides a value for a required slot that fails
// validation, THEN THE Fuel_Intake_Agent SHALL re-request the slot, SHALL NOT
// record the invalid value on the Order_Draft, and SHALL inform the caller that
// the value was not accepted.
//
// This property exercises the pure `buildOrderDraft` builder: for any raw slot
// value that fails the slot's own validator, the value must be absent from the
// produced draft's `slots`, and the slot must remain unresolved (never recorded,
// and — when required and past the retry limit — surfaced as missing).
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
 * Raw values biased toward ones that tend to FAIL a slot validator: empty and
 * whitespace-only strings (fail `nonEmpty`), non-numeric / non-positive text
 * (fail `validateQuantity`), and words outside the urgency enum (fail
 * `validateUrgency`). A random string is mixed in so the space is not degenerate.
 * The property itself preconditions on the validator actually rejecting the
 * value, so only genuinely-invalid inputs are asserted on.
 */
const invalidLeaningRawArb: fc.Arbitrary<string> = fc.oneof(
  fc.constant(""),
  fc.constant("   "),
  fc.constantFrom("\t", "\n", " \t \n ", "     "),
  fc.constantFrom("0", "-1", "-100", "0.0", "abc", "!!!", "zero", "gallons", "soon", "critical"),
  fc.string()
);

/** Request counts spanning below and at/above the retry limit (Req 5.9). */
const requestCountArb: fc.Arbitrary<number> = fc.integer({ min: 0, max: SLOT_MAX_REQUESTS + 3 });

describe("Property 9: Invalid slot values are never recorded", () => {
  it("never records a value that fails its slot validator, and the slot stays unresolved", () => {
    fc.assert(
      fc.property(
        slotKeyArb,
        invalidLeaningRawArb,
        requestCountArb,
        tenantArb,
        fc.double({ min: 0, max: 1, noNaN: true }),
        (key, rawValue, requestCount, tenant, confidenceScore) => {
          const definition = getSlotDefinition(key)!;

          // Only assert on values the validator genuinely rejects (Req 5.10).
          fc.pre(!definition.validate(rawValue).ok);

          const draft = buildOrderDraft(
            {
              slots: { [key]: { rawValue, requestCount } },
              confidenceScore,
            },
            tenant
          );

          // The invalid value is NOT recorded on the draft (Req 5.10).
          expect(Object.prototype.hasOwnProperty.call(draft.slots, key)).toBe(false);

          // The slot stays unresolved: for a required slot at/over the retry
          // limit, "unresolved" surfaces as being marked missing (Req 5.9);
          // otherwise it is simply absent from both slots and missingSlots.
          const isRequired = definition.required(tenant);
          if (isRequired && requestCount >= definition.maxRequests) {
            expect(draft.missingSlots).toContain(key);
          } else {
            expect(draft.missingSlots).not.toContain(key);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("does not record any invalid value even when many slots are invalid at once", () => {
    // A whole-draft variant: fill every slot with an invalid value and assert
    // none of them are recorded (Req 5.10).
    fc.assert(
      fc.property(tenantArb, requestCountArb, (tenant, requestCount) => {
        const invalidBySlot: Record<SlotKey, string> = {
          customer: "   ",
          delivery_site: "",
          product_code: "  ",
          quantity: "not-a-number",
          delivery_window: "\t",
          po_number: "   ",
          urgency: "whenever",
        };

        const slots = Object.fromEntries(
          (Object.keys(invalidBySlot) as SlotKey[]).map((key) => [
            key,
            { rawValue: invalidBySlot[key], requestCount },
          ])
        );

        const draft = buildOrderDraft({ slots, confidenceScore: 0.5 }, tenant);

        // No invalid value was recorded for any slot.
        expect(Object.keys(draft.slots)).toHaveLength(0);
      }),
      { numRuns: 100 }
    );
  });
});
