// Feature: campus-social-loops, Task 16.2 — example test for quest completion wiring and progress display.
//
// Validates: Requirements 6.5, 6.7
//
// Req 6.5: WHEN a user's Campus_Quest is marked complete, THE Gamification_Service
//   SHALL record a Qualifying_Activity for that user consistent with Requirement 5.
// Req 6.7: WHEN a user opens an in-progress Campus_Quest, THE Quest_Service SHALL
//   display which Quest_Steps are complete and which remain incomplete.
//
// There is no Convex DB test harness in this project, so both behaviors are
// exercised through the exact pure functions the `completeStep` mutation and the
// `getQuestProgress` query compose:
//   - completion wiring: `completeStep` + `evaluateQuestCompletion` decide when
//     the quest is newly complete, and the service then hands a `quests_completed`
//     Qualifying_Activity to the Gamification_Service. The hand-off is faithfully
//     modeled here by the same pure Gamification core the service invokes
//     (`applyQualifyingActivity` advancing the caller Streak, and the catalog
//     recognizing `quests_completed` as a caller activity), matching this repo's
//     pure-core testing convention (see gamificationProfile.test.ts).
//   - progress display: the `getQuestProgress` step split (complete vs remaining)
//     is reproduced from the same StepProgress the service persists.

import { describe, it, expect } from "vitest";
import {
  completeStep,
  evaluateQuestCompletion,
  initProgress,
  type QuestStep,
  type StepProgress,
} from "../../../../convex/campus/social/logic/quests";
import {
  applyQualifyingActivity,
  currentStreak,
  CALLER_ACTIVITY_TYPES,
  badgeCriteriaForActivity,
  type StreakState,
} from "../../../../convex/campus/social/logic/gamification";

const NOW = Date.UTC(2024, 5, 1, 12, 0, 0);

/** The activity type the Quest_Service records on completion (Req 6.5). */
const QUESTS_COMPLETED_ACTIVITY = "quests_completed";

/** A small three-step quest, one step referencing a (published) agent. */
const QUEST: QuestStep[] = [
  { stepId: "s1", description: "Find the best study spot on campus" },
  { stepId: "s2", description: "Ask a club agent what events are happening", refAgentId: "agent_club" },
  { stepId: "s3", description: "Quiz yourself before class" },
];

/** Mirrors the `getQuestProgress` step split (Req 6.7). */
function progressView(progress: readonly StepProgress[]) {
  return {
    completeStepIds: progress.filter((s) => s.complete).map((s) => s.stepId),
    remainingStepIds: progress.filter((s) => !s.complete).map((s) => s.stepId),
  };
}

describe("Task 16.2: Quest completion wiring (Req 6.5)", () => {
  it("records a Qualifying_Activity only once every step is complete", () => {
    let progress = initProgress(QUEST);

    // Complete the steps out of order; the quest is not complete until the last.
    const order = ["s3", "s1", "s2"];
    const activitiesRecorded: string[] = [];

    for (const stepId of order) {
      const refAgentStatus = stepId === "s2" ? ("published" as const) : undefined;
      const result = completeStep({ progress, stepId, now: NOW, refAgentStatus });
      expect(result.changed).toBe(true);
      progress = result.progress;

      // The service records a completed_quest Qualifying_Activity exactly when
      // evaluateQuestCompletion first reports the quest complete.
      const completion = evaluateQuestCompletion({
        progress,
        alreadyCompleted: activitiesRecorded.length > 0,
      });
      if (completion.complete) {
        activitiesRecorded.push(QUESTS_COMPLETED_ACTIVITY);
      }
    }

    // Exactly one Qualifying_Activity was recorded, for the quests_completed type.
    expect(activitiesRecorded).toEqual([QUESTS_COMPLETED_ACTIVITY]);
  });

  it("routes the completion activity to the caller Streak and caller badges", () => {
    // The activity the service hands off is a recognized Caller activity (Req 5.6),
    // so it advances the Caller_Streak — the Gamification_Service behavior of Req 6.5.
    expect([...CALLER_ACTIVITY_TYPES]).toContain(QUESTS_COMPLETED_ACTIVITY);
    expect(badgeCriteriaForActivity(QUESTS_COMPLETED_ACTIVITY).length).toBeGreaterThan(0);
    expect(
      badgeCriteriaForActivity(QUESTS_COMPLETED_ACTIVITY).every(
        (c) => c.category === "caller",
      ),
    ).toBe(true);

    // Applying the qualifying activity advances the caller streak (recorded).
    const before: StreakState = { count: 0, lastActiveDay: null };
    const after = applyQualifyingActivity(before, "2024-06-01");
    expect(after.count).toBe(1);
    expect(currentStreak(after, "2024-06-01")).toBe(1);
  });

  it("does not re-record the activity when an already-complete quest is re-evaluated", () => {
    let progress = initProgress(QUEST);
    for (const step of QUEST) {
      progress = completeStep({
        progress,
        stepId: step.stepId,
        now: NOW,
        refAgentStatus: step.refAgentId ? ("published" as const) : undefined,
      }).progress;
    }

    // First evaluation records completion; a second (alreadyCompleted) does not.
    expect(
      evaluateQuestCompletion({ progress, alreadyCompleted: false }).complete,
    ).toBe(true);
    expect(
      evaluateQuestCompletion({ progress, alreadyCompleted: true }).complete,
    ).toBe(false);
  });
});

describe("Task 16.2: In-progress quest display (Req 6.7)", () => {
  it("displays which steps are complete and which remain", () => {
    let progress = initProgress(QUEST);

    // Freshly accepted: nothing complete, all remaining (Req 6.2, shown by 6.7).
    let view = progressView(progress);
    expect(view.completeStepIds).toEqual([]);
    expect(view.remainingStepIds).toEqual(["s1", "s2", "s3"]);

    // After completing one step, the split reflects exactly that step.
    progress = completeStep({ progress, stepId: "s1", now: NOW }).progress;
    view = progressView(progress);
    expect(view.completeStepIds).toEqual(["s1"]);
    expect(view.remainingStepIds).toEqual(["s2", "s3"]);

    // After completing another (out of order), both completions are shown.
    progress = completeStep({
      progress,
      stepId: "s3",
      now: NOW,
    }).progress;
    view = progressView(progress);
    expect(view.completeStepIds.sort()).toEqual(["s1", "s3"]);
    expect(view.remainingStepIds).toEqual(["s2"]);

    // Every step is accounted for in exactly one of the two lists.
    expect(view.completeStepIds.length + view.remainingStepIds.length).toBe(
      QUEST.length,
    );
  });
});
