// Feature: campus-social-loops, Property 23: Accepting a quest creates progress with every step incomplete
/**
 * Property 23: Accepting a quest creates progress with every step incomplete
 *
 * Validates: Requirements 6.2
 *
 * `initProgress` creates exactly one Quest_Progress entry per Quest_Step, in the
 * same order, with every entry marked incomplete (and no completion timestamp).
 * Exercises the pure quest core: initProgress.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { initProgress } from "../../../../convex/campus/social/logic/quests";
import { questStepsArb } from "./arbitraries";

describe("Property 23: Accepting a quest creates progress with every step incomplete", () => {
  it("creates one incomplete entry per step, preserving order", () => {
    fc.assert(
      fc.property(questStepsArb, (steps) => {
        const progress = initProgress(steps);

        // Exactly one entry per step, in the same order.
        expect(progress.length).toBe(steps.length);
        expect(progress.map((p) => p.stepId)).toEqual(steps.map((s) => s.stepId));

        // Every entry is incomplete with no completion timestamp.
        for (const entry of progress) {
          expect(entry.complete).toBe(false);
          expect(entry.completedAt).toBeUndefined();
        }
      }),
      { numRuns: 100 },
    );
  });

  it("is non-mutating: the source steps are never modified", () => {
    fc.assert(
      fc.property(questStepsArb, (steps) => {
        const snapshot = JSON.stringify(steps);
        initProgress(steps);
        expect(JSON.stringify(steps)).toBe(snapshot);
      }),
      { numRuns: 100 },
    );
  });
});
