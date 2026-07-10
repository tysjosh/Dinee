// Feature: campus-social-loops, Property 26: Unavailable agents block quest acceptance and step completion
/**
 * Property 26: Unavailable agents block quest acceptance and step completion
 *
 * Validates: Requirements 6.8, 6.9
 *
 * `canAcceptQuest` allows acceptance if and only if the offering Campus_Agent is
 * `published`; otherwise it refuses with `agent_unavailable` and no progress is
 * created downstream (Req 6.9). `completeStep` refuses to complete a known,
 * incomplete Quest_Step whose required action references a non-`published` agent
 * (`agent_unavailable`) and leaves the progress unchanged (Req 6.8). Exercises
 * the pure quest core: canAcceptQuest, completeStep.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  canAcceptQuest,
  completeStep,
  type StepProgress,
} from "../../../../convex/campus/social/logic/quests";
import {
  offeringAgentStatusArb,
  questStepCompletionInputArb,
  publishStateArb,
  nonPublishedStateArb,
  initStepProgress,
} from "./arbitraries";

const NOW = Date.UTC(2024, 5, 1, 12, 0, 0);

describe("Property 26: Unavailable agents block quest acceptance and step completion", () => {
  it("acceptance is allowed iff the offering agent is published (Req 6.9)", () => {
    fc.assert(
      fc.property(offeringAgentStatusArb, (status) => {
        const result = canAcceptQuest(status);
        if (status === "published") {
          expect(result.ok).toBe(true);
        } else {
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.reason).toBe("agent_unavailable");
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it("completeStep decision follows unknown → already-complete → agent gate precedence, unchanged when refused", () => {
    fc.assert(
      fc.property(questStepCompletionInputArb, (input) => {
        const known = input.progress.some((p) => p.stepId === input.stepId);
        const existing = input.progress.find((p) => p.stepId === input.stepId);
        const snapshot = JSON.stringify(input.progress);

        const result = completeStep(input);

        if (!known) {
          expect(result.changed).toBe(false);
          if (!result.changed) expect(result.reason).toBe("unknown_step");
        } else if (existing!.complete) {
          expect(result.changed).toBe(false);
          if (!result.changed) expect(result.reason).toBe("already_complete");
        } else if (
          input.refAgentStatus !== undefined &&
          input.refAgentStatus !== "published"
        ) {
          // A non-published referenced agent blocks completion (Req 6.8).
          expect(result.changed).toBe(false);
          if (!result.changed) expect(result.reason).toBe("agent_unavailable");
        } else {
          expect(result.changed).toBe(true);
        }

        // Input progress is never mutated regardless of outcome.
        expect(JSON.stringify(input.progress)).toBe(snapshot);
      }),
      { numRuns: 100 },
    );
  });

  it("a non-published referenced agent always blocks a known, incomplete step and leaves progress unchanged (Req 6.8)", () => {
    const stepIds = ["s1", "s2", "s3"];
    fc.assert(
      fc.property(
        fc.constantFrom(...stepIds),
        nonPublishedStateArb,
        (stepId, badStatus) => {
          const progress: StepProgress[] = initStepProgress(stepIds);
          const result = completeStep({
            progress,
            stepId,
            now: NOW,
            refAgentStatus: badStatus,
          });

          expect(result.changed).toBe(false);
          if (!result.changed) expect(result.reason).toBe("agent_unavailable");
          // Nothing marked complete.
          expect(result.progress.every((p) => !p.complete)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("a published (or unreferenced) agent permits completing a known, incomplete step", () => {
    const stepIds = ["s1", "s2", "s3"];
    fc.assert(
      fc.property(
        fc.constantFrom(...stepIds),
        fc.option(publishStateArb.filter((s) => s === "published"), {
          nil: undefined,
        }),
        (stepId, refAgentStatus) => {
          const progress: StepProgress[] = initStepProgress(stepIds);
          const result = completeStep({ progress, stepId, now: NOW, refAgentStatus });

          expect(result.changed).toBe(true);
          if (result.changed) {
            const entry = result.progress.find((p) => p.stepId === stepId)!;
            expect(entry.complete).toBe(true);
            expect(entry.completedAt).toBe(NOW);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
