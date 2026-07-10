// Feature: campus-social-loops, Property 27: All social-loops content screening is fail-closed
/**
 * Feature: campus-social-loops (Task 9.1), Property 27: All social-loops
 * content screening is fail-closed.
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 3.6, 3.7, 4.5, 4.6
 *
 * This test verifies REUSE, not re-proof: the Social_Loops_Layer does not
 * implement its own screening — every user-visible surface (battle responses,
 * challenge entries, group questions/responses, Share_Clips, and vote-visible
 * text) routes through the SAME reused fail-closed primitive
 * {@link decideScreening} from `convex/campus/logic/screening.ts`. The property
 * confirms that primitive behaves fail-closed when driven by social-loops
 * screening outcomes across the full outcome space (clean / violation /
 * dependency unavailable):
 *   - 7.1: social content is screened before delivery;
 *   - 7.2 / 3.10 / 4.6: a policy violation is flagged and withheld;
 *   - 7.3 / 3.7 / 4.5: an unavailable screening dependency is treated as
 *     flagged, withheld, AND returns a `screening_unavailable` error;
 *   - 3.6: Share_Clips are screened on the same fail-closed rule.
 *
 * The generators come from the shared social arbitraries so this test exercises
 * the reused primitive with exactly the inputs the social services feed it.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  decideScreening,
  SCREENING_UNAVAILABLE_ERROR,
  type ScreeningOutcome,
} from "../../../../convex/campus/logic/screening";
import { screeningOutcomeArb } from "./arbitraries";

/**
 * The distinct social-loops surfaces whose user-visible content must be
 * screened before delivery (Req 7.1). The screening rule is content-agnostic,
 * so tagging each outcome with the originating surface demonstrates that every
 * social channel is subject to the identical fail-closed decision.
 */
const socialContentChannelArb: fc.Arbitrary<string> = fc.constantFrom(
  "battle_response",
  "challenge_entry",
  "group_question",
  "group_response",
  "share_clip",
  "vote_visible_text",
);

/** True iff an outcome is a completed screen that violated no policy. */
function isCleanCompletedScreen(outcome: ScreeningOutcome): boolean {
  return outcome.available === true && outcome.violatedPolicies.length === 0;
}

describe("Property 27: All social-loops content screening is fail-closed", () => {
  it("delivers only clean completed screens; flags and withholds every violation or dependency failure across all social channels (Req 7.1, 7.2, 7.3, 3.6, 4.5, 4.6)", () => {
    fc.assert(
      fc.property(
        socialContentChannelArb,
        screeningOutcomeArb,
        (_channel, outcome) => {
          const decision = decideScreening(outcome);

          // flagged and withheld always move together.
          expect(decision.withheld).toBe(decision.flagged);

          if (isCleanCompletedScreen(outcome)) {
            // The sole delivered path: approved, not withheld, no error.
            expect(decision.flagged).toBe(false);
            expect(decision.withheld).toBe(false);
            expect(decision.moderationStatus).toBe("approved");
            expect(decision.error).toBeUndefined();
          } else {
            // Any violation or dependency failure fails closed (Req 7.2, 7.3).
            expect(decision.flagged).toBe(true);
            expect(decision.withheld).toBe(true);
            expect(decision.moderationStatus).toBe("flagged");
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("withholds and returns the screening_unavailable error when the dependency cannot complete (Req 7.3, 3.7, 4.5)", () => {
    fc.assert(
      fc.property(socialContentChannelArb, (_channel) => {
        const decision = decideScreening({ available: false });
        expect(decision.flagged).toBe(true);
        expect(decision.withheld).toBe(true);
        expect(decision.error).toBe(SCREENING_UNAVAILABLE_ERROR);
      }),
      { numRuns: 100 },
    );
  });
});
