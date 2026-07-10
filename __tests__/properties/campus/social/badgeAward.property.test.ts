// Feature: campus-social-loops, Property 21: A Badge is awarded exactly once at its threshold and retained thereafter
/**
 * Feature: campus-social-loops, Property 21: A Badge is awarded exactly once at
 * its threshold and retained thereafter
 *
 * Validates: Requirements 5.5, 5.8
 *
 * The pure logic under test is {@link evaluateBadgeAward} from
 * `convex/campus/social/logic/gamification.ts`, driven over both single
 * decisions and cumulative-count sequences (using {@link badgeCriteriaForActivity}
 * / {@link BADGE_CATALOG} to exercise real catalog thresholds).
 *
 * Req 5.5: when the tracked cumulative activity count first reaches or exceeds
 *   a Badge's Badge_Criterion threshold, the Badge is awarded exactly once and
 *   is not awarded again on any subsequent Qualifying_Activity.
 * Req 5.8: an awarded Badge is retained even if the underlying activity count
 *   later decreases.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import {
  evaluateBadgeAward,
  badgeCriteriaForActivity,
  BADGE_CATALOG,
  type BadgeCriterion,
} from "../../../../convex/campus/social/logic/gamification";
import {
  badgeAwardInputArb,
  badgeCriterionArb,
  cumulativeCountSequenceArb,
} from "./arbitraries";

describe("Property 21: Idempotent badge award", () => {
  it("awards iff the badge is not yet held and the count has reached the threshold (Req 5.5)", () => {
    fc.assert(
      fc.property(badgeAwardInputArb, (input) => {
        const result = evaluateBadgeAward(input);
        const expected =
          !input.alreadyAwarded &&
          input.cumulativeCount >= input.criterion.threshold;
        expect(result.award).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  it("never re-awards a badge that is already held, at any count (Req 5.5, 5.8)", () => {
    fc.assert(
      fc.property(
        badgeCriterionArb,
        fc.integer({ min: 0, max: 100 }),
        (criterion, cumulativeCount) => {
          const result = evaluateBadgeAward({
            cumulativeCount,
            criterion,
            alreadyAwarded: true,
          });
          expect(result.award).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("awards exactly once across a cumulative-count sequence and never again, even as the count recedes (Req 5.5, 5.8)", () => {
    fc.assert(
      fc.property(
        badgeCriterionArb,
        cumulativeCountSequenceArb,
        (criterion, counts) => {
          let awarded = false;
          let awardEvents = 0;

          for (const count of counts) {
            const result = evaluateBadgeAward({
              cumulativeCount: count,
              criterion,
              alreadyAwarded: awarded,
            });
            if (result.award) {
              awardEvents += 1;
              awarded = true; // Persisted award — retained thereafter (Req 5.8).
            }
            // Once held, the badge is never lost regardless of later counts.
            if (awarded) {
              const recheck = evaluateBadgeAward({
                cumulativeCount: count,
                criterion,
                alreadyAwarded: true,
              });
              expect(recheck.award).toBe(false);
            }
          }

          // The badge is awarded at most once across the whole sequence.
          expect(awardEvents).toBeLessThanOrEqual(1);

          // It is awarded exactly once iff some count reached the threshold.
          const everReached = counts.some((c) => c >= criterion.threshold);
          expect(awardEvents).toBe(everReached ? 1 : 0);

          // Terminal state: held iff the threshold was ever reached.
          expect(awarded).toBe(everReached);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("awards on the first count that reaches the threshold and is retained even when the count later drops below it (Req 5.8)", () => {
    fc.assert(
      fc.property(badgeCriterionArb, (criterion) => {
        // Rising to the threshold, then receding well below it.
        const atThreshold = criterion.threshold;
        const below = Math.max(0, criterion.threshold - 1);

        // First reach: awarded.
        const first = evaluateBadgeAward({
          cumulativeCount: atThreshold,
          criterion,
          alreadyAwarded: false,
        });
        expect(first.award).toBe(true);

        // Count recedes below the threshold: badge is retained, not re-awarded.
        const afterDrop = evaluateBadgeAward({
          cumulativeCount: below,
          criterion,
          alreadyAwarded: true,
        });
        expect(afterDrop.award).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("uses real catalog thresholds: each activity's badges award once in ascending threshold order (Req 5.5)", () => {
    // Drive the property against real BADGE_CATALOG criteria via
    // badgeCriteriaForActivity, ensuring the catalog wiring is consistent.
    const activityTypes = Array.from(
      new Set(BADGE_CATALOG.map((b) => b.activityType)),
    );
    const activityTypeArb = fc.constantFrom(...activityTypes);

    fc.assert(
      fc.property(
        activityTypeArb,
        fc.integer({ min: 0, max: 100 }),
        (activityType, cumulativeCount) => {
          const criteria: readonly BadgeCriterion[] =
            badgeCriteriaForActivity(activityType);
          expect(criteria.length).toBeGreaterThan(0);

          // Ascending threshold order.
          for (let i = 1; i < criteria.length; i += 1) {
            expect(criteria[i].threshold).toBeGreaterThanOrEqual(
              criteria[i - 1].threshold,
            );
          }

          // A not-yet-held badge is awarded iff the count met its threshold.
          for (const criterion of criteria) {
            const result = evaluateBadgeAward({
              cumulativeCount,
              criterion,
              alreadyAwarded: false,
            });
            expect(result.award).toBe(cumulativeCount >= criterion.threshold);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
