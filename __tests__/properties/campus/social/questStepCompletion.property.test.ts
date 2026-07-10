// Feature: campus-social-loops, Property 24: Quest step completion is order-independent and idempotent
/**
 * Property 24: Quest step completion is order-independent and idempotent
 *
 * Validates: Requirements 6.3, 6.6
 *
 * `completeStep` is order-independent — the set of completed Quest_Steps depends
 * only on which steps were completed, not the order — and idempotent: completing
 * an already-complete step is a no-op, so a Quest_Step counts complete at most
 * once per user per quest. It is also non-mutating. Exercises the pure quest
 * core: completeStep (with `initStepProgress` for the initial progress).
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  completeStep,
  type StepProgress,
} from "../../../../convex/campus/social/logic/quests";
import { stepCompletionSequenceArb, initStepProgress } from "./arbitraries";

const NOW = Date.UTC(2024, 5, 1, 12, 0, 0);

/**
 * Fold a sequence of stepId completions over an initial progress, always with a
 * fixed clock and no referenced-agent gate (published-only steps).
 */
function applyOrder(
  progress: readonly StepProgress[],
  order: readonly string[],
): StepProgress[] {
  let current: StepProgress[] = progress.map((p) => ({ ...p }));
  for (const stepId of order) {
    const result = completeStep({ progress: current, stepId, now: NOW });
    current = result.progress;
  }
  return current;
}

/** The set of stepIds marked complete in a progress. */
function completedSet(progress: readonly StepProgress[]): Set<string> {
  return new Set(progress.filter((p) => p.complete).map((p) => p.stepId));
}

describe("Property 24: Quest step completion is order-independent and idempotent", () => {
  it("is order-independent: differently-ordered completions yield the same completed set", () => {
    fc.assert(
      fc.property(stepCompletionSequenceArb, ({ stepIds, order }) => {
        const init = initStepProgress(stepIds);

        const forwards = applyOrder(init, order);
        const backwards = applyOrder(init, [...order].reverse());
        const sorted = applyOrder(init, [...order].sort());

        // The completed set is identical regardless of completion order.
        const expected = completedSet(forwards);
        expect(completedSet(backwards)).toEqual(expected);
        expect(completedSet(sorted)).toEqual(expected);

        // That set is exactly the known stepIds referenced by the order.
        const known = new Set(stepIds);
        const referenced = new Set(order.filter((id) => known.has(id)));
        expect(expected).toEqual(referenced);
      }),
      { numRuns: 100 },
    );
  });

  it("is idempotent: repeating the completion sequence changes nothing", () => {
    fc.assert(
      fc.property(stepCompletionSequenceArb, ({ stepIds, order }) => {
        const init = initStepProgress(stepIds);

        const once = applyOrder(init, order);
        const twice = applyOrder(init, [...order, ...order]);

        // Applying the same completions again is a no-op (timestamps included).
        expect(twice).toEqual(once);
      }),
      { numRuns: 100 },
    );
  });

  it("re-completing an already-complete step is a reported no-op and never mutates input", () => {
    fc.assert(
      fc.property(stepCompletionSequenceArb, ({ stepIds }) => {
        const target = stepIds[0];
        const init = initStepProgress(stepIds);

        const first = completeStep({ progress: init, stepId: target, now: NOW });
        expect(first.changed).toBe(true);

        const snapshot = JSON.stringify(first.progress);
        const again = completeStep({
          progress: first.progress,
          stepId: target,
          now: NOW + 1000,
        });

        // Repeated completion is refused as already_complete, unchanged.
        expect(again.changed).toBe(false);
        if (!again.changed) {
          expect(again.reason).toBe("already_complete");
        }
        expect(again.progress).toEqual(first.progress);
        // The prior progress was not mutated by the second attempt.
        expect(JSON.stringify(first.progress)).toBe(snapshot);
      }),
      { numRuns: 100 },
    );
  });
});
