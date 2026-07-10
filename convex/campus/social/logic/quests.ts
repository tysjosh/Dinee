/**
 * Feature: campus-social-loops (Task 8.1)
 *
 * Pure, property-testable core for the Quest_Service (Campus Quest System,
 * Requirement 6). These functions carry NO Convex `ctx` and perform no I/O, so
 * they can be exercised directly by unit and property tests and imported by the
 * Convex `social/quests.ts` service that wraps them with `campusQuests` /
 * `campusQuestProgress` reads and writes (`acceptQuest`, `completeStep`,
 * `getQuestProgress`, and the Gamification hand-off).
 *
 * Covered behaviors:
 *   - 6.1: a Campus_Quest is valid iff it has 1–10 ordered Quest_Steps and every
 *     Quest_Step description is 1–200 characters.
 *   - 6.2: accepting a quest creates Quest_Progress with every step incomplete.
 *   - 6.3 / 6.6: step completion is order-independent and idempotent — a given
 *     Quest_Step counts complete at most once per user per Campus_Quest, so a
 *     repeated completion is a no-op.
 *   - 6.4: a quest is marked complete (once, with a timestamp recorded
 *     downstream) exactly when every step is complete and it is not already
 *     marked complete.
 *   - 6.8: a step whose required action references a non-`published` agent is
 *     refused with an "agent unavailable" indication.
 *   - 6.9: a quest whose offering agent is not `published` cannot be accepted.
 *
 * The `published` circulation notion reuses {@link PublishState} from the Campus
 * access module (`../../logic/access`) verbatim, so "unavailable agent" means
 * the same thing here as everywhere else in Campus.
 */

import { type PublishState } from "../../logic/access";

// ---------------------------------------------------------------------------
// Constants (Req 6.1)
// ---------------------------------------------------------------------------

/** Minimum number of Quest_Steps in a Campus_Quest (Req 6.1). */
export const QUEST_STEPS_MIN = 1;

/** Maximum number of Quest_Steps in a Campus_Quest (Req 6.1). */
export const QUEST_STEPS_MAX = 10;

/** Maximum length, in characters, of a Quest_Step description (Req 6.1). */
export const QUEST_STEP_DESC_MAX = 200;

/** Minimum length, in characters, of a Quest_Step description (Req 6.1). */
export const QUEST_STEP_DESC_MIN = 1;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single required action within a Campus_Quest. `refAgentId` names a
 * Campus_Agent that the step's action references, when the action is scoped to
 * a specific agent (Req 6.8).
 */
export interface QuestStep {
  stepId: string;
  description: string;
  refAgentId?: string;
}

/** A user's per-step completion state within their Quest_Progress (Req 6.2). */
export interface StepProgress {
  stepId: string;
  complete: boolean;
  completedAt?: number;
}

// ---------------------------------------------------------------------------
// Quest definition validation (Req 6.1)
// ---------------------------------------------------------------------------

/**
 * Validate a Campus_Quest definition (Req 6.1). A definition is valid if and
 * only if it has between {@link QUEST_STEPS_MIN} and {@link QUEST_STEPS_MAX}
 * Quest_Steps inclusive and every Quest_Step description is between
 * {@link QUEST_STEP_DESC_MIN} and {@link QUEST_STEP_DESC_MAX} characters
 * inclusive. Otherwise the specific reason is identified: `step_count` when the
 * number of steps is out of range, `step_description` when any description is
 * out of range. The step-count check takes precedence. Pure and non-mutating.
 */
export function validateQuest(
  steps: readonly QuestStep[]
): { valid: true } | { valid: false; reason: "step_count" | "step_description" } {
  if (steps.length < QUEST_STEPS_MIN || steps.length > QUEST_STEPS_MAX) {
    return { valid: false, reason: "step_count" };
  }

  for (const step of steps) {
    if (
      step.description.length < QUEST_STEP_DESC_MIN ||
      step.description.length > QUEST_STEP_DESC_MAX
    ) {
      return { valid: false, reason: "step_description" };
    }
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Progress initialization (Req 6.2)
// ---------------------------------------------------------------------------

/**
 * Create the initial Quest_Progress for an accepted Campus_Quest (Req 6.2):
 * exactly one {@link StepProgress} entry per Quest_Step, each marked incomplete.
 * The step order is preserved. Pure and non-mutating.
 */
export function initProgress(steps: readonly QuestStep[]): StepProgress[] {
  return steps.map((step) => ({ stepId: step.stepId, complete: false }));
}

// ---------------------------------------------------------------------------
// Step completion (Req 6.3, 6.6, 6.8)
// ---------------------------------------------------------------------------

/**
 * The discriminated result of a {@link completeStep} attempt. On success the
 * updated progress is returned with `changed: true`; otherwise the original
 * progress is returned unchanged with `changed: false` and the reason:
 *   - `already_complete`: the step is already complete — a no-op (Req 6.6).
 *   - `agent_unavailable`: the step references a non-`published` agent (Req 6.8).
 *   - `unknown_step`: no step with the given `stepId` exists in the progress.
 */
export type CompleteStepResult =
  | { changed: true; progress: StepProgress[] }
  | {
      changed: false;
      reason: "already_complete" | "agent_unavailable" | "unknown_step";
      progress: StepProgress[];
    };

/**
 * Mark a single Quest_Step complete (Req 6.3, 6.6, 6.8). Completion is
 * order-independent — any incomplete step may be completed regardless of the
 * position of other steps — and idempotent: completing an already-complete step
 * is a no-op that leaves the progress unchanged, so a step counts complete at
 * most once per user per quest.
 *
 * A step whose required action references a Campus_Agent that is not in the
 * `published` Publish_State is refused with `agent_unavailable` and the progress
 * is left unchanged (Req 6.8). An unknown `stepId` yields `unknown_step`. Pure
 * and non-mutating: the input `progress` is never modified; a new array is
 * returned on change.
 */
export function completeStep(input: {
  progress: readonly StepProgress[];
  stepId: string;
  now: number;
  refAgentStatus?: PublishState;
}): CompleteStepResult {
  const { progress, stepId, now, refAgentStatus } = input;

  const index = progress.findIndex((entry) => entry.stepId === stepId);
  if (index === -1) {
    return { changed: false, reason: "unknown_step", progress: [...progress] };
  }

  const existing = progress[index];
  if (existing.complete) {
    return {
      changed: false,
      reason: "already_complete",
      progress: [...progress],
    };
  }

  // A step referencing an agent that is not published cannot be completed
  // (Req 6.8). Steps with no referenced agent (`refAgentStatus` undefined) are
  // unaffected by this gate.
  if (refAgentStatus !== undefined && refAgentStatus !== "published") {
    return {
      changed: false,
      reason: "agent_unavailable",
      progress: [...progress],
    };
  }

  const next = progress.map((entry, i) =>
    i === index ? { ...entry, complete: true, completedAt: now } : { ...entry }
  );

  return { changed: true, progress: next };
}

// ---------------------------------------------------------------------------
// Completion detection (Req 6.4)
// ---------------------------------------------------------------------------

/**
 * Detect whether a Campus_Quest should be marked complete (Req 6.4). It is
 * complete if and only if every Quest_Step in the progress is complete and the
 * quest is not already marked complete for the user — the second condition
 * ensures the completion is recorded once (a re-evaluation of an
 * already-completed quest reports `complete: false`, so it is not re-recorded).
 * An empty progress is never treated as complete. Pure and non-mutating.
 */
export function evaluateQuestCompletion(input: {
  progress: readonly StepProgress[];
  alreadyCompleted: boolean;
}): { complete: boolean } {
  const { progress, alreadyCompleted } = input;

  if (alreadyCompleted) {
    return { complete: false };
  }

  const allComplete =
    progress.length > 0 && progress.every((entry) => entry.complete);

  return { complete: allComplete };
}

// ---------------------------------------------------------------------------
// Accept gate (Req 6.9)
// ---------------------------------------------------------------------------

/**
 * Decide whether a Campus_Quest may be accepted (Req 6.9). Acceptance is allowed
 * if and only if the offering Campus_Agent is in the `published` Publish_State;
 * otherwise it is refused with `agent_unavailable` and no Quest_Progress is
 * created downstream. Pure and non-mutating.
 */
export function canAcceptQuest(
  offeringAgentStatus: PublishState
): { ok: true } | { ok: false; reason: "agent_unavailable" } {
  if (offeringAgentStatus !== "published") {
    return { ok: false, reason: "agent_unavailable" };
  }
  return { ok: true };
}
