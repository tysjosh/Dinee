// Feature: dinee-campus, Property 34: Near-limit warning threshold
/**
 * Feature: dinee-campus, Property 34: Near-limit warning threshold
 *
 * Validates: Requirements 13.2
 *
 * For any usage value and limit, the Usage_Meter SHALL present the "nearly
 * reached" warning if and only if usage is at or above 80 percent of the limit
 * and strictly below the limit.
 *
 * The pure decision under test is {@link isNearLimit}. The property asserts the
 * biconditional against an independent reference computation: the warning is
 * presented exactly when `usage >= 0.8 * limit && usage < limit` for a finite
 * limit, and never when the limit is non-finite (e.g. an unbounded paid tier).
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  isNearLimit,
  NEAR_LIMIT_WARNING_FRACTION,
} from "../../../convex/campus/logic/usage";

/**
 * Finite, non-negative usage values spanning below, within, and above any
 * plausible limit band, including fractional minutes.
 */
const usageArb: fc.Arbitrary<number> = fc.double({
  min: 0,
  max: 1000,
  noNaN: true,
});

/**
 * Positive, finite limit values (a Usage_Limit is always a positive quota).
 */
const finiteLimitArb: fc.Arbitrary<number> = fc.double({
  min: 1,
  max: 1000,
  noNaN: true,
});

describe("Property 34: Near-limit warning threshold", () => {
  it("presents the warning iff usage is in [80% of limit, limit) for a finite limit", () => {
    fc.assert(
      fc.property(usageArb, finiteLimitArb, (usage, limit) => {
        const expected =
          usage >= NEAR_LIMIT_WARNING_FRACTION * limit && usage < limit;
        expect(isNearLimit(usage, limit)).toBe(expected);
      }),
      { numRuns: 100 }
    );
  });

  it("never presents the warning when the limit is non-finite (unbounded tier)", () => {
    const nonFiniteLimitArb = fc.constantFrom(
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.NaN
    );
    fc.assert(
      fc.property(usageArb, nonFiniteLimitArb, (usage, limit) => {
        expect(isNearLimit(usage, limit)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });
});
