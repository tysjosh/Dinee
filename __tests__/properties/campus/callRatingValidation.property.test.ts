// Feature: dinee-campus, Property 18: Call-rating validation
/**
 * Feature: dinee-campus, Property 18: Call-rating validation
 *
 * Validates: Requirements 8.10, 8.11
 *
 * For any submitted call rating value, the system SHALL accept and associate it
 * with the completed call if and only if the value is an integer in the
 * inclusive range 1..5; otherwise it SHALL reject the rating and indicate that
 * the rating must be an integer from 1 to 5.
 *
 * The pure gate under test is {@link isValidCallRating}. `true` models "accept
 * and associate with the completed call" (Req 8.10); `false` models "reject and
 * indicate the rating must be an integer from 1 to 5" (Req 8.11). The property
 * asserts the biconditional: isValidCallRating(v) is true exactly when v is an
 * integer in [1, 5].
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  isValidCallRating,
  RATING_MIN,
  RATING_MAX,
} from "../../../convex/campus/logic/validation";

/** Reference oracle: an integer within the inclusive [1, 5] range. */
function isAcceptableRating(value: unknown): boolean {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= RATING_MIN &&
    value <= RATING_MAX
  );
}

/**
 * Arbitrary spanning the full space of "submitted rating values": in-range and
 * out-of-range integers, non-integer numbers, the numeric edge values (NaN,
 * ±Infinity, -0), and non-number types (strings, booleans, null, undefined,
 * objects, arrays). This exercises both branches of the biconditional.
 */
const ratingCandidateArb: fc.Arbitrary<unknown> = fc.oneof(
  // Valid ratings and their immediate out-of-range integer neighbours.
  fc.integer({ min: -10, max: 20 }),
  // Non-integer numbers (e.g. 3.5) which must be rejected.
  fc.double({ noNaN: true }).filter((n) => !Number.isInteger(n)),
  // Numeric edge cases.
  fc.constantFrom(NaN, Infinity, -Infinity, -0, 0),
  // Numeric strings that look like ratings but are the wrong type.
  fc.constantFrom("1", "3", "5", ""),
  // Other non-number types.
  fc.boolean(),
  fc.constantFrom(null, undefined),
  fc.object({ maxDepth: 1 }),
  fc.array(fc.integer(), { maxLength: 3 })
);

describe("Property 18: Call-rating validation", () => {
  it("accepts a rating iff it is an integer in the inclusive range 1..5", () => {
    fc.assert(
      fc.property(ratingCandidateArb, (candidate) => {
        expect(isValidCallRating(candidate)).toBe(isAcceptableRating(candidate));
      }),
      { numRuns: 100 }
    );
  });

  it("accepts every integer in [1, 5]", () => {
    fc.assert(
      fc.property(fc.integer({ min: RATING_MIN, max: RATING_MAX }), (rating) => {
        expect(isValidCallRating(rating)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("rejects integers outside [1, 5]", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ max: RATING_MIN - 1 }),
          fc.integer({ min: RATING_MAX + 1 })
        ),
        (rating) => {
          expect(isValidCallRating(rating)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("rejects in-range non-integer numbers (e.g. 3.5)", () => {
    fc.assert(
      fc.property(
        fc
          .double({ min: RATING_MIN, max: RATING_MAX, noNaN: true })
          .filter((n) => !Number.isInteger(n)),
        (rating) => {
          expect(isValidCallRating(rating)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});
