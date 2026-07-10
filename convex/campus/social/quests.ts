/**
 * Feature: campus-social-loops (Task 16.1) — Quest_Service Convex service.
 *
 * Thin Convex mutation/query module wrapping the pure, property-tested Quest
 * core in `./logic/quests.ts` (Campus Quest System, Requirement 6). Every
 * non-trivial decision is delegated to a pure function so the rules the
 * property tests exercise are the rules enforced at runtime — the same
 * reuse-over-duplication discipline used across `convex/campus/**`. The
 * completion path records a `completed_quest` Qualifying_Activity through the
 * reused Gamification_Service hand-off (`recordQualifyingActivity`) rather than
 * re-implementing streak/badge arithmetic here.
 *
 * Exposed functions (design → `convex/campus/social/quests.ts`):
 *   - acceptQuest (mutation) — `validateQuest` bounds steps to 1–10 with
 *     1–200-char descriptions (Req 6.1); `canAcceptQuest` refuses acceptance
 *     when the offering agent is not `published` (Req 6.9); on success
 *     `initProgress` creates `campusQuestProgress` with every step incomplete
 *     (Req 6.2), backed by `by_quest_and_user` (idempotent per user).
 *   - completeStep (mutation) — `completeStep` marks a step complete regardless
 *     of order (Req 6.3), refuses a step referencing a non-`published` agent
 *     (Req 6.8), and is idempotent — a step counts complete at most once per
 *     user per quest (Req 6.6). When `evaluateQuestCompletion` detects the quest
 *     is newly complete it records the completion once with a timestamp (Req
 *     6.4) and records a `completed_quest` Qualifying_Activity (Req 6.5).
 *   - getQuestProgress (query) — shows which Quest_Steps are complete and which
 *     remain (Req 6.7).
 */

import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { Doc } from "../../_generated/dataModel";
import { getCurrentUserRecord } from "../../shared/ownership";
import { type PublishState } from "../logic/access";
import {
  canAcceptQuest,
  completeStep as completeStepLogic,
  evaluateQuestCompletion,
  initProgress,
  validateQuest,
  type CompleteStepResult,
  type QuestStep,
  type StepProgress,
} from "./logic/quests";
import { recordQualifyingActivity } from "./gamification";

type AnyCtx = QueryCtx | MutationCtx;

/**
 * The Caller-side cumulative activity type advanced when a user completes a
 * Campus_Quest (Req 5.6, 6.5). Matches the Gamification catalog's caller
 * activity for completing quests.
 */
const QUESTS_COMPLETED_ACTIVITY = "quests_completed" as const;

// ---------------------------------------------------------------------------
// Small internal helpers
// ---------------------------------------------------------------------------

/** Loads a Campus_Agent by its public `agentId`, or null when absent. */
async function getAgentById(
  ctx: AnyCtx,
  agentId: string
): Promise<Doc<"campusAgents"> | null> {
  return await ctx.db
    .query("campusAgents")
    .withIndex("by_agent_id", (q) => q.eq("agentId", agentId))
    .first();
}

/** Loads a Campus_Quest by its public `questId`, or null when absent. */
async function getQuestById(
  ctx: AnyCtx,
  questId: string
): Promise<Doc<"campusQuests"> | null> {
  return await ctx.db
    .query("campusQuests")
    .withIndex("by_quest_id", (q) => q.eq("questId", questId))
    .first();
}

/** Loads a user's Quest_Progress for a quest (uniqueness pair), or null. */
async function getProgressForUser(
  ctx: AnyCtx,
  questId: string,
  userId: string
): Promise<Doc<"campusQuestProgress"> | null> {
  return await ctx.db
    .query("campusQuestProgress")
    .withIndex("by_quest_and_user", (q) =>
      q.eq("questId", questId).eq("userId", userId)
    )
    .first();
}

/**
 * Projects the stored Campus_Quest steps into the pure {@link QuestStep} shape,
 * ordered by the stored `order` so validation and progress init see the steps
 * in their defined sequence.
 */
function questStepsOf(quest: Doc<"campusQuests">): QuestStep[] {
  return [...quest.steps]
    .sort((a, b) => a.order - b.order)
    .map((s) => ({
      stepId: s.stepId,
      description: s.description,
      refAgentId: s.refAgentId,
    }));
}

/** The circulation status of a referenced agent (`deleted` when it is gone). */
async function refAgentStatus(
  ctx: AnyCtx,
  refAgentId: string | undefined
): Promise<PublishState | undefined> {
  if (!refAgentId) return undefined;
  const agent = await getAgentById(ctx, refAgentId);
  return agent?.status ?? "deleted";
}

/** Generates a stable, unguessable public id with a typed prefix. */
function generateId(prefix: string): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 20; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `${prefix}_${result}`;
}

// ---------------------------------------------------------------------------
// acceptQuest — validate, gate on the offering agent, init progress (Req 6.1, 6.2, 6.9)
// ---------------------------------------------------------------------------

/** Discriminated outcome of `acceptQuest`. */
type AcceptQuestResult =
  | { accepted: true; progressId: string; alreadyAccepted?: boolean }
  | {
      accepted: false;
      reason:
        | "not_authenticated"
        | "no_quest"
        | "invalid_quest"
        | "agent_unavailable";
      message: string;
    };

/**
 * Accepts a Campus_Quest for the authenticated user (Req 6.1, 6.2, 6.9). The
 * offering Campus_Agent must be `published` (`canAcceptQuest`) and the quest
 * definition must be well-formed (`validateQuest`: 1–10 steps, each description
 * 1–200 chars); otherwise acceptance is refused with the specific reason and no
 * Quest_Progress is created. On success `initProgress` creates the
 * `campusQuestProgress` row with every Quest_Step incomplete, keyed by
 * `by_quest_and_user` so a given user accepts a quest at most once — a repeat
 * acceptance is an idempotent no-op returning the existing progress.
 */
export const acceptQuest = mutation({
  args: { questId: v.string() },
  handler: async (ctx, args): Promise<AcceptQuestResult> => {
    const user = await getCurrentUserRecord(ctx);
    if (!user) {
      return {
        accepted: false,
        reason: "not_authenticated",
        message: "Authentication is required to accept a quest.",
      };
    }
    const userId = user._id as unknown as string;

    const quest = await getQuestById(ctx, args.questId);
    if (!quest) {
      return {
        accepted: false,
        reason: "no_quest",
        message: "This quest no longer exists.",
      };
    }

    // Quest definition bounds (Req 6.1).
    const steps = questStepsOf(quest);
    const validation = validateQuest(steps);
    if (!validation.valid) {
      return {
        accepted: false,
        reason: "invalid_quest",
        message:
          validation.reason === "step_count"
            ? "This quest must have between 1 and 10 steps."
            : "Each quest step must be described in 1 to 200 characters.",
      };
    }

    // Offering-agent circulation gate (Req 6.9).
    const offeringStatus =
      (await getAgentById(ctx, quest.offeringAgentId))?.status ?? "deleted";
    const gate = canAcceptQuest(offeringStatus);
    if (!gate.ok) {
      return {
        accepted: false,
        reason: "agent_unavailable",
        message: "The agent offering this quest is unavailable.",
      };
    }

    // At most one Quest_Progress per user per quest (Req 6.2, idempotent).
    const existing = await getProgressForUser(ctx, args.questId, userId);
    if (existing) {
      return {
        accepted: true,
        progressId: existing.progressId,
        alreadyAccepted: true,
      };
    }

    const progressId = generateId("QPROG");
    const now = Date.now();
    await ctx.db.insert("campusQuestProgress", {
      progressId,
      questId: args.questId,
      userId,
      steps: initProgress(steps),
      completed: false,
      createdAt: now,
    });

    return { accepted: true, progressId };
  },
});

// ---------------------------------------------------------------------------
// completeStep — order-independent, idempotent, agent-gated (Req 6.3, 6.4, 6.6, 6.8)
// ---------------------------------------------------------------------------

/** Discriminated outcome of `completeStep`. */
type CompleteStepMutationResult =
  | { changed: true; questCompleted: boolean }
  | { changed: false; questCompleted: false; reason: string; message: string };

/**
 * Marks a single Quest_Step complete in the authenticated user's Quest_Progress
 * (Req 6.3, 6.4, 6.6, 6.8). Completion is order-independent and idempotent — a
 * step counts complete at most once per user per quest, so a repeat is a no-op
 * (`already_complete`). A step whose required action references a non-`published`
 * Campus_Agent is refused (`agent_unavailable`) and the progress is left
 * unchanged. When `evaluateQuestCompletion` detects that this completion makes
 * the whole quest newly complete, the completion is recorded once with a
 * timestamp (Req 6.4) and a `completed_quest` Qualifying_Activity is recorded
 * for the user through the Gamification_Service hand-off (Req 6.5).
 */
export const completeStep = mutation({
  args: { questId: v.string(), stepId: v.string() },
  handler: async (ctx, args): Promise<CompleteStepMutationResult> => {
    const user = await getCurrentUserRecord(ctx);
    if (!user) {
      return {
        changed: false,
        questCompleted: false,
        reason: "not_authenticated",
        message: "Authentication is required to progress a quest.",
      };
    }
    const userId = user._id as unknown as string;

    const progress = await getProgressForUser(ctx, args.questId, userId);
    if (!progress) {
      return {
        changed: false,
        questCompleted: false,
        reason: "not_accepted",
        message: "You have not accepted this quest.",
      };
    }

    // Resolve the referenced agent's circulation state for the gate (Req 6.8).
    const quest = await getQuestById(ctx, args.questId);
    const questStep = quest?.steps.find((s) => s.stepId === args.stepId);
    const status = await refAgentStatus(ctx, questStep?.refAgentId);

    const now = Date.now();
    const priorProgress: StepProgress[] = progress.steps.map((s) => ({
      stepId: s.stepId,
      complete: s.complete,
      completedAt: s.completedAt,
    }));

    const result: CompleteStepResult = completeStepLogic({
      progress: priorProgress,
      stepId: args.stepId,
      now,
      refAgentStatus: status,
    });

    if (!result.changed) {
      const message =
        result.reason === "already_complete"
          ? "This step is already complete."
          : result.reason === "agent_unavailable"
            ? "The agent this step references is unavailable."
            : "That step is not part of this quest.";
      return {
        changed: false,
        questCompleted: false,
        reason: result.reason,
        message,
      };
    }

    // Persist the updated per-step completion state (Req 6.3, 6.6).
    await ctx.db.patch(progress._id, { steps: result.progress });

    // Detect newly-reached completion — recorded once (Req 6.4).
    const completion = evaluateQuestCompletion({
      progress: result.progress,
      alreadyCompleted: progress.completed,
    });

    if (completion.complete) {
      await ctx.db.patch(progress._id, { completed: true, completedAt: now });
      // Record the Caller's Qualifying_Activity via the reused hand-off (Req 6.5).
      await recordQualifyingActivity(ctx, {
        userId,
        activityType: QUESTS_COMPLETED_ACTIVITY,
        kind: "caller",
        nowMs: now,
      });
    }

    return { changed: true, questCompleted: completion.complete };
  },
});

// ---------------------------------------------------------------------------
// getQuestProgress — show complete / incomplete steps (Req 6.7)
// ---------------------------------------------------------------------------

/** A single Quest_Step as presented on the in-progress quest view. */
export interface QuestStepView {
  stepId: string;
  order: number;
  description: string;
  complete: boolean;
  completedAt?: number;
}

/** The in-progress quest projection returned to the Campus Quests surface. */
export type QuestProgressView =
  | { found: false }
  | {
      found: true;
      questId: string;
      title: string;
      completed: boolean;
      completedAt?: number;
      steps: QuestStepView[];
      completeStepIds: string[];
      remainingStepIds: string[];
    };

/**
 * Returns the authenticated user's progress on a Campus_Quest, showing which
 * Quest_Steps are complete and which remain incomplete (Req 6.7). Each step is
 * joined with its stored description and order so the view can render the
 * ordered checklist directly; `completeStepIds` / `remainingStepIds` split the
 * steps for convenience. Returns `{ found: false }` when the user has no
 * progress for the quest or the quest no longer exists.
 */
export const getQuestProgress = query({
  args: { questId: v.string() },
  handler: async (ctx, args): Promise<QuestProgressView> => {
    const user = await getCurrentUserRecord(ctx);
    if (!user) return { found: false };
    const userId = user._id as unknown as string;

    const progress = await getProgressForUser(ctx, args.questId, userId);
    if (!progress) return { found: false };

    const quest = await getQuestById(ctx, args.questId);
    if (!quest) return { found: false };

    // Index the stored step definitions for description/order lookup.
    const definitions = new Map(quest.steps.map((s) => [s.stepId, s]));

    const steps: QuestStepView[] = progress.steps.map((entry) => {
      const def = definitions.get(entry.stepId);
      return {
        stepId: entry.stepId,
        order: def?.order ?? 0,
        description: def?.description ?? "",
        complete: entry.complete,
        completedAt: entry.completedAt,
      };
    });
    steps.sort((a, b) => a.order - b.order);

    return {
      found: true,
      questId: quest.questId,
      title: quest.title,
      completed: progress.completed,
      completedAt: progress.completedAt,
      steps,
      completeStepIds: steps.filter((s) => s.complete).map((s) => s.stepId),
      remainingStepIds: steps.filter((s) => !s.complete).map((s) => s.stepId),
    };
  },
});
