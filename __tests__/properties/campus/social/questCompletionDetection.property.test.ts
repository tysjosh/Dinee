// Feature: campus-social-loops, Property 25: A quest is completed once, with a timestamp, when and only when all steps are complete
/**
 * Property 25: A quest is completed once, with a timestamp, when and only when all steps are complete
 *
 * Validates: Requirements 6.4
 *
 * `evaluateQuestCompletion` reports the quest complete if and only if the
 * progress is non-empty, every Quest_Step is complete, and the quest is not
 * already marked complete for the user — so an already-completed quest is never
 * re-recorded (recorded once). When completion is driven through `completeStep`,
 * each completed step carries the completion timestamp. Exercises the pure quest
 * core: evaluateQuestCompletion (with completeStep for the timestamp path).
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  evaluateQuestCompletion,
  completeStep,
  initProgress,
  type StepProgress,
} from "../../../../convex/campus/social/logic/quests";
import { questStepsArb } from "./arbitraries";

const NOW = Date.UTC(2024, 5, 1, 12, 0, 0);

/** A progress set (0–10 entries) with independently-random completion flags. */
const progressArb: fc.Arbitrary<StepProgress[]> = fc
  .uniqueArray(fc.string({ minLength: 1, maxLength: 4 }), {
    minLength: 0,
    maxLength: 10,
    selector: (s) => s,
  })
  .chain((stepIds) =>
    fc
      .array(fc.boolean(), {
        minLength: stepIds.length,
        maxLength: stepIds.length,
      })
      .map((flags) =>
        stepIds.map((stepId, i) => ({ stepId, complete: flags[i] })),
      ),
  );

describe("Property 25: A quest is completed once, with a timestamp, when and only when all steps are complete", () => {
  it("is complete iff non-empty, all steps complete, and not already completed", () => {
    fc.assert(
      fc.property(progressArb, fc.boolean(), (progress, alreadyCompleted) => {
        const allComplete =
          progress.length > 0 && progress.every((p) => p.complete);
        const expected = allComplete && !alreadyCompleted;

        const result = evaluateQuestCompletion({ progress, alreadyCompleted });
        expect(result.complete).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  it("records once: an already-completed quest is never reported complete again", () => {
    fc.assert(
      fc.property(progressArb, (progress) => {
        // Regardless of step state, once already completed it is not re-recorded.
        expect(
          evaluateQuestCompletion({ progress, alreadyCompleted: true }).complete,
        ).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("becomes complete with per-step timestamps once every step is completed via completeStep", () => {
    fc.assert(
      fc.property(
        questStepsArb.filter((steps) => steps.length >= 1 && steps.length <= 10),
        (steps) => {
          let progress = initProgress(steps);

          // Not complete while any step remains incomplete.
          expect(
            evaluateQuestCompletion({ progress, alreadyCompleted: false })
              .complete,
          ).toBe(steps.length === 0);

          for (const step of steps) {
            const result = completeStep({ progress, stepId: step.stepId, now: NOW });
            progress = result.progress;
          }

          // Every step now complete and carries the completion timestamp.
          for (const entry of progress) {
            expect(entry.complete).toBe(true);
            expect(entry.completedAt).toBe(NOW);
          }

          // Detected complete exactly once; re-evaluation after marking does not re-fire.
          expect(
            evaluateQuestCompletion({ progress, alreadyCompleted: false })
              .complete,
          ).toBe(true);
          expect(
            evaluateQuestCompletion({ progress, alreadyCompleted: true })
              .complete,
          ).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
