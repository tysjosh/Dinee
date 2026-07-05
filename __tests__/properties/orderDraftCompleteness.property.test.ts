/**
 * Feature: dinee-voice-platform, Property 11: Draft completeness, urgency enum, and slot inclusion
 *
 * **Validates: Requirements 5.6, 5.7, 5.8, 5.11**
 *
 * For any tenant configuration and any set of collected slot values,
 * `buildOrderDraft` produces an Order_Draft such that:
 * - Req 5.11: `slots` contains every collected (validated) slot value.
 * - Req 5.7: `urgency` is exactly one of `normal`, `urgent`, or `emergency`.
 * - Req 5.8: `confidenceScore` is within the inclusive range 0.0 to 1.0.
 * - Req 5.6 / 5.8: when the tenant requires a purchase-order number and it has
 *   not been collected, no complete Order_Draft is produced
 *   (`isOrderDraftComplete` returns false).
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  buildOrderDraft,
  isOrderDraftComplete,
  RUNSHEET_SLOT_DEFINITIONS,
  URGENCY_LEVELS,
  type OrderDraftInput,
  type RunsheetTenantConfig,
  type SlotCollectionState,
  type SlotKey,
  type UrgencyLevel,
} from "../../src/lib/modules/packs/runsheet/slots";

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const SLOT_KEYS: SlotKey[] = RUNSHEET_SLOT_DEFINITIONS.map((d) => d.key);

const urgencyArb = fc.constantFrom<UrgencyLevel>(...URGENCY_LEVELS);

const tenantArb: fc.Arbitrary<RunsheetTenantConfig> = fc.record({
  requiresPurchaseOrder: fc.boolean(),
});

/**
 * A raw value known to VALIDATE for a given slot, so the resulting value is
 * recorded on the draft (Req 5.11). Chosen per slot to satisfy each validator.
 */
function validRawArb(key: SlotKey): fc.Arbitrary<string> {
  switch (key) {
    case "quantity":
      // Positive gallons or a fill-to-full phrase.
      return fc.oneof(
        fc.integer({ min: 1, max: 50_000 }).map((n) => `${n}`),
        fc.constantFrom("fill to full", "fill up", "top off", "full tank")
      );
    case "urgency":
      return fc.constantFrom<UrgencyLevel>(...URGENCY_LEVELS);
    case "product_code":
      return fc.constantFrom("dsl", "reg-87", "prem", "diesel", "b20");
    default:
      // Non-empty free-text slots (customer, delivery_site, delivery_window, po_number).
      return fc.constantFrom(
        "Acme Fuels",
        "Site 12",
        "tomorrow 9am",
        "PO-12345",
        "callback 5551234"
      );
  }
}

/** A raw value known to FAIL validation for a given slot (never recorded, Req 5.10). */
function invalidRawArb(key: SlotKey): fc.Arbitrary<string> {
  switch (key) {
    case "quantity":
      // Zero, negative, or non-numeric text that is not a fill-to-full phrase.
      return fc.constantFrom("0", "-5", "zero", "banana", "   ");
    case "urgency":
      return fc.constantFrom("kinda", "asap", "high", "low", "   ");
    default:
      // Empty / whitespace-only for non-empty text slots.
      return fc.constantFrom("", "   ", "\t", "\n");
  }
}

const requestCountArb = fc.integer({ min: 0, max: 6 });

/**
 * Collection state for one slot: either omitted, a valid raw value, or an
 * invalid raw value, each with some request count.
 */
function slotStateArb(key: SlotKey): fc.Arbitrary<SlotCollectionState | undefined> {
  return fc.oneof(
    fc.constant(undefined),
    fc.record({
      rawValue: validRawArb(key),
      requestCount: requestCountArb,
    }),
    fc.record({
      rawValue: invalidRawArb(key),
      requestCount: requestCountArb,
    })
  );
}

/** Arbitrary confidence score, deliberately spanning outside [0,1] and non-finite. */
const confidenceArb = fc.oneof(
  fc.double({ min: 0, max: 1, noNaN: true }),
  fc.double({ min: -1000, max: 1000 }), // may be < 0 or > 1
  fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY)
);

const slotsRecordArb: fc.Arbitrary<Partial<Record<SlotKey, SlotCollectionState>>> = fc
  .tuple(...SLOT_KEYS.map((key) => slotStateArb(key)))
  .map((states) => {
    const record: Partial<Record<SlotKey, SlotCollectionState>> = {};
    SLOT_KEYS.forEach((key, idx) => {
      const state = states[idx];
      if (state !== undefined) record[key] = state;
    });
    return record;
  });

const inputArb: fc.Arbitrary<OrderDraftInput> = fc.record({
  slots: slotsRecordArb,
  urgency: fc.oneof(fc.constant(undefined), urgencyArb),
  confidenceScore: confidenceArb,
});

/**
 * Recomputes, independently of the implementation, which validated values the
 * input should yield. Used to assert every collected value is recorded (Req 5.11).
 */
function expectedCollectedKeys(input: OrderDraftInput): SlotKey[] {
  const collected: SlotKey[] = [];
  for (const definition of RUNSHEET_SLOT_DEFINITIONS) {
    const state = input.slots[definition.key];
    if (state?.rawValue !== undefined && definition.validate(state.rawValue).ok) {
      collected.push(definition.key);
    }
  }
  return collected;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Property 11: Draft completeness, urgency enum, and slot inclusion", () => {
  it("records every collected (validated) slot value in draft.slots (Req 5.11)", () => {
    fc.assert(
      fc.property(inputArb, tenantArb, (input, tenant) => {
        const draft = buildOrderDraft(input, tenant);
        for (const key of expectedCollectedKeys(input)) {
          const state = input.slots[key]!;
          const expected = (
            RUNSHEET_SLOT_DEFINITIONS.find((d) => d.key === key)!.validate(state.rawValue!) as {
              ok: true;
              value: unknown;
            }
          ).value;
          expect(Object.prototype.hasOwnProperty.call(draft.slots, key)).toBe(true);
          expect(draft.slots[key]).toEqual(expected);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("never records an invalid slot value in draft.slots (Req 5.10 / 5.11)", () => {
    fc.assert(
      fc.property(inputArb, tenantArb, (input, tenant) => {
        const draft = buildOrderDraft(input, tenant);
        const collected = new Set(expectedCollectedKeys(input));
        for (const key of Object.keys(draft.slots)) {
          expect(collected.has(key as SlotKey)).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("urgency is always exactly one of normal/urgent/emergency (Req 5.7)", () => {
    fc.assert(
      fc.property(inputArb, tenantArb, (input, tenant) => {
        const draft = buildOrderDraft(input, tenant);
        expect(URGENCY_LEVELS).toContain(draft.urgency);
      }),
      { numRuns: 100 }
    );
  });

  it("confidenceScore is always clamped into the inclusive range [0, 1] (Req 5.8)", () => {
    fc.assert(
      fc.property(inputArb, tenantArb, (input, tenant) => {
        const draft = buildOrderDraft(input, tenant);
        expect(Number.isFinite(draft.confidenceScore)).toBe(true);
        expect(draft.confidenceScore).toBeGreaterThanOrEqual(0);
        expect(draft.confidenceScore).toBeLessThanOrEqual(1);
      }),
      { numRuns: 100 }
    );
  });

  it("is not complete when the tenant requires a PO number that was not collected (Req 5.6 / 5.8)", () => {
    // Build inputs where every OTHER required slot is validly collected, but the
    // PO number is either omitted or invalid, and the tenant requires a PO.
    const nonPoValidStatesArb = fc
      .tuple(
        ...SLOT_KEYS.filter((k) => k !== "po_number").map((key) =>
          fc.record({ rawValue: validRawArb(key), requestCount: requestCountArb })
        )
      )
      .map((states) => {
        const record: Partial<Record<SlotKey, SlotCollectionState>> = {};
        SLOT_KEYS.filter((k) => k !== "po_number").forEach((key, idx) => {
          record[key] = states[idx];
        });
        return record;
      });

    const poUncollectedArb = fc.oneof(
      fc.constant(undefined),
      fc.record({ rawValue: invalidRawArb("po_number"), requestCount: requestCountArb })
    );

    fc.assert(
      fc.property(
        nonPoValidStatesArb,
        poUncollectedArb,
        confidenceArb,
        (baseSlots, poState, confidenceScore) => {
          const slots: Partial<Record<SlotKey, SlotCollectionState>> = { ...baseSlots };
          if (poState !== undefined) slots.po_number = poState;

          const tenant: RunsheetTenantConfig = { requiresPurchaseOrder: true };
          const draft = buildOrderDraft({ slots, confidenceScore }, tenant);

          // PO was not validly collected → draft must not be complete.
          expect(Object.prototype.hasOwnProperty.call(draft.slots, "po_number")).toBe(false);
          expect(isOrderDraftComplete(draft, tenant)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("is complete when all required slots (including PO where required) are collected (Req 5.6 / 5.8)", () => {
    const allValidStatesArb = fc
      .tuple(
        ...SLOT_KEYS.map((key) =>
          fc.record({ rawValue: validRawArb(key), requestCount: requestCountArb })
        )
      )
      .map((states) => {
        const record: Partial<Record<SlotKey, SlotCollectionState>> = {};
        SLOT_KEYS.forEach((key, idx) => {
          record[key] = states[idx];
        });
        return record;
      });

    fc.assert(
      fc.property(allValidStatesArb, tenantArb, confidenceArb, (slots, tenant, confidenceScore) => {
        const draft = buildOrderDraft({ slots, confidenceScore }, tenant);
        // Every required slot has a validly collected value → complete.
        expect(isOrderDraftComplete(draft, tenant)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("all Property 11 invariants hold simultaneously for any input", () => {
    fc.assert(
      fc.property(inputArb, tenantArb, (input, tenant) => {
        const draft = buildOrderDraft(input, tenant);

        // Req 5.7 — urgency enum
        expect(URGENCY_LEVELS).toContain(draft.urgency);

        // Req 5.8 — confidence in [0, 1]
        expect(draft.confidenceScore).toBeGreaterThanOrEqual(0);
        expect(draft.confidenceScore).toBeLessThanOrEqual(1);

        // Req 5.11 — recorded slots are exactly the validated collected ones
        const collected = new Set(expectedCollectedKeys(input));
        expect(new Set(Object.keys(draft.slots))).toEqual(collected);

        // Req 5.6 — completeness requires every required slot present
        const requiredKeys = RUNSHEET_SLOT_DEFINITIONS.filter((d) => d.required(tenant)).map(
          (d) => d.key
        );
        const complete = isOrderDraftComplete(draft, tenant);
        const allRequiredPresent = requiredKeys.every((k) =>
          Object.prototype.hasOwnProperty.call(draft.slots, k)
        );
        expect(complete).toBe(allRequiredPresent);
      }),
      { numRuns: 100 }
    );
  });
});
