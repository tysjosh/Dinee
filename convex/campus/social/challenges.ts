/**
 * Feature: campus-social-loops (Task 12.1) — Challenge_Service Convex service.
 *
 * Thin Convex query/mutation/action/internal module wrapping the pure,
 * property-tested Challenge core in `./logic/challenges.ts` (Daily Campus
 * Challenges, Requirement 2). Every non-trivial decision is delegated to a pure
 * function so the rules the property tests exercise are the rules enforced at
 * runtime — the same reuse-over-duplication discipline used across
 * `convex/campus/**`. All reused primitives (`evaluateAccess`,
 * `evaluateConsentGate`, `canStartCall`, `decideScreening`, `isDiscoverable`)
 * are imported directly rather than reimplemented.
 *
 * Exposed functions (design → `convex/campus/social/challenges.ts`):
 *   - publishDailyChallenge (internalMutation) — scheduled per campus; creates
 *     exactly one `campusChallenges` row per `(campusTag, day)` via the
 *     `by_campus_and_day` index, prompt 1–280, 24h submission then 24h voting
 *     (Req 2.1). Schedules the voting transition and winner resolution.
 *   - openVoting / closeChallenge (internalMutation) — scheduled window
 *     transitions; `closeChallenge` resolves the winner (Req 2.9).
 *   - submitEntry (action) — the shared interaction lifecycle for a challenge
 *     entry: access → consent (real-person) → call-minutes metering →
 *     grounded Voice_Runtime response → fail-closed screening → persist +
 *     record a `posted_challenge_entry` Qualifying_Activity (Req 2.2–2.5, 5).
 *   - castChallengeVote (mutation) — one vote per user per challenge, latest
 *     counts, refused after close, backed by `by_challenge_and_voter`
 *     (Req 2.6, 2.7).
 *   - getChallengeLeaderboard (query) — descending votes, tie-break earliest
 *     submission, top 20, circulation-excluded, with the empty-state indication
 *     when no entries have been submitted (Req 2.8, 2.10).
 */

import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "../../_generated/server";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { Doc } from "../../_generated/dataModel";
import { api, internal } from "../../_generated/api";
import { getCurrentUserRecord } from "../../shared/ownership";
import { sha256Hex } from "../../tokenHash";
import { resolveOwnerTier } from "../usage";

import {
  buildChallengeLeaderboardView,
  challengeWindows,
  isSubmissionOpen,
  isValidChallengePrompt,
  isVotingOpen,
  resolveChallengeWinner,
  validateChallengeEntry,
  type ChallengeWindows,
  type EntryView,
  type SubmitResult,
} from "./logic/challenges";
import {
  evaluateAccess,
  type AccessDenialCode,
  type AgentAccessView,
} from "../logic/access";
import {
  evaluateConsentGate,
  type ConsentRecordView,
} from "../logic/consent";
import { canStartCall } from "../logic/usage";
import type { ScreeningDecision } from "../logic/screening";
import {
  applyQualifyingActivity,
  badgeCriteriaForActivity,
  evaluateBadgeAward,
  type StreakState,
} from "./logic/gamification";

type AnyCtx = QueryCtx | MutationCtx;

/**
 * The cumulative activity type advanced when a Student_Creator posts a
 * Challenge_Entry (Req 5.6). Matches the Gamification catalog's creator
 * activity for challenge entries.
 */
const POSTED_CHALLENGE_ENTRY_ACTIVITY = "challenge_entries_posted" as const;

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

/** Loads a Daily_Challenge by its public `challengeId`, or null when absent. */
async function getChallengeById(
  ctx: AnyCtx,
  challengeId: string
): Promise<Doc<"campusChallenges"> | null> {
  return await ctx.db
    .query("campusChallenges")
    .withIndex("by_challenge_id", (q) => q.eq("challengeId", challengeId))
    .first();
}

/** Projects a stored agent row into the minimal access-gate view. */
function agentToAccessView(agent: Doc<"campusAgents">): AgentAccessView {
  return {
    agentId: agent.agentId,
    ownerId: agent.ownerId,
    status: agent.status,
    visibility: agent.visibility,
  };
}

/**
 * True iff the authenticated `user` owns `agent`, matching whether ownership
 * was recorded as the auth `_id` or the app `userId` (mirrors the Share/Social
 * service convention so the owner check never diverges).
 */
function ownerMatches(user: Doc<"users">, agent: Doc<"campusAgents">): boolean {
  return (
    agent.ownerId === user._id ||
    (Boolean(user.userId) && agent.ownerId === user.userId)
  );
}

/** The requester id to hand the access gate (owner id when the user owns it). */
function resolveRequesterId(
  user: Doc<"users">,
  agent: Doc<"campusAgents"> | null
): string {
  if (agent && ownerMatches(user, agent)) {
    return agent.ownerId;
  }
  return user._id as unknown as string;
}

/** The stored windows of a challenge as the pure {@link ChallengeWindows}. */
function windowsOf(challenge: Doc<"campusChallenges">): ChallengeWindows {
  return {
    submissionOpensAt: challenge.submissionOpensAt,
    submissionClosesAt: challenge.submissionClosesAt,
    votingOpensAt: challenge.votingOpensAt,
    votingClosesAt: challenge.votingClosesAt,
  };
}

/** Counts the current Challenge_Votes per entry for a challenge. */
async function tallyVotes(
  ctx: AnyCtx,
  challengeId: string
): Promise<Map<string, number>> {
  const rows = await ctx.db
    .query("campusChallengeVotes")
    .withIndex("by_challenge_id", (q) => q.eq("challengeId", challengeId))
    .collect();
  const tally = new Map<string, number>();
  for (const row of rows) {
    tally.set(row.entryId, (tally.get(row.entryId) ?? 0) + 1);
  }
  return tally;
}

/** A stable, hashed voter identity for `by_challenge_and_voter` (Req 2.6). */
async function deriveVoterKey(user: Doc<"users">): Promise<string> {
  return await sha256Hex(`campus_challenge_voter:${user._id as unknown as string}`);
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

/**
 * The `YYYY-MM-DD` calendar day of `nowMs` in the Campus_Platform's configured
 * reference time zone (UTC, matching the Usage_Meter's period key), used as the
 * active-day key for Streak arithmetic (Req 5.1).
 */
function referenceDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/**
 * Records a creator-side Qualifying_Activity (Req 5): advances the
 * Creator_Streak (at most one increment per reference-tz day), increments the
 * cumulative activity counter, and awards any newly-earned Badges exactly once.
 * Delegates every decision to the pure Gamification logic so the streak/badge
 * rules the property tests exercise are the rules enforced here.
 */
async function recordCreatorActivity(
  ctx: MutationCtx,
  userId: string,
  activityType: string,
  nowMs: number
): Promise<void> {
  const activityDay = referenceDay(nowMs);

  // Creator_Streak (Req 5.1, 5.2, 5.4, 5.9).
  const streakRow = await ctx.db
    .query("campusStreaks")
    .withIndex("by_user_and_kind", (q) =>
      q.eq("userId", userId).eq("kind", "creator")
    )
    .first();
  const priorState: StreakState = {
    count: streakRow?.count ?? 0,
    lastActiveDay: streakRow?.lastActiveDay ?? null,
  };
  const nextState = applyQualifyingActivity(priorState, activityDay);
  if (streakRow) {
    await ctx.db.patch(streakRow._id, {
      count: nextState.count,
      lastActiveDay: nextState.lastActiveDay ?? undefined,
      updatedAt: nowMs,
    });
  } else {
    await ctx.db.insert("campusStreaks", {
      userId,
      kind: "creator",
      count: nextState.count,
      lastActiveDay: nextState.lastActiveDay ?? undefined,
      updatedAt: nowMs,
    });
  }

  // Cumulative activity counter backing Badge thresholds (Req 5.5).
  const counterRow = await ctx.db
    .query("campusActivityCounters")
    .withIndex("by_user_and_type", (q) =>
      q.eq("userId", userId).eq("activityType", activityType)
    )
    .first();
  const cumulativeCount = (counterRow?.count ?? 0) + 1;
  if (counterRow) {
    await ctx.db.patch(counterRow._id, {
      count: cumulativeCount,
      updatedAt: nowMs,
    });
  } else {
    await ctx.db.insert("campusActivityCounters", {
      userId,
      activityType,
      count: cumulativeCount,
      updatedAt: nowMs,
    });
  }

  // Idempotent Badge awards at each milestone tier (Req 5.5, 5.8).
  for (const criterion of badgeCriteriaForActivity(activityType)) {
    const existing = await ctx.db
      .query("campusBadges")
      .withIndex("by_user_and_badge", (q) =>
        q.eq("userId", userId).eq("badgeKey", criterion.badgeKey)
      )
      .first();
    const decision = evaluateBadgeAward({
      cumulativeCount,
      criterion,
      alreadyAwarded: existing !== null,
    });
    if (decision.award) {
      await ctx.db.insert("campusBadges", {
        userId,
        badgeKey: criterion.badgeKey,
        category: criterion.category,
        awardedAt: nowMs,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// publishDailyChallenge — one per (campusTag, day) (Req 2.1)
// ---------------------------------------------------------------------------

/** Discriminated outcome of `publishDailyChallenge`. */
type PublishChallengeResult =
  | { created: true; challengeId: string }
  | { created: false; reason: "already_published"; challengeId: string }
  | { created: false; reason: "invalid_prompt" };

/**
 * Publishes the Daily_Challenge for a campus and local calendar day (Req 2.1).
 * Scheduled per campus (one invocation per `(campusTag, day)`), it creates
 * exactly one `campusChallenges` row keyed by `(campusTag, day)` — the
 * `by_campus_and_day` index makes a duplicate a no-op (`already_published`) so
 * re-runs are idempotent. The Challenge_Prompt is bounded to 1–280 characters
 * (via the pure {@link isValidChallengePrompt}); the 24h submission window opens
 * at the campus-local day start (`localDayStartMs`) and the subsequent 24h
 * voting window follows (via the pure {@link challengeWindows}). It schedules the
 * submission→voting transition and the winner resolution at their boundaries.
 * Internal — invoked by the per-campus scheduler, not by a client.
 */
export const publishDailyChallenge = internalMutation({
  args: {
    campusTag: v.string(),
    day: v.string(),
    prompt: v.string(),
    localDayStartMs: v.number(),
    ageAppropriateFor: v.optional(v.array(v.string())),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<PublishChallengeResult> => {
    // Prompt bounds (Req 2.1).
    if (!isValidChallengePrompt(args.prompt)) {
      return { created: false, reason: "invalid_prompt" };
    }

    // One Daily_Challenge per campus per local day (Req 2.1).
    const existing = await ctx.db
      .query("campusChallenges")
      .withIndex("by_campus_and_day", (q) =>
        q.eq("campusTag", args.campusTag).eq("day", args.day)
      )
      .first();
    if (existing) {
      return {
        created: false,
        reason: "already_published",
        challengeId: existing.challengeId,
      };
    }

    const now = args.now ?? Date.now();
    const windows = challengeWindows(args.localDayStartMs);
    const challengeId = generateId("CHAL");

    await ctx.db.insert("campusChallenges", {
      challengeId,
      campusTag: args.campusTag,
      day: args.day,
      prompt: args.prompt,
      submissionOpensAt: windows.submissionOpensAt,
      submissionClosesAt: windows.submissionClosesAt,
      votingOpensAt: windows.votingOpensAt,
      votingClosesAt: windows.votingClosesAt,
      status: "submitting",
      ageAppropriateFor: args.ageAppropriateFor ?? [],
      createdAt: now,
    });

    // Schedule the window transitions (Req 2.1) and winner resolution (Req 2.9).
    await ctx.scheduler.runAt(
      windows.votingOpensAt,
      internal.campus.social.challenges.openVoting,
      { challengeId }
    );
    await ctx.scheduler.runAt(
      windows.votingClosesAt,
      internal.campus.social.challenges.closeChallenge,
      { challengeId }
    );

    return { created: true, challengeId };
  },
});

/**
 * Transitions a Daily_Challenge from `submitting` to `voting` at the end of its
 * submission window (Req 2.1). Internal — scheduled by
 * {@link publishDailyChallenge}. Idempotent: a challenge already in `voting` or
 * `closed` is left unchanged.
 */
export const openVoting = internalMutation({
  args: { challengeId: v.string() },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    const challenge = await getChallengeById(ctx, args.challengeId);
    if (!challenge || challenge.status !== "submitting") {
      return { ok: false };
    }
    await ctx.db.patch(challenge._id, { status: "voting" });
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// closeChallenge — resolve the winning Challenge_Entry (Req 2.9)
// ---------------------------------------------------------------------------

/**
 * Closes a Daily_Challenge at the end of its voting period and records the
 * winning Challenge_Entry (Req 2.9). Internal — scheduled by
 * {@link publishDailyChallenge}. The winner is the entry with the greatest
 * Challenge_Vote count, tie-broken by earliest submission (via the pure
 * {@link resolveChallengeWinner}); the winning entry id is recorded on the
 * challenge, which advances the winning Student_Creator's standing surfaced by
 * the campus leaderboard. Idempotent: an already-`closed` challenge is a no-op.
 */
export const closeChallenge = internalMutation({
  args: { challengeId: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: boolean; winningEntryId?: string }> => {
    const challenge = await getChallengeById(ctx, args.challengeId);
    if (!challenge || challenge.status === "closed") {
      return { ok: false };
    }

    const entryRows = await ctx.db
      .query("campusChallengeEntries")
      .withIndex("by_challenge_id", (q) =>
        q.eq("challengeId", args.challengeId)
      )
      .collect();
    const tally = await tallyVotes(ctx, args.challengeId);
    const entryViews = await buildEntryViews(ctx, entryRows, tally);

    const winner = resolveChallengeWinner(entryViews);
    await ctx.db.patch(challenge._id, {
      status: "closed",
      winningEntryId: winner?.entryId,
    });

    return { ok: true, winningEntryId: winner?.entryId };
  },
});

/**
 * Joins stored Challenge_Entry rows with their agent's circulation state and
 * current vote tally into the pure {@link EntryView} shape consumed by ranking
 * and winner resolution. An entry whose agent no longer exists is treated as a
 * `deleted` agent so it is excluded by {@link isDiscoverable}.
 */
async function buildEntryViews(
  ctx: AnyCtx,
  entryRows: readonly Doc<"campusChallengeEntries">[],
  tally: Map<string, number>
): Promise<EntryView[]> {
  const views: EntryView[] = [];
  for (const entry of entryRows) {
    const agent = await getAgentById(ctx, entry.agentId);
    views.push({
      entryId: entry.entryId,
      agentId: entry.agentId,
      status: agent?.status ?? "deleted",
      visibility: agent?.visibility ?? "private",
      submittedAt: entry.submittedAt,
      votes: tally.get(entry.entryId) ?? 0,
    });
  }
  return views;
}

// ---------------------------------------------------------------------------
// submitEntry — the shared interaction lifecycle (Req 2.2–2.5, 5)
// ---------------------------------------------------------------------------

/**
 * The resolved context the `submitEntry` action needs to run the shared
 * interaction lifecycle, gathered in one authenticated read. Every field is a
 * plain value so the action can drive the pure gates without further I/O.
 */
type SubmitContext =
  | { found: false; reason: "not_authenticated" | "no_challenge" | "no_agent" }
  | {
      found: true;
      ownerId: string;
      accessView: AgentAccessView;
      isOwner: boolean;
      representsRealPerson: boolean;
      consents: ConsentRecordView[];
      tier: "free" | "paid";
      callMinutesUsed: number;
      submissionOpen: boolean;
      alreadyEntered: boolean;
    };

/** The calendar-month period key (`YYYY-MM`, UTC), matching the Usage_Meter. */
function periodKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 7);
}

/**
 * Resolves everything the challenge-entry lifecycle depends on in a single
 * authenticated read: the submitting user's ownership of the agent, the agent's
 * access view + real-person declaration + Voice_Clone_Consent records, the
 * owning account's tier + call-minutes usage, whether the submission window is
 * open, and whether the agent has already entered this challenge. Internal —
 * called by {@link submitEntry} (identity propagates from the action).
 */
export const getSubmitContext = internalQuery({
  args: { challengeId: v.string(), agentId: v.string(), now: v.number() },
  handler: async (ctx, args): Promise<SubmitContext> => {
    const user = await getCurrentUserRecord(ctx);
    if (!user) {
      return { found: false, reason: "not_authenticated" };
    }

    const challenge = await getChallengeById(ctx, args.challengeId);
    if (!challenge) {
      return { found: false, reason: "no_challenge" };
    }

    const agent = await getAgentById(ctx, args.agentId);
    if (!agent) {
      return { found: false, reason: "no_agent" };
    }

    const consentRows = await ctx.db
      .query("campusVoiceCloneConsents")
      .withIndex("by_agent_id", (q) => q.eq("agentId", agent.agentId))
      .collect();
    const consents: ConsentRecordView[] = consentRows.map((c) => ({
      agentId: c.agentId,
      method: c.method,
      verified: c.verified,
    }));

    const tier = await resolveOwnerTier(ctx, agent.ownerId);
    const usageRow = await ctx.db
      .query("campusUsage")
      .withIndex("by_owner_and_period", (q) =>
        q.eq("ownerId", agent.ownerId).eq("period", periodKey(args.now))
      )
      .first();

    const existingEntry = await ctx.db
      .query("campusChallengeEntries")
      .withIndex("by_challenge_and_agent", (q) =>
        q.eq("challengeId", args.challengeId).eq("agentId", agent.agentId)
      )
      .first();

    return {
      found: true,
      ownerId: agent.ownerId,
      accessView: agentToAccessView(agent),
      isOwner: ownerMatches(user, agent),
      representsRealPerson: agent.representsRealPerson,
      consents,
      tier,
      callMinutesUsed: usageRow?.callMinutesUsed ?? 0,
      submissionOpen: isSubmissionOpen(windowsOf(challenge), args.now),
      alreadyEntered: existingEntry !== null,
    };
  },
});

/** Discriminated outcome of `submitEntry`. */
type SubmitEntryResult =
  | { accepted: true; entryId: string }
  | {
      accepted: false;
      reason:
        | "not_authenticated"
        | "no_challenge"
        | "no_agent"
        | "access_denied"
        | "unavailable"
        | "invalid"
        | "consent_required"
        | "call_minutes_exhausted"
        | "not_owner"
        | "not_published"
        | "submission_closed"
        | "already_entered"
        | "withheld_policy"
        | "withheld_screening_error";
      message: string;
    };

/**
 * Submits a Challenge_Entry through the shared social-loops interaction
 * lifecycle (design §"Shared interaction lifecycle"; Req 2.2–2.5, 5, 8.4, 8.5).
 * In order: the access gate (the agent must be reachable), the
 * Voice_Clone_Consent gate for a real-person agent, the owning account's
 * call-minutes metering, the challenge-submission validation (owned, published,
 * window open, not already entered), the grounded Voice_Runtime response (the
 * agent's response to the Challenge_Prompt, supplied as `responseText` +
 * `responseCallId`), and the fail-closed Safety_Service screening of that
 * response. Only a clean, fully-gated entry is persisted, and a successful
 * submission records a `posted_challenge_entry` Qualifying_Activity for the
 * submitting Student_Creator (Req 5). Any gate failure withholds the entry with
 * the specific reason.
 */
export const submitEntry = action({
  args: {
    challengeId: v.string(),
    agentId: v.string(),
    responseText: v.string(),
    responseCallId: v.optional(v.string()),
    responseClipId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<SubmitEntryResult> => {
    const now = Date.now();
    const context: SubmitContext = await ctx.runQuery(
      internal.campus.social.challenges.getSubmitContext,
      { challengeId: args.challengeId, agentId: args.agentId, now }
    );

    if (!context.found) {
      const message =
        context.reason === "not_authenticated"
          ? "Authentication is required to enter a challenge."
          : context.reason === "no_challenge"
            ? "This challenge no longer exists."
            : "This agent no longer exists.";
      return { accepted: false, reason: context.reason, message };
    }

    // 1. Access gate — the agent must be reachable by its owner (Req 8.6).
    const access = evaluateAccess({
      agent: context.accessView,
      requesterId: context.ownerId,
    });
    if (!access.granted) {
      const denial: AccessDenialCode = access.denial;
      return {
        accepted: false,
        reason: denial,
        message:
          denial === "unavailable"
            ? "This agent is not available."
            : "You do not have access to this agent.",
      };
    }

    // 2. Voice_Clone_Consent gate for a real-person agent (Req 7.10, 7.11).
    const consent = evaluateConsentGate({
      agentId: context.accessView.agentId,
      representsRealPerson: context.representsRealPerson,
      consents: context.consents,
    });
    if (!consent.permitted) {
      return {
        accepted: false,
        reason: "consent_required",
        message: "Verified Voice_Clone_Consent is required to participate.",
      };
    }

    // 3. Call-minutes metering against the owning account (Req 8.4, 8.5).
    const gate = canStartCall(context.callMinutesUsed, context.tier);
    if (!gate.allowed) {
      return {
        accepted: false,
        reason: "call_minutes_exhausted",
        message: "This agent is temporarily unavailable.",
      };
    }

    // 4. Challenge-submission validation (Req 2.2–2.5).
    const validation: SubmitResult = validateChallengeEntry({
      isOwner: context.isOwner,
      agentStatus: context.accessView.status,
      submissionOpen: context.submissionOpen,
      agentAlreadyEntered: context.alreadyEntered,
    });
    if (!validation.accepted) {
      return {
        accepted: false,
        reason: validation.reason,
        message: validation.message,
      };
    }

    // 5. Fail-closed screening of the grounded Voice_Runtime response (Req 7.1–7.3).
    const decision: ScreeningDecision = await ctx.runAction(
      api.campus.safety.screenContent,
      { content: args.responseText, internalSecret: process.env.INTERNAL_API_KEY }
    );
    if (decision.withheld) {
      return decision.error
        ? {
            accepted: false,
            reason: "withheld_screening_error",
            message: "Screening could not complete; the entry was withheld.",
          }
        : {
            accepted: false,
            reason: "withheld_policy",
            message: "The entry was withheld for a content-policy violation.",
          };
    }

    // 6. Persist the entry + record the Qualifying_Activity (Req 2.2, 5).
    const result: SubmitEntryResult = await ctx.runMutation(
      internal.campus.social.challenges.persistEntry,
      {
        challengeId: args.challengeId,
        agentId: args.agentId,
        responseCallId: args.responseCallId,
        responseClipId: args.responseClipId,
        submittedAt: now,
      }
    );
    return result;
  },
});

/**
 * Persists a validated Challenge_Entry and records the submitting creator's
 * `posted_challenge_entry` Qualifying_Activity (Req 2.2, 5). Internal — invoked
 * by {@link submitEntry} after every gate has passed. Re-derives the
 * authenticated owner and re-checks ownership, published state, the open
 * submission window, and one-entry-per-agent as a race guard so a concurrent
 * duplicate can never create a second entry (Req 2.4).
 */
export const persistEntry = internalMutation({
  args: {
    challengeId: v.string(),
    agentId: v.string(),
    responseCallId: v.optional(v.string()),
    responseClipId: v.optional(v.string()),
    submittedAt: v.number(),
  },
  handler: async (ctx, args): Promise<SubmitEntryResult> => {
    const user = await getCurrentUserRecord(ctx);
    if (!user) {
      return {
        accepted: false,
        reason: "not_authenticated",
        message: "Authentication is required to enter a challenge.",
      };
    }

    const challenge = await getChallengeById(ctx, args.challengeId);
    if (!challenge) {
      return {
        accepted: false,
        reason: "no_challenge",
        message: "This challenge no longer exists.",
      };
    }

    const agent = await getAgentById(ctx, args.agentId);
    if (!agent) {
      return {
        accepted: false,
        reason: "no_agent",
        message: "This agent no longer exists.",
      };
    }

    // Race-guard re-validation (Req 2.2–2.5).
    const existingEntry = await ctx.db
      .query("campusChallengeEntries")
      .withIndex("by_challenge_and_agent", (q) =>
        q.eq("challengeId", args.challengeId).eq("agentId", agent.agentId)
      )
      .first();
    const validation = validateChallengeEntry({
      isOwner: ownerMatches(user, agent),
      agentStatus: agent.status,
      submissionOpen: isSubmissionOpen(windowsOf(challenge), args.submittedAt),
      agentAlreadyEntered: existingEntry !== null,
    });
    if (!validation.accepted) {
      return {
        accepted: false,
        reason: validation.reason,
        message: validation.message,
      };
    }

    const entryId = generateId("CENT");
    await ctx.db.insert("campusChallengeEntries", {
      entryId,
      challengeId: args.challengeId,
      agentId: agent.agentId,
      ownerId: agent.ownerId,
      responseCallId: args.responseCallId,
      responseClipId: args.responseClipId,
      submittedAt: args.submittedAt,
      createdAt: args.submittedAt,
    });

    // Qualifying_Activity: the creator posted a Challenge_Entry (Req 5).
    await recordCreatorActivity(
      ctx,
      agent.ownerId,
      POSTED_CHALLENGE_ENTRY_ACTIVITY,
      args.submittedAt
    );

    return { accepted: true, entryId };
  },
});

// ---------------------------------------------------------------------------
// castChallengeVote — one vote per user per challenge, latest wins (Req 2.6, 2.7)
// ---------------------------------------------------------------------------

/** Discriminated outcome of `castChallengeVote`. */
type CastVoteResult =
  | { accepted: true }
  | {
      accepted: false;
      reason: "not_authenticated" | "no_challenge" | "invalid_entry" | "voting_closed";
      message: string;
    };

/**
 * Records the authenticated user's Challenge_Vote for a Challenge_Entry
 * (Req 2.6, 2.7). While the voting period is open a user casts at most one vote
 * per Daily_Challenge and the most recent selection counts: the existing
 * `(challengeId, voterKey)` row (backed by `by_challenge_and_voter`) is updated
 * in place, so a changed vote never inflates the tally and a repeat is
 * idempotent. Once the voting period has closed the vote is refused
 * (`voting_closed`). The selected entry must belong to the challenge.
 */
export const castChallengeVote = mutation({
  args: { challengeId: v.string(), entryId: v.string() },
  handler: async (ctx, args): Promise<CastVoteResult> => {
    const user = await getCurrentUserRecord(ctx);
    if (!user) {
      return {
        accepted: false,
        reason: "not_authenticated",
        message: "Authentication is required to vote.",
      };
    }

    const challenge = await getChallengeById(ctx, args.challengeId);
    if (!challenge) {
      return {
        accepted: false,
        reason: "no_challenge",
        message: "This challenge no longer exists.",
      };
    }

    // Voting must be open (Req 2.7).
    if (!isVotingOpen(windowsOf(challenge), Date.now())) {
      return {
        accepted: false,
        reason: "voting_closed",
        message: "Voting for this challenge is closed.",
      };
    }

    // The selection must be an entry in this challenge.
    const entry = await ctx.db
      .query("campusChallengeEntries")
      .withIndex("by_entry_id", (q) => q.eq("entryId", args.entryId))
      .first();
    if (!entry || entry.challengeId !== args.challengeId) {
      return {
        accepted: false,
        reason: "invalid_entry",
        message: "That entry is not part of this challenge.",
      };
    }

    // One vote per user per challenge, latest selection wins (Req 2.6).
    const voterKey = await deriveVoterKey(user);
    const now = Date.now();
    const existing = await ctx.db
      .query("campusChallengeVotes")
      .withIndex("by_challenge_and_voter", (q) =>
        q.eq("challengeId", args.challengeId).eq("voterKey", voterKey)
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { entryId: args.entryId, updatedAt: now });
    } else {
      await ctx.db.insert("campusChallengeVotes", {
        challengeId: args.challengeId,
        voterKey,
        entryId: args.entryId,
        updatedAt: now,
      });
    }

    return { accepted: true };
  },
});

// ---------------------------------------------------------------------------
// getChallengeLeaderboard — ranked entries + empty-state (Req 2.8, 2.10)
// ---------------------------------------------------------------------------

/** One row of the presented Challenge_Leaderboard. */
interface LeaderboardRow {
  entryId: string;
  agentId: string;
  votes: number;
  submittedAt: number;
}

/** The Challenge_Leaderboard view returned to the client. */
type ChallengeLeaderboardResult =
  | { found: false }
  | {
      found: true;
      challengeId: string;
      prompt: string;
      /** The ranked leaderboard rows (top 20, circulation-excluded) (Req 2.8). */
      entries: LeaderboardRow[];
      /** True when no Challenge_Entry has been submitted (Req 2.10). */
      isEmpty: boolean;
      /** The empty-state indication text, present only when `isEmpty` (Req 2.10). */
      emptyState?: string;
    };

/**
 * Presents the per-campus Challenge_Leaderboard for a Daily_Challenge (Req 2.8,
 * 2.10). The ranking (descending by Challenge_Vote count, tie-broken by earliest
 * submission, bounded to the top 20, excluding any entry whose agent is not in
 * circulation) is delegated to the pure {@link rankChallengeLeaderboard}. When
 * no Challenge_Entry has been submitted for the challenge, the result carries
 * the empty-state indication that no entries have been submitted (Req 2.10).
 * Public — anyone viewing the challenge can read the leaderboard.
 */
export const getChallengeLeaderboard = query({
  args: { challengeId: v.string() },
  handler: async (ctx, args): Promise<ChallengeLeaderboardResult> => {
    const challenge = await getChallengeById(ctx, args.challengeId);
    if (!challenge) {
      return { found: false };
    }

    const entryRows = await ctx.db
      .query("campusChallengeEntries")
      .withIndex("by_challenge_id", (q) =>
        q.eq("challengeId", args.challengeId)
      )
      .collect();

    // Empty-state: no Challenge_Entry has been submitted at all (Req 2.10).
    if (entryRows.length === 0) {
      return {
        found: true,
        challengeId: challenge.challengeId,
        prompt: challenge.prompt,
        entries: [],
        isEmpty: true,
        emptyState: "No entries have been submitted yet.",
      };
    }

    const tally = await tallyVotes(ctx, args.challengeId);
    const entryViews = await buildEntryViews(ctx, entryRows, tally);
    const view = buildChallengeLeaderboardView(entryViews);

    return {
      found: true,
      challengeId: challenge.challengeId,
      prompt: challenge.prompt,
      entries: view.entries.map((e) => ({
        entryId: e.entryId,
        agentId: e.agentId,
        votes: e.votes,
        submittedAt: e.submittedAt,
      })),
      // A non-empty submission set is never the empty-state; the "no entries
      // submitted" empty-state (Req 2.10) is handled by the early return above.
      isEmpty: view.isEmpty,
    };
  },
});
