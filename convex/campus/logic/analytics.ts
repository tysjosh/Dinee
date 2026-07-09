/**
 * Feature: dinee-campus (Task 11.1)
 *
 * Pure, property-testable core for the Analytics_Aggregator: metric
 * aggregation, ranked-list construction, reporting-period filtering, and the
 * owner-access gate (Requirements 9.1–9.8). These functions carry NO Convex
 * `ctx` and perform no I/O, so they can be exercised directly by unit and
 * property tests and imported by the Convex `analytics.ts` service that wraps
 * them with `campusEvents` / `campusAnalyticsDaily` reads.
 *
 * Covered behaviors:
 *   - 9.1: total call count, unique-caller count, share count, save/remix count
 *     as non-negative integers; average call duration in seconds (0 when no
 *     calls); average call rating on a 1..5 scale rounded to one decimal.
 *   - 9.2: top 10 most-asked questions ranked by descending frequency; the 20
 *     most-recent call summaries.
 *   - 9.3: study_agent confusing-topics and requested-explanations lists
 *     (top 10, descending frequency) and quiz-completion count.
 *   - 9.4: club_agent event-interest / join-intent / contact-click counts.
 *   - 9.5: monetization conversion-click count.
 *   - 9.6: owner-gate that denies non-owners and discloses nothing.
 *   - 9.7: empty-state with all counts zero when no activity is recorded.
 *   - 9.8: reporting-period window filter, defaulting to the trailing 30 days.
 */

import type { AgentType } from "./validation";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Milliseconds in one day. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Default reporting-period length in days when none is selected (Req 9.8). */
export const DEFAULT_PERIOD_DAYS = 30;

/** Maximum entries in a ranked analytics list (Req 9.2, 9.3). */
export const MAX_RANKED_ENTRIES = 10;

/** Maximum number of recent call summaries surfaced (Req 9.2). */
export const MAX_RECENT_SUMMARIES = 20;

/** Rating scale bounds (Req 9.1). */
export const RATING_SCALE_MIN = 1;
export const RATING_SCALE_MAX = 5;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The raw interaction-event kinds recorded for a Campus_Agent, matching the
 * `campusEvents.type` union in the schema.
 */
export type AnalyticsEventType =
  | "call_completed"
  | "share"
  | "save"
  | "remix"
  | "question"
  | "event_interest"
  | "join_intent"
  | "contact_click"
  | "conversion_click"
  | "quiz_completed"
  | "confusing_topic"
  | "explanation_request";

/**
 * A single raw interaction event, mirroring the property-bearing fields of a
 * `campusEvents` row.
 */
export interface AnalyticsEvent {
  type: AnalyticsEventType;
  createdAt: number;
  callId?: string;
  /** Hashed caller identity used for unique-caller and distinct-saver counts. */
  callerKey?: string;
  /** Free text carried by question / confusing_topic / explanation_request. */
  questionText?: string;
  /** Recorded call duration in seconds, carried by `call_completed`. */
  durationSeconds?: number;
}

/** A recorded call rating value with its timestamp (from `campusRatings`). */
export interface RatingRecord {
  value: number;
  createdAt: number;
}

/** A single call summary with its timestamp (from calls / transcripts). */
export interface CallSummary {
  callId: string;
  summary: string;
  createdAt: number;
}

/** A ranked frequency entry (a text and its occurrence count). */
export interface RankedEntry {
  text: string;
  count: number;
}

/** Type-specific analytics metrics (Req 9.3, 9.4). */
export interface TypeMetrics {
  /** study_agent: top confusing topics by descending frequency (Req 9.3). */
  confusingTopics?: RankedEntry[];
  /** study_agent: top requested explanations by descending frequency (Req 9.3). */
  requestedExplanations?: RankedEntry[];
  /** study_agent: quiz-completion count (Req 9.3). */
  quizCompletions?: number;
  /** club_agent: event-interest count (Req 9.4). */
  eventInterest?: number;
  /** club_agent: join-intent count (Req 9.4). */
  joinIntent?: number;
  /** club_agent: contact-click count (Req 9.4). */
  contactClicks?: number;
}

/** The bundle of activity aggregated for one Campus_Agent over a period. */
export interface AnalyticsInput {
  events: readonly AnalyticsEvent[];
  ratings?: readonly RatingRecord[];
  summaries?: readonly CallSummary[];
  /** Drives which type-specific metrics are included (Req 9.3, 9.4). */
  agentType?: AgentType;
  /** When true, the conversion-click count is surfaced (Req 9.5). */
  hasMonetizationLink?: boolean;
}

/** The aggregated Analytics_Dashboard metrics for a Campus_Agent (Req 9.1–9.5, 9.7). */
export interface AnalyticsSummary {
  /** True iff no activity (events, ratings, summaries) was recorded (Req 9.7). */
  isEmpty: boolean;
  callCount: number;
  uniqueCallerCount: number;
  shareCount: number;
  saveRemixCount: number;
  /** Average call duration in seconds; 0 when there are no calls (Req 9.1). */
  averageCallDurationSeconds: number;
  /**
   * Average rating in [1, 5] rounded to one decimal, or `null` when no rating
   * has been recorded (Req 9.1).
   */
  averageRating: number | null;
  topQuestions: RankedEntry[];
  recentSummaries: CallSummary[];
  typeMetrics?: TypeMetrics;
  /** Conversion clicks for a configured monetization link (Req 9.5). */
  conversionClickCount?: number;
}

/** A reporting-period window, inclusive on both ends (Req 9.8). */
export interface Period {
  startMs: number;
  endMs: number;
}

// ---------------------------------------------------------------------------
// Period filtering (Req 9.8)
// ---------------------------------------------------------------------------

/**
 * Resolves the reporting-period window. When `selected` is omitted (or both of
 * its bounds are absent) the window is the trailing {@link DEFAULT_PERIOD_DAYS}
 * days ending at `now` (Req 9.8). A partially specified selection falls back to
 * the trailing-30-day start and/or `now` end for the missing bound. Pure.
 */
export function resolvePeriod(
  now: number,
  selected?: { startMs?: number | null; endMs?: number | null }
): Period {
  const defaultStart = now - DEFAULT_PERIOD_DAYS * MS_PER_DAY;
  const startMs =
    selected && typeof selected.startMs === "number" ? selected.startMs : defaultStart;
  const endMs =
    selected && typeof selected.endMs === "number" ? selected.endMs : now;
  return { startMs, endMs };
}

/** True iff `timestamp` falls within `[period.startMs, period.endMs]` inclusive. */
export function isWithinPeriod(timestamp: number, period: Period): boolean {
  return timestamp >= period.startMs && timestamp <= period.endMs;
}

/**
 * Returns exactly those events whose timestamp falls within the period window
 * (Req 9.8, Property 21). Pure and non-mutating (a new array is returned).
 */
export function filterEventsByPeriod<T extends { createdAt: number }>(
  items: readonly T[],
  period: Period
): T[] {
  return items.filter((item) => isWithinPeriod(item.createdAt, period));
}

// ---------------------------------------------------------------------------
// Ranking (Req 9.2, 9.3)
// ---------------------------------------------------------------------------

/**
 * Ranks the given texts by descending occurrence frequency, returning at most
 * `limit` entries (Req 9.2, 9.3, Property 20). Ties are broken by text in
 * ascending lexicographic order so the ordering is deterministic. Blank/empty
 * texts are ignored. Pure and non-mutating.
 */
export function rankByFrequency(
  texts: readonly (string | undefined)[],
  limit: number = MAX_RANKED_ENTRIES
): RankedEntry[] {
  const counts = new Map<string, number>();
  for (const raw of texts) {
    if (typeof raw !== "string") continue;
    const text = raw.trim();
    if (text.length === 0) continue;
    counts.set(text, (counts.get(text) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([text, count]) => ({ text, count }))
    .sort((a, b) => (b.count - a.count) || a.text.localeCompare(b.text))
    .slice(0, Math.max(0, limit));
}

/**
 * Returns the `limit` most-recent summaries, most-recent first (Req 9.2,
 * Property 20). Pure and non-mutating.
 */
export function recentSummaries(
  summaries: readonly CallSummary[],
  limit: number = MAX_RECENT_SUMMARIES
): CallSummary[] {
  return [...summaries]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, Math.max(0, limit));
}

// ---------------------------------------------------------------------------
// Aggregation (Req 9.1, 9.3, 9.4, 9.5, 9.7)
// ---------------------------------------------------------------------------

/** Counts events of a given type. */
function countOfType(
  events: readonly AnalyticsEvent[],
  type: AnalyticsEventType
): number {
  let n = 0;
  for (const event of events) {
    if (event.type === type) n += 1;
  }
  return n;
}

/** Collects the question texts for a given event type in encounter order. */
function textsOfType(
  events: readonly AnalyticsEvent[],
  type: AnalyticsEventType
): (string | undefined)[] {
  const texts: (string | undefined)[] = [];
  for (const event of events) {
    if (event.type === type) texts.push(event.questionText);
  }
  return texts;
}

/**
 * Computes the unique-caller count over completed calls (Req 9.1). Callers with
 * a `callerKey` are de-duplicated by that key; a completed call lacking a
 * `callerKey` is counted once via its `callId`, and a call with neither is
 * treated as its own anonymous caller.
 */
function uniqueCallerCount(events: readonly AnalyticsEvent[]): number {
  const identities = new Set<string>();
  let anonymous = 0;
  for (const event of events) {
    if (event.type !== "call_completed") continue;
    if (typeof event.callerKey === "string" && event.callerKey.length > 0) {
      identities.add(`k:${event.callerKey}`);
    } else if (typeof event.callId === "string" && event.callId.length > 0) {
      identities.add(`c:${event.callId}`);
    } else {
      anonymous += 1;
    }
  }
  return identities.size + anonymous;
}

/**
 * Computes the combined save/remix count (Req 9.1, Req 15). Saves are counted
 * per distinct caller (a given caller counts at most once); saves without a
 * `callerKey` each count once. Remixes are counted per event.
 */
function saveRemixCount(events: readonly AnalyticsEvent[]): number {
  const savers = new Set<string>();
  let anonymousSaves = 0;
  let remixes = 0;
  for (const event of events) {
    if (event.type === "save") {
      if (typeof event.callerKey === "string" && event.callerKey.length > 0) {
        savers.add(event.callerKey);
      } else {
        anonymousSaves += 1;
      }
    } else if (event.type === "remix") {
      remixes += 1;
    }
  }
  return savers.size + anonymousSaves + remixes;
}

/**
 * Sums call duration and counts completed calls, returning the total seconds
 * and call count so the caller can derive the average (Req 9.1).
 */
function callTotals(events: readonly AnalyticsEvent[]): {
  callCount: number;
  totalDurationSeconds: number;
} {
  let callCount = 0;
  let totalDurationSeconds = 0;
  for (const event of events) {
    if (event.type !== "call_completed") continue;
    callCount += 1;
    const d = event.durationSeconds;
    if (typeof d === "number" && Number.isFinite(d) && d > 0) {
      totalDurationSeconds += d;
    }
  }
  return { callCount, totalDurationSeconds };
}

/**
 * Computes the average rating rounded to one decimal and clamped to the [1, 5]
 * scale, or `null` when no rating exists (Req 9.1). Values are assumed to be
 * valid 1..5 ratings; the clamp is a defensive bound.
 */
export function averageRating(ratings: readonly RatingRecord[]): number | null {
  if (ratings.length === 0) return null;
  let sum = 0;
  for (const rating of ratings) sum += rating.value;
  const avg = sum / ratings.length;
  const clamped = Math.min(RATING_SCALE_MAX, Math.max(RATING_SCALE_MIN, avg));
  return Math.round(clamped * 10) / 10;
}

/**
 * Builds the type-specific metrics for the agent's type, or `undefined` when
 * the type carries no type-specific metrics (Req 9.3, 9.4). study_agent yields
 * confusing-topic and requested-explanation rankings plus a quiz-completion
 * count; club_agent yields event-interest, join-intent, and contact-click
 * counts.
 */
function buildTypeMetrics(
  events: readonly AnalyticsEvent[],
  agentType?: AgentType
): TypeMetrics | undefined {
  if (agentType === "study_agent") {
    return {
      confusingTopics: rankByFrequency(textsOfType(events, "confusing_topic")),
      requestedExplanations: rankByFrequency(
        textsOfType(events, "explanation_request")
      ),
      quizCompletions: countOfType(events, "quiz_completed"),
    };
  }
  if (agentType === "club_agent") {
    return {
      eventInterest: countOfType(events, "event_interest"),
      joinIntent: countOfType(events, "join_intent"),
      contactClicks: countOfType(events, "contact_click"),
    };
  }
  return undefined;
}

/**
 * Aggregates the recorded activity for one Campus_Agent into the
 * Analytics_Dashboard metrics (Req 9.1–9.5, 9.7, Properties 19 & 20).
 *
 * All counts are non-negative integers; the average call duration is
 * `totalDurationSeconds / callCount` (0 when there are no calls); the average
 * rating, when at least one rating exists, lies within [1, 5] rounded to one
 * decimal, and is `null` otherwise. When no activity is recorded the result is
 * an empty state with every count equal to zero (Req 9.7).
 *
 * This function does NOT apply the period window — callers should first filter
 * inputs with {@link filterEventsByPeriod} against a {@link resolvePeriod}
 * window. Pure and non-mutating.
 */
export function aggregateAnalytics(input: AnalyticsInput): AnalyticsSummary {
  const events = input.events;
  const ratings = input.ratings ?? [];
  const summaries = input.summaries ?? [];

  const { callCount, totalDurationSeconds } = callTotals(events);
  const averageCallDurationSeconds =
    callCount > 0 ? totalDurationSeconds / callCount : 0;

  const summary: AnalyticsSummary = {
    isEmpty: events.length === 0 && ratings.length === 0 && summaries.length === 0,
    callCount,
    uniqueCallerCount: uniqueCallerCount(events),
    shareCount: countOfType(events, "share"),
    saveRemixCount: saveRemixCount(events),
    averageCallDurationSeconds,
    averageRating: averageRating(ratings),
    topQuestions: rankByFrequency(textsOfType(events, "question")),
    recentSummaries: recentSummaries(summaries),
  };

  const typeMetrics = buildTypeMetrics(events, input.agentType);
  if (typeMetrics !== undefined) {
    summary.typeMetrics = typeMetrics;
  }

  if (input.hasMonetizationLink === true) {
    summary.conversionClickCount = countOfType(events, "conversion_click");
  }

  return summary;
}

/**
 * Convenience aggregation that first restricts every input stream to the given
 * reporting-period window before aggregating (Req 9.8). Pure and non-mutating.
 */
export function aggregateAnalyticsForPeriod(
  input: AnalyticsInput,
  period: Period
): AnalyticsSummary {
  return aggregateAnalytics({
    ...input,
    events: filterEventsByPeriod(input.events, period),
    ratings: filterEventsByPeriod(input.ratings ?? [], period),
    summaries: filterEventsByPeriod(input.summaries ?? [], period),
  });
}

// ---------------------------------------------------------------------------
// Daily-rollup merge (Req 9.1–9.5, 9.8)
// ---------------------------------------------------------------------------

/**
 * A pre-aggregated daily analytics rollup for one Campus_Agent, mirroring the
 * property-bearing fields of a `campusAnalyticsDaily` row. These rows are
 * produced by the daily rollup cron so the Analytics_Dashboard can recompute a
 * reporting period from a small set of daily rows plus the (few) live events of
 * any day not yet rolled up, rather than re-reading a month of raw events.
 */
export interface DailyRollup {
  callCount: number;
  uniqueCallerCount: number;
  shareCount: number;
  saveRemixCount: number;
  totalDurationSeconds: number;
  ratingSum: number;
  ratingCount: number;
  topQuestions: readonly RankedEntry[];
  typeMetrics?: {
    confusingTopics?: readonly RankedEntry[];
    requestedExplanations?: readonly RankedEntry[];
    quizCompletions?: number;
    eventInterest?: number;
    joinIntent?: number;
    contactClicks?: number;
    conversionClicks?: number;
  };
}

/**
 * Aggregates the raw activity for a single UTC day into a {@link DailyRollup}
 * for one Campus_Agent — the inverse of {@link aggregateWithRollups} on the
 * write side (Req 9.1–9.5, 9.8). Produced by the daily rollup cron so a
 * reporting period can later be recomputed from a small set of daily rows plus
 * the live events of days not yet rolled up.
 *
 * All scalar counts are non-negative integers; `totalDurationSeconds` and the
 * `ratingSum`/`ratingCount` pair are retained raw (rather than pre-averaged) so
 * the merge on read can compute a period average without loss. The ranked
 * top-questions list — and, for study_agents, the confusing-topic and
 * requested-explanation lists — are ranked unbounded here so no long-tail entry
 * is dropped before days are merged; the merge re-applies the {@link
 * MAX_RANKED_ENTRIES} bound. `typeMetrics` carries only the fields relevant to
 * the agent's type, plus `conversionClicks` when a monetization link is
 * configured, and is omitted entirely when none apply. Pure and non-mutating.
 */
export function computeDailyRollup(input: AnalyticsInput): DailyRollup {
  const events = input.events;
  const ratings = input.ratings ?? [];

  const { callCount, totalDurationSeconds } = callTotals(events);
  let ratingSum = 0;
  for (const rating of ratings) ratingSum += rating.value;

  const rollup: DailyRollup = {
    callCount,
    uniqueCallerCount: uniqueCallerCount(events),
    shareCount: countOfType(events, "share"),
    saveRemixCount: saveRemixCount(events),
    totalDurationSeconds,
    ratingSum,
    ratingCount: ratings.length,
    // Rank unbounded so no long-tail question is dropped before days are merged.
    topQuestions: rankAll(textsOfType(events, "question")),
  };

  const typeMetrics: NonNullable<DailyRollup["typeMetrics"]> = {};
  let hasTypeMetrics = false;
  if (input.agentType === "study_agent") {
    typeMetrics.confusingTopics = rankAll(textsOfType(events, "confusing_topic"));
    typeMetrics.requestedExplanations = rankAll(
      textsOfType(events, "explanation_request")
    );
    typeMetrics.quizCompletions = countOfType(events, "quiz_completed");
    hasTypeMetrics = true;
  } else if (input.agentType === "club_agent") {
    typeMetrics.eventInterest = countOfType(events, "event_interest");
    typeMetrics.joinIntent = countOfType(events, "join_intent");
    typeMetrics.contactClicks = countOfType(events, "contact_click");
    hasTypeMetrics = true;
  }
  if (input.hasMonetizationLink === true) {
    typeMetrics.conversionClicks = countOfType(events, "conversion_click");
    hasTypeMetrics = true;
  }
  if (hasTypeMetrics) {
    rollup.typeMetrics = typeMetrics;
  }

  return rollup;
}

/**
 * Merges several already-counted ranked lists into one, summing counts for
 * equal texts and re-applying the descending-frequency / ascending-text
 * ordering and `limit` bound of {@link rankByFrequency}. Blank texts are
 * ignored. Pure and non-mutating. Used to fold each day's pre-ranked
 * top-questions / confusing-topics / requested-explanations lists together with
 * the live day's freshly ranked list (Req 9.2, 9.3).
 */
export function mergeRankedEntries(
  groups: readonly (readonly RankedEntry[])[],
  limit: number = MAX_RANKED_ENTRIES
): RankedEntry[] {
  const counts = new Map<string, number>();
  for (const group of groups) {
    for (const entry of group) {
      const text = entry.text.trim();
      if (text.length === 0) continue;
      counts.set(text, (counts.get(text) ?? 0) + entry.count);
    }
  }
  return Array.from(counts.entries())
    .map(([text, count]) => ({ text, count }))
    .sort((a, b) => (b.count - a.count) || a.text.localeCompare(b.text))
    .slice(0, Math.max(0, limit));
}

/** Ranks every occurrence of a question-text stream, unbounded, for merging. */
function rankAll(texts: readonly (string | undefined)[]): RankedEntry[] {
  return rankByFrequency(texts, Number.MAX_SAFE_INTEGER);
}

/**
 * Aggregates a reporting period from a set of pre-aggregated daily rollups plus
 * the live activity (`live`) of any day not covered by a rollup (Req 9.1–9.5,
 * 9.8, Property 19 & 20). Scalar counts are summed across the rollups and the
 * live events; the average duration is `totalDurationSeconds / callCount`
 * (0 when there are no calls); the average rating is
 * `ratingSum / ratingCount` clamped to [1, 5] and rounded to one decimal
 * (`null` when no rating exists); the top-questions and study-agent ranked lists
 * fold each day's pre-ranked list together with the live day's ranking via
 * {@link mergeRankedEntries}; recent summaries come from the live stream (the
 * rollup does not retain per-call summaries). The result is the empty state with
 * every count zero when there are no rollups and no live activity (Req 9.7).
 *
 * The caller is responsible for supplying rollups and live activity that do not
 * overlap (each day is represented by exactly one of the two) so nothing is
 * double-counted. Pure and non-mutating.
 */
export function aggregateWithRollups(
  rollups: readonly DailyRollup[],
  live: AnalyticsInput
): AnalyticsSummary {
  const liveEvents = live.events;
  const liveRatings = live.ratings ?? [];
  const liveSummaries = live.summaries ?? [];

  // Live raw totals.
  const { callCount: liveCalls, totalDurationSeconds: liveDuration } =
    callTotals(liveEvents);
  let liveRatingSum = 0;
  for (const rating of liveRatings) liveRatingSum += rating.value;

  // Seed the running totals with the live day(s).
  let callCount = liveCalls;
  let uniqueCallers = uniqueCallerCount(liveEvents);
  let shareCount = countOfType(liveEvents, "share");
  let saveRemixTotal = saveRemixCount(liveEvents);
  let totalDuration = liveDuration;
  let ratingSum = liveRatingSum;
  let ratingCount = liveRatings.length;

  // Rollup ranked-list groups to fold together with the live day's ranking.
  const questionGroups: RankedEntry[][] = [rankAll(textsOfType(liveEvents, "question"))];
  const confusingGroups: RankedEntry[][] = [
    rankAll(textsOfType(liveEvents, "confusing_topic")),
  ];
  const explanationGroups: RankedEntry[][] = [
    rankAll(textsOfType(liveEvents, "explanation_request")),
  ];

  // Type-specific scalar accumulators seeded from the live day.
  let quizCompletions = countOfType(liveEvents, "quiz_completed");
  let eventInterest = countOfType(liveEvents, "event_interest");
  let joinIntent = countOfType(liveEvents, "join_intent");
  let contactClicks = countOfType(liveEvents, "contact_click");
  let conversionClicks = countOfType(liveEvents, "conversion_click");

  for (const rollup of rollups) {
    callCount += rollup.callCount;
    uniqueCallers += rollup.uniqueCallerCount;
    shareCount += rollup.shareCount;
    saveRemixTotal += rollup.saveRemixCount;
    totalDuration += rollup.totalDurationSeconds;
    ratingSum += rollup.ratingSum;
    ratingCount += rollup.ratingCount;
    if (rollup.topQuestions.length > 0) {
      questionGroups.push([...rollup.topQuestions]);
    }
    const tm = rollup.typeMetrics;
    if (tm) {
      if (tm.confusingTopics && tm.confusingTopics.length > 0) {
        confusingGroups.push([...tm.confusingTopics]);
      }
      if (tm.requestedExplanations && tm.requestedExplanations.length > 0) {
        explanationGroups.push([...tm.requestedExplanations]);
      }
      quizCompletions += tm.quizCompletions ?? 0;
      eventInterest += tm.eventInterest ?? 0;
      joinIntent += tm.joinIntent ?? 0;
      contactClicks += tm.contactClicks ?? 0;
      conversionClicks += tm.conversionClicks ?? 0;
    }
  }

  const averageCallDurationSeconds =
    callCount > 0 ? totalDuration / callCount : 0;
  const averageRatingValue =
    ratingCount > 0
      ? Math.round(
          Math.min(
            RATING_SCALE_MAX,
            Math.max(RATING_SCALE_MIN, ratingSum / ratingCount)
          ) * 10
        ) / 10
      : null;

  const summary: AnalyticsSummary = {
    isEmpty:
      rollups.length === 0 &&
      liveEvents.length === 0 &&
      liveRatings.length === 0 &&
      liveSummaries.length === 0,
    callCount,
    uniqueCallerCount: uniqueCallers,
    shareCount,
    saveRemixCount: saveRemixTotal,
    averageCallDurationSeconds,
    averageRating: averageRatingValue,
    topQuestions: mergeRankedEntries(questionGroups),
    recentSummaries: recentSummaries(liveSummaries),
  };

  if (live.agentType === "study_agent") {
    summary.typeMetrics = {
      confusingTopics: mergeRankedEntries(confusingGroups),
      requestedExplanations: mergeRankedEntries(explanationGroups),
      quizCompletions,
    };
  } else if (live.agentType === "club_agent") {
    summary.typeMetrics = {
      eventInterest,
      joinIntent,
      contactClicks,
    };
  }

  if (live.hasMonetizationLink === true) {
    summary.conversionClickCount = conversionClicks;
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Owner gate (Req 9.6)
// ---------------------------------------------------------------------------

/**
 * The result of the analytics owner-access gate. On denial no agent data is
 * carried, so a caller physically cannot disclose metrics, questions, or
 * summaries for an agent the requester does not own (Req 9.6, Property 22).
 */
export type AnalyticsAccessResult =
  | { authorized: true }
  | { authorized: false; error: "unauthorized" };

/**
 * Owner-gate for the Analytics_Dashboard (Req 9.6, Property 22): access is
 * granted iff the requester is the (present, non-empty) owner of the target
 * agent. Every other case — including a missing requester or owner — is denied
 * as `unauthorized` and discloses nothing. Pure.
 */
export function authorizeAnalyticsAccess(
  requesterId: string | null | undefined,
  ownerId: string | null | undefined
): AnalyticsAccessResult {
  if (
    typeof requesterId === "string" &&
    requesterId.length > 0 &&
    typeof ownerId === "string" &&
    ownerId.length > 0 &&
    requesterId === ownerId
  ) {
    return { authorized: true };
  }
  return { authorized: false, error: "unauthorized" };
}
