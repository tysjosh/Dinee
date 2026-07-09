/**
 * Feature: dinee-campus (Task 25.1) — Analytics_Aggregator Convex service.
 *
 * Thin Convex wrapper around the pure, property-tested analytics core in
 * `./logic/analytics.ts`. This module owns persistence (appending raw
 * `campusEvents`) and authorization (the owner-gate); every aggregation,
 * ranking, period-filter, and owner-gate decision is delegated to the pure
 * functions so the correctness properties (9.1–9.8) stay directly testable.
 *
 * Exposed functions (design → `convex/campus/analytics.ts`):
 *   - recordEvent        (mutation) appends a raw interaction event to
 *                        `campusEvents` — the signal the Analytics_Aggregator
 *                        rolls into an agent's metrics (Req 9.1–9.5)
 *   - getAgentAnalytics  (query)    owner-gated aggregation for a reporting
 *                        period, reading pre-aggregated `campusAnalyticsDaily`
 *                        rows plus the live events of any day not yet rolled up.
 *                        Defaults to the trailing 30 days; discloses nothing to
 *                        non-owners (Req 9.1–9.8)
 *
 * Period aggregation strategy (Req 9.8, "recompute within 3s"): a daily cron
 * (Task 25.2) rolls completed days of `campusEvents` into `campusAnalyticsDaily`
 * so a month-long period is served from ≤ ~30 pre-aggregated rows. Any day NOT
 * yet covered by a rollup (in steady state, the current UTC day) is recomputed
 * from its raw `campusEvents` + `campusRatings`, and the two are merged by the
 * pure `aggregateWithRollups`. Reading raw events only for un-rolled days keeps
 * the query bounded while remaining correct before/independent of the cron.
 */

import { v } from "convex/values";
import { internalMutation, mutation, query } from "../_generated/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { getCurrentUserRecord } from "../shared/ownership";

import {
  aggregateWithRollups,
  authorizeAnalyticsAccess,
  computeDailyRollup,
  isWithinPeriod,
  resolvePeriod,
  type AnalyticsEvent,
  type AnalyticsEventType,
  type AnalyticsSummary,
  type DailyRollup,
  type Period,
  type RatingRecord,
} from "./logic/analytics";

/** Milliseconds in one day. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

type AnyCtx = QueryCtx | MutationCtx;

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

/**
 * Convex validator for the raw interaction-event kinds, matching the
 * `campusEvents.type` union in the schema and the `AnalyticsEventType` union in
 * the pure core.
 */
const eventTypeValidator = v.union(
  v.literal("call_completed"),
  v.literal("share"),
  v.literal("save"),
  v.literal("remix"),
  v.literal("question"),
  v.literal("event_interest"),
  v.literal("join_intent"),
  v.literal("contact_click"),
  v.literal("conversion_click"),
  v.literal("quiz_completed"),
  v.literal("confusing_topic"),
  v.literal("explanation_request")
);

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

/** Formats a millisecond timestamp as a UTC `YYYY-MM-DD` day key. */
function toUtcDay(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/**
 * Resolves the requester id to hand the analytics owner-gate. When the
 * authenticated user owns `agent`, returns the agent's `ownerId` so the gate's
 * owner check matches regardless of whether ownership was recorded as the auth
 * `_id` or the app `userId`; otherwise returns the user's `_id` (a non-owner)
 * or `null` when anonymous. Mirrors the convention in `share.ts`.
 */
async function resolveRequesterId(
  ctx: AnyCtx,
  agent: Doc<"campusAgents"> | null
): Promise<string | null> {
  const user = await getCurrentUserRecord(ctx);
  if (!user) {
    return null;
  }
  if (
    agent &&
    (agent.ownerId === user._id ||
      (Boolean(user.userId) && agent.ownerId === user.userId))
  ) {
    return agent.ownerId;
  }
  return user._id as unknown as string;
}

/** Projects a stored `campusEvents` row into the pure `AnalyticsEvent` shape. */
function toAnalyticsEvent(row: Doc<"campusEvents">): AnalyticsEvent {
  return {
    type: row.type as AnalyticsEventType,
    createdAt: row.createdAt,
    callId: row.callId,
    callerKey: row.callerKey,
    questionText: row.questionText,
    durationSeconds: row.durationSeconds,
  };
}

/** Copies a (possibly readonly) ranked list into a fresh, storable array. */
function toStoredRanked(
  entries: readonly { text: string; count: number }[]
): { text: string; count: number }[] {
  return entries.map((entry) => ({ text: entry.text, count: entry.count }));
}

/**
 * Normalizes the pure rollup's `typeMetrics` (readonly arrays) into the mutable
 * shape expected by the `campusAnalyticsDaily.typeMetrics` schema validator,
 * copying only the fields that are present.
 */
function toStoredTypeMetrics(
  tm: NonNullable<DailyRollup["typeMetrics"]>
): {
  confusingTopics?: { text: string; count: number }[];
  requestedExplanations?: { text: string; count: number }[];
  quizCompletions?: number;
  eventInterest?: number;
  joinIntent?: number;
  contactClicks?: number;
  conversionClicks?: number;
} {
  return {
    ...(tm.confusingTopics !== undefined
      ? { confusingTopics: toStoredRanked(tm.confusingTopics) }
      : {}),
    ...(tm.requestedExplanations !== undefined
      ? { requestedExplanations: toStoredRanked(tm.requestedExplanations) }
      : {}),
    ...(tm.quizCompletions !== undefined
      ? { quizCompletions: tm.quizCompletions }
      : {}),
    ...(tm.eventInterest !== undefined
      ? { eventInterest: tm.eventInterest }
      : {}),
    ...(tm.joinIntent !== undefined ? { joinIntent: tm.joinIntent } : {}),
    ...(tm.contactClicks !== undefined
      ? { contactClicks: tm.contactClicks }
      : {}),
    ...(tm.conversionClicks !== undefined
      ? { conversionClicks: tm.conversionClicks }
      : {}),
  };
}

/** Projects a stored `campusAnalyticsDaily` row into the pure `DailyRollup` shape. */
function toDailyRollup(row: Doc<"campusAnalyticsDaily">): DailyRollup {
  return {
    callCount: row.callCount,
    uniqueCallerCount: row.uniqueCallerCount,
    shareCount: row.shareCount,
    saveRemixCount: row.saveRemixCount,
    totalDurationSeconds: row.totalDurationSeconds,
    ratingSum: row.ratingSum,
    ratingCount: row.ratingCount,
    topQuestions: row.topQuestions,
    typeMetrics: row.typeMetrics,
  };
}

// ---------------------------------------------------------------------------
// recordEvent — append raw analytics event (Req 9.1–9.5)
// ---------------------------------------------------------------------------

/** Discriminated outcome of `recordEvent`. */
type RecordEventResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "unavailable" };

/**
 * Appends a raw interaction event for a Campus_Agent to `campusEvents`
 * (Req 9.1–9.5) — the signal the Analytics_Aggregator rolls into the agent's
 * call/share/save/remix counts, top-questions ranking, and type-specific
 * metrics. Not owner-gated: events originate from Callers and the Voice_Runtime
 * (server-to-server), not the owner. The event is recorded for any existing,
 * non-deleted agent; a missing agent yields `not_found` and a deleted agent
 * yields `unavailable` so no event is attributed to a removed identity.
 */
export const recordEvent = mutation({
  args: {
    agentId: v.string(),
    type: eventTypeValidator,
    callId: v.optional(v.string()),
    callerKey: v.optional(v.string()),
    questionText: v.optional(v.string()),
    durationSeconds: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<RecordEventResult> => {
    const agent = await getAgentById(ctx, args.agentId);
    if (!agent) {
      return { ok: false, reason: "not_found" };
    }
    if (agent.status === "deleted") {
      return { ok: false, reason: "unavailable" };
    }

    await ctx.db.insert("campusEvents", {
      agentId: agent.agentId,
      type: args.type,
      callId: args.callId,
      callerKey: args.callerKey,
      questionText: args.questionText,
      durationSeconds: args.durationSeconds,
      createdAt: Date.now(),
    });
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// getAgentAnalytics — owner-gated period aggregation (Req 9.1–9.8)
// ---------------------------------------------------------------------------

/** Discriminated outcome of `getAgentAnalytics`. */
type GetAgentAnalyticsResult =
  | { authorized: false; error: "unauthorized" }
  | { authorized: true; period: Period; analytics: AnalyticsSummary };

/**
 * Returns the owner-gated Analytics_Dashboard metrics for a Campus_Agent over a
 * reporting period (Req 9.1–9.8). Access is granted only to the agent's owner;
 * every other case — anonymous, a non-owner, or a missing agent — is denied as
 * `unauthorized` and discloses nothing about the agent (Req 9.6).
 *
 * The period defaults to the trailing {@link resolvePeriod} 30-day window when
 * no bounds are supplied (Req 9.8). Completed days are served from the
 * pre-aggregated `campusAnalyticsDaily` rollup; any day inside the window that
 * does not yet have a rollup row (in steady state, the current UTC day) is
 * recomputed from its raw `campusEvents` and `campusRatings`. The rollups and
 * the un-rolled live activity are merged by the pure `aggregateWithRollups`, so
 * no day is double-counted and the period recomputes from a bounded set of rows.
 */
export const getAgentAnalytics = query({
  args: {
    agentId: v.string(),
    startMs: v.optional(v.number()),
    endMs: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<GetAgentAnalyticsResult> => {
    const agent = await getAgentById(ctx, args.agentId);

    // Owner-gate (Req 9.6): deny and disclose nothing unless the requester owns
    // the agent. Resolving against a missing agent yields a null owner, which
    // the pure gate treats as unauthorized.
    const requesterId = await resolveRequesterId(ctx, agent);
    const gate = authorizeAnalyticsAccess(requesterId, agent?.ownerId ?? null);
    if (!gate.authorized) {
      return { authorized: false, error: "unauthorized" };
    }
    // `authorized` implies the requester matched a real agent's owner id.
    const ownedAgent = agent as Doc<"campusAgents">;

    const now = Date.now();
    const period = resolvePeriod(now, {
      startMs: args.startMs,
      endMs: args.endMs,
    });

    // 1) Pre-aggregated daily rollups for the days spanned by the period, up to
    //    (but not including) the current UTC day, which is served live. The
    //    `day` keys are YYYY-MM-DD so a lexicographic range matches the window.
    const startDay = toUtcDay(period.startMs);
    const endDay = toUtcDay(period.endMs);
    const todayDay = toUtcDay(now);
    const rollupRows = await ctx.db
      .query("campusAnalyticsDaily")
      .withIndex("by_agent_and_day", (q) =>
        q.eq("agentId", ownedAgent.agentId).gte("day", startDay).lt("day", todayDay)
      )
      .collect();

    const rolledDays = new Set<string>();
    const rollups: DailyRollup[] = [];
    for (const row of rollupRows) {
      // A custom period may end before today; skip rollup days past its end.
      if (row.day > endDay) continue;
      rolledDays.add(row.day);
      rollups.push(toDailyRollup(row));
    }

    // 2) Live events for any day in the window NOT covered by a rollup. Reading
    //    from the current day's midnight keeps the scan bounded in steady state;
    //    the `rolledDays` filter guarantees no overlap with the rollups.
    const liveStart = Math.max(
      period.startMs,
      Date.parse(`${todayDay}T00:00:00.000Z`)
    );
    let liveEvents: AnalyticsEvent[] = [];
    let liveRatings: RatingRecord[] = [];
    if (liveStart <= period.endMs) {
      const eventRows = await ctx.db
        .query("campusEvents")
        .withIndex("by_agent_and_time", (q) =>
          q
            .eq("agentId", ownedAgent.agentId)
            .gte("createdAt", liveStart)
            .lte("createdAt", period.endMs)
        )
        .collect();
      liveEvents = eventRows
        .filter((row) => !rolledDays.has(toUtcDay(row.createdAt)))
        .map(toAnalyticsEvent);

      // Ratings have no time index; scope to the agent then filter to the live
      // window in memory (a single agent's ratings are a small set).
      const ratingRows = await ctx.db
        .query("campusRatings")
        .withIndex("by_agent_id", (q) => q.eq("agentId", ownedAgent.agentId))
        .collect();
      liveRatings = ratingRows
        .filter(
          (row) =>
            isWithinPeriod(row.createdAt, period) &&
            row.createdAt >= liveStart &&
            !rolledDays.has(toUtcDay(row.createdAt))
        )
        .map((row) => ({ value: row.rating, createdAt: row.createdAt }));
    }

    const analytics = aggregateWithRollups(rollups, {
      events: liveEvents,
      ratings: liveRatings,
      // The rollup does not retain per-call summaries and there is no queryable
      // campus summary store yet, so recent summaries are surfaced empty here.
      summaries: [],
      agentType: ownedAgent.agentType,
      hasMonetizationLink:
        typeof ownedAgent.monetizationLink === "string" &&
        ownedAgent.monetizationLink.length > 0,
    });

    return { authorized: true, period, analytics };
  },
});

// ---------------------------------------------------------------------------
// rollupDailyAnalytics — daily cron rollup of raw events → daily rows (Req 9.8)
// ---------------------------------------------------------------------------

/** Summary of a rollup run, useful for logging/tests. */
type RollupResult = {
  day: string;
  agentsProcessed: number;
  rowsWritten: number;
};

/**
 * Rolls a single completed UTC day of raw `campusEvents` (and `campusRatings`)
 * into one pre-aggregated `campusAnalyticsDaily` row per Campus_Agent (Req 9.8).
 *
 * Invoked by the daily cron (see `convex/crons.ts`) with no arguments, in which
 * case it rolls up the day immediately before the current UTC day — the last
 * fully-completed day, which `getAgentAnalytics` serves from rollups (it reads
 * live events only for the current UTC day). An explicit `nowMs` may be supplied
 * to roll up relative to a fixed clock (used by tests).
 *
 * For each agent with activity in the target day, the raw events and the
 * in-window ratings are aggregated by the pure, property-tested
 * {@link computeDailyRollup}, then upserted (keyed by `agentId` + `day`) so a
 * re-run is idempotent. Agents with no activity that day are skipped, keeping
 * the rollup table sparse. This is an internal mutation — it is not part of the
 * public API surface and is only reachable via the scheduler.
 */
export const rollupDailyAnalytics = internalMutation({
  args: { nowMs: v.optional(v.number()) },
  handler: async (ctx, args): Promise<RollupResult> => {
    const now = typeof args.nowMs === "number" ? args.nowMs : Date.now();

    // Target the last fully-completed UTC day: [dayStart, dayEnd] inclusive.
    const todayMidnight = Date.parse(`${toUtcDay(now)}T00:00:00.000Z`);
    const dayStart = todayMidnight - MS_PER_DAY;
    const dayEnd = todayMidnight - 1;
    const day = toUtcDay(dayStart);

    // Bounded by the number of agents; each agent's events for the day are read
    // through the `by_agent_and_time` index rather than scanning all events.
    const agents = await ctx.db.query("campusAgents").collect();

    let rowsWritten = 0;
    for (const agent of agents) {
      const eventRows = await ctx.db
        .query("campusEvents")
        .withIndex("by_agent_and_time", (q) =>
          q
            .eq("agentId", agent.agentId)
            .gte("createdAt", dayStart)
            .lte("createdAt", dayEnd)
        )
        .collect();

      // Ratings have no time index; scope to the agent then filter to the day
      // window in memory (a single agent's ratings are a small set).
      const ratingRows = await ctx.db
        .query("campusRatings")
        .withIndex("by_agent_id", (q) => q.eq("agentId", agent.agentId))
        .collect();
      const dayRatings: RatingRecord[] = ratingRows
        .filter((row) => row.createdAt >= dayStart && row.createdAt <= dayEnd)
        .map((row) => ({ value: row.rating, createdAt: row.createdAt }));

      // Nothing happened for this agent on the target day — skip so the rollup
      // table stays sparse.
      if (eventRows.length === 0 && dayRatings.length === 0) {
        continue;
      }

      const rollup: DailyRollup = computeDailyRollup({
        events: eventRows.map(toAnalyticsEvent),
        ratings: dayRatings,
        agentType: agent.agentType,
        hasMonetizationLink:
          typeof agent.monetizationLink === "string" &&
          agent.monetizationLink.length > 0,
      });

      const row = {
        agentId: agent.agentId,
        day,
        callCount: rollup.callCount,
        uniqueCallerCount: rollup.uniqueCallerCount,
        shareCount: rollup.shareCount,
        saveRemixCount: rollup.saveRemixCount,
        totalDurationSeconds: rollup.totalDurationSeconds,
        ratingSum: rollup.ratingSum,
        ratingCount: rollup.ratingCount,
        topQuestions: toStoredRanked(rollup.topQuestions),
        ...(rollup.typeMetrics !== undefined
          ? { typeMetrics: toStoredTypeMetrics(rollup.typeMetrics) }
          : {}),
      };

      // Upsert keyed by (agentId, day) so a re-run overwrites rather than
      // duplicates the day's rollup.
      const existing = await ctx.db
        .query("campusAnalyticsDaily")
        .withIndex("by_agent_and_day", (q) =>
          q.eq("agentId", agent.agentId).eq("day", day)
        )
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, row);
      } else {
        await ctx.db.insert("campusAnalyticsDaily", row);
      }
      rowsWritten += 1;
    }

    return { day, agentsProcessed: agents.length, rowsWritten };
  },
});
