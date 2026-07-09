// Feature: dinee-campus, Property 28: Content screening is fail-closed
/**
 * Feature: dinee-campus, Property 28: Content screening is fail-closed
 *
 * Validates: Requirements 11.7, 11.8, 11.9
 *
 * For any screened Knowledge_Source or caller voice content, if the content is
 * classified as violating a policy, OR if the screening dependency is
 * unavailable, the content SHALL be marked flagged and withheld from delivery
 * (excluded from grounding), and a dependency failure SHALL additionally return
 * an error indication that screening could not complete (Req 11.7, 11.8, 11.9).
 *
 * The pure function under test is {@link decideScreening}. The generators cover
 * the full input space of {@link ScreeningOutcome}:
 *   - available screens with zero violations (the sole approved path),
 *   - available screens with one or more policy violations,
 *   - unavailable screens (dependency failure),
 * plus defensively-malformed outcomes that must fail closed.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  decideScreening,
  SCREENING_POLICIES,
  SCREENING_UNAVAILABLE_ERROR,
  type ScreeningOutcome,
  type ScreeningPolicy,
} from "../../../convex/campus/logic/screening";

/** A single valid screening policy (profanity | harassment | sexual). */
const policyArb: fc.Arbitrary<ScreeningPolicy> = fc.constantFrom(
  ...SCREENING_POLICIES
);

/** A completed screen that reported at least one policy violation (Req 11.8). */
const violatingOutcomeArb: fc.Arbitrary<ScreeningOutcome> = fc
  .array(policyArb, { minLength: 1, maxLength: SCREENING_POLICIES.length })
  .map((violatedPolicies) => ({ available: true, violatedPolicies }));

/** A completed screen that reported no violations (the sole approved path). */
const cleanOutcomeArb: fc.Arbitrary<ScreeningOutcome> = fc.constant({
  available: true,
  violatedPolicies: [],
});

/** A screen whose dependency was unavailable (Req 11.9). */
const unavailableOutcomeArb: fc.Arbitrary<ScreeningOutcome> = fc.constant({
  available: false,
});

/** The full, well-formed outcome space handed to {@link decideScreening}. */
const outcomeArb: fc.Arbitrary<ScreeningOutcome> = fc.oneof(
  cleanOutcomeArb,
  violatingOutcomeArb,
  unavailableOutcomeArb
);

describe("Property 28: Content screening is fail-closed", () => {
  it("flags and withholds on any policy violation OR dependency failure, and only approves clean completed screens (Req 11.7, 11.8, 11.9)", () => {
    fc.assert(
      fc.property(outcomeArb, (outcome) => {
        const decision = decideScreening(outcome);

        // flagged and withheld always move together.
        expect(decision.withheld).toBe(decision.flagged);

        const isCleanCompletedScreen =
          outcome.available === true && outcome.violatedPolicies.length === 0;

        if (isCleanCompletedScreen) {
          // The ONLY outcome that is delivered: approved, not withheld, no error.
          expect(decision.flagged).toBe(false);
          expect(decision.withheld).toBe(false);
          expect(decision.moderationStatus).toBe("approved");
          expect(decision.violatedPolicies).toEqual([]);
          expect(decision.error).toBeUndefined();
        } else {
          // Any violation or dependency failure fails closed (Req 11.8, 11.9).
          expect(decision.flagged).toBe(true);
          expect(decision.withheld).toBe(true);
          expect(decision.moderationStatus).toBe("flagged");
        }
      }),
      { numRuns: 100 }
    );
  });

  it("carries the violated policies and returns no error for completed violating screens (Req 11.8)", () => {
    fc.assert(
      fc.property(violatingOutcomeArb, (outcome) => {
        const decision = decideScreening(outcome);
        expect(decision.flagged).toBe(true);
        expect(decision.withheld).toBe(true);
        // A completed screen carries policy detail and no dependency error.
        expect(decision.error).toBeUndefined();
        if (outcome.available === true) {
          expect(decision.violatedPolicies).toEqual(outcome.violatedPolicies);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("returns the screening_unavailable error only on dependency failure (Req 11.9)", () => {
    fc.assert(
      fc.property(unavailableOutcomeArb, (outcome) => {
        const decision = decideScreening(outcome);
        expect(decision.flagged).toBe(true);
        expect(decision.withheld).toBe(true);
        expect(decision.error).toBe(SCREENING_UNAVAILABLE_ERROR);
      }),
      { numRuns: 100 }
    );
  });

  it("fails closed on defensively-malformed outcomes (unknown/unavailable shapes) (Req 11.9)", () => {
    // Outcomes that are not a well-formed available classification must be
    // treated as a dependency failure so unscreened content is never delivered.
    const malformedArb: fc.Arbitrary<unknown> = fc.oneof(
      fc.constant(null),
      fc.constant(undefined),
      fc.constant({}),
      fc.constant({ available: true }), // missing violatedPolicies
      fc.constant({ available: "yes", violatedPolicies: [] }), // non-boolean
      fc.record({ available: fc.constant(true), violatedPolicies: fc.string() }) // wrong type
    );

    fc.assert(
      fc.property(malformedArb, (bad) => {
        const decision = decideScreening(bad as ScreeningOutcome);
        expect(decision.flagged).toBe(true);
        expect(decision.withheld).toBe(true);
        expect(decision.moderationStatus).toBe("flagged");
        expect(decision.error).toBe(SCREENING_UNAVAILABLE_ERROR);
      }),
      { numRuns: 100 }
    );
  });
});
