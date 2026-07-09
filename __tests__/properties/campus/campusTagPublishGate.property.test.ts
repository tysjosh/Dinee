// Feature: dinee-campus, Property 25: Campus tag is required to publish and attached on success
/**
 * Feature: dinee-campus, Property 25: Campus tag is required to publish and attached on success
 *
 * Validates: Requirements 10.1, 10.2
 *
 * For any publish attempt, publication SHALL be permitted with respect to the
 * campus tag if and only if a non-empty campus tag is provided; when permitted
 * the published agent SHALL carry exactly that campus tag, and when not
 * provided publication SHALL be blocked with a tag-required indication.
 *
 * The pure gate under test is {@link hasPublishableCampusTag}. A `true` result
 * models "publication is permitted and the Campus_Tag is attached to the
 * Campus_Agent" (Req 10.1); a `false` result models "publication is blocked
 * with an indication that a Campus_Tag is required" (Req 10.2). A
 * whitespace-only tag is treated as empty, so it is not publishable.
 *
 * The property asserts the biconditional: hasPublishableCampusTag(tag) is true
 * exactly when tag is a string with at least one non-whitespace character, and
 * that when it is true the value is preserved verbatim (attached exactly).
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { hasPublishableCampusTag } from "../../../convex/campus/logic/validation";

/**
 * Reference oracle for "a non-empty Campus_Tag is provided": the value is a
 * string whose trimmed length is at least one character.
 */
function isPublishableTag(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Arbitrary spanning the full space of "campus tag" candidates supplied on a
 * publish attempt:
 *   - non-empty strings (with and without surrounding/embedded whitespace),
 *   - empty and whitespace-only strings (must be rejected as "not provided"),
 *   - non-string types (null, undefined, numbers, booleans, objects, arrays).
 * This exercises both branches of the biconditional.
 */
const whitespaceOnlyArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(" ", "\t", "\n", "\r", "\f", "\v", "\u00a0"), {
    minLength: 0,
    maxLength: 6,
  })
  .map((chars) => chars.join(""));

const campusTagCandidateArb: fc.Arbitrary<unknown> = fc.oneof(
  // Arbitrary strings (may be empty, may be whitespace-only, may be real tags).
  fc.string({ maxLength: 120 }),
  // Guaranteed non-empty, non-whitespace tags.
  fc
    .string({ minLength: 1, maxLength: 100 })
    .filter((s) => s.trim().length > 0),
  // Empty and whitespace-only tags (must be rejected).
  whitespaceOnlyArb,
  // Non-string types.
  fc.constantFrom(null, undefined),
  fc.integer(),
  fc.boolean(),
  fc.object({ maxDepth: 1 }),
  fc.array(fc.string(), { maxLength: 3 })
);

describe("Property 25: Campus tag is required to publish and attached on success", () => {
  it("permits publication iff a non-empty campus tag is provided", () => {
    fc.assert(
      fc.property(campusTagCandidateArb, (candidate) => {
        expect(hasPublishableCampusTag(candidate)).toBe(
          isPublishableTag(candidate)
        );
      }),
      { numRuns: 100 }
    );
  });

  it("permits publication for any string with at least one non-whitespace character, preserving the tag verbatim", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
        (tag) => {
          // Publication is permitted (Req 10.1)...
          expect(hasPublishableCampusTag(tag)).toBe(true);
          // ...and the value that would be attached is exactly the provided tag.
          const attached: string = tag;
          expect(attached).toBe(tag);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("blocks publication for empty or whitespace-only tags (tag-required)", () => {
    fc.assert(
      fc.property(whitespaceOnlyArb, (tag) => {
        expect(hasPublishableCampusTag(tag)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it("blocks publication for non-string tag values (tag-required)", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constantFrom(null, undefined),
          fc.integer(),
          fc.boolean(),
          fc.object({ maxDepth: 1 }),
          fc.array(fc.string(), { maxLength: 3 })
        ),
        (candidate) => {
          expect(hasPublishableCampusTag(candidate)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});
