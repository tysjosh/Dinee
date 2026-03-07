/**
 * Feature: ai-reception-os-pivot, Property 4: Backward Compatibility — Dual ID Normalization
 *
 * Validates: Requirements 2.6, 17.4, 17.5, 17.6
 *
 * For any valid API request payload:
 *   - normalizeBusinessId({ restaurantId: id }) SHALL produce businessId === id
 *   - normalizeBusinessId({ businessId: id }) SHALL produce businessId === id
 *   - usedDeprecatedField SHALL be true for restaurantId, false for businessId
 *   - normalizeBusinessId({}) SHALL throw
 *   - enrichResponseWithDualIds SHALL include both restaurantId and businessId
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { normalizeBusinessId } from "../../src/lib/partner-api/dualIdSupport";
import { enrichResponseWithDualIds } from "../../src/lib/partner-api/deprecationHeaders";

/** Arbitrary: a random non-empty string to use as an ID */
const idArb = fc.string({ minLength: 1, maxLength: 100 });

describe("Property 4: Backward Compatibility — Dual ID Normalization", () => {
  it("normalizeBusinessId({ restaurantId: id }).businessId === id", () => {
    fc.assert(
      fc.property(idArb, (id) => {
        const result = normalizeBusinessId({ restaurantId: id });
        expect(result.businessId).toBe(id);
      }),
      { numRuns: 100 }
    );
  });

  it("normalizeBusinessId({ businessId: id }).businessId === id", () => {
    fc.assert(
      fc.property(idArb, (id) => {
        const result = normalizeBusinessId({ businessId: id });
        expect(result.businessId).toBe(id);
      }),
      { numRuns: 100 }
    );
  });

  it("usedDeprecatedField is true for restaurantId, false for businessId", () => {
    fc.assert(
      fc.property(idArb, (id) => {
        const fromRestaurant = normalizeBusinessId({ restaurantId: id });
        const fromBusiness = normalizeBusinessId({ businessId: id });

        expect(fromRestaurant.usedDeprecatedField).toBe(true);
        expect(fromBusiness.usedDeprecatedField).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it("normalizeBusinessId({}) throws an error", () => {
    expect(() => normalizeBusinessId({})).toThrow(
      "Either businessId or restaurantId is required"
    );
  });

  it("enrichResponseWithDualIds includes both restaurantId and businessId", () => {
    fc.assert(
      fc.property(idArb, (id) => {
        const body = { someField: "value" };
        const enriched = enrichResponseWithDualIds(body, id);

        expect(enriched.restaurantId).toBe(id);
        expect(enriched.businessId).toBe(id);
        expect(enriched.someField).toBe("value");
      }),
      { numRuns: 100 }
    );
  });
});
