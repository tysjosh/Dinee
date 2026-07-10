// Feature: campus-social-loops, Property 22: A Campus_Quest has 1–10 steps, each described in 1–200 characters
/**
 * Property 22: A Campus_Quest has 1–10 steps, each described in 1–200 characters
 *
 * Validates: Requirements 6.1
 *
 * `validateQuest` accepts a Campus_Quest definition if and only if it has
 * between 1 and 10 Quest_Steps inclusive and every Quest_Step description is
 * between 1 and 200 characters inclusive. Otherwise it identifies the specific
 * reason (`step_count` when the number of steps is out of range — taking
 * precedence — else `step_description`). Exercises the pure quest core:
 * validateQuest.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  validateQuest,
  QUEST_STEPS_MIN,
  QUEST_STEPS_MAX,
  QUEST_STEP_DESC_MIN,
  QUEST_STEP_DESC_MAX,
} from "../../../../convex/campus/social/logic/quests";
import { questStepsArb } from "./arbitraries";

describe("Property 22: A Campus_Quest has 1–10 steps, each described in 1–200 characters", () => {
  it("accepts iff step count is in [1,10] and every description is in [1,200] chars", () => {
    fc.assert(
      fc.property(questStepsArb, (steps) => {
        const countInRange =
          steps.length >= QUEST_STEPS_MIN && steps.length <= QUEST_STEPS_MAX;
        const everyDescInRange = steps.every(
          (s) =>
            s.description.length >= QUEST_STEP_DESC_MIN &&
            s.description.length <= QUEST_STEP_DESC_MAX,
        );

        const result = validateQuest(steps);

        expect(result.valid).toBe(countInRange && everyDescInRange);

        if (!result.valid) {
          // Step-count out of range takes precedence over description issues.
          if (!countInRange) {
            expect(result.reason).toBe("step_count");
          } else {
            expect(result.reason).toBe("step_description");
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it("is non-mutating and deterministic across repeated evaluation", () => {
    fc.assert(
      fc.property(questStepsArb, (steps) => {
        const snapshot = JSON.stringify(steps);
        const first = validateQuest(steps);
        const second = validateQuest(steps);

        // Input untouched.
        expect(JSON.stringify(steps)).toBe(snapshot);
        // Same verdict every time.
        expect(second).toEqual(first);
      }),
      { numRuns: 100 },
    );
  });
});
