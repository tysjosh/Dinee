/**
 * Feature: campus-social-loops (Task 7.1)
 *
 * Pure, property-testable core for the `Gamification_Service`: Streak
 * arithmetic (increment-once-per-day, set-to-1 on a gap, reset-after-idle),
 * idempotent Badge awarding at a cumulative threshold, and the static Badge
 * catalog of Creator_Badges and Caller_Badges (Requirements 5.1, 5.2, 5.3, 5.4,
 * 5.5, 5.6, 5.8, 5.9).
 *
 * These functions carry NO Convex `ctx` and perform no I/O, so they can be
 * exercised directly by unit and property tests and imported by the Convex
 * `social/gamification.ts` service that wraps them with `campusStreaks`,
 * `campusActivityCounters`, and `campusBadges` reads and writes — the same
 * reuse-over-duplication discipline used by `convex/campus/logic/**`.
 *
 * Calendar days are represented as `YYYY-MM-DD` strings already resolved in the
 * Campus_Platform's configured **reference time zone** by the caller (Req 5.1).
 * All day arithmetic in this module is pure string-based calendar arithmetic:
 * it never reads the ambient clock and never depends on the host's local time
 * zone. (The internal epoch-day helper uses `Date.UTC`, whose result is fixed
 * regardless of local time zone, purely as deterministic calendar math on the
 * already-resolved date components.)
 */

// ---------------------------------------------------------------------------
// Streak kinds (Req 5.1, 5.6)
// ---------------------------------------------------------------------------

/**
 * The two kinds of Streak tracked per user (Req 5.1): a `creator` Streak tracks
 * creator Qualifying_Activity and a `caller` Streak tracks caller
 * Qualifying_Activity.
 */
export type StreakKind = "creator" | "caller";

// ---------------------------------------------------------------------------
// Calendar-day arithmetic (pure, time-zone independent)
// ---------------------------------------------------------------------------

/** Matches a strict `YYYY-MM-DD` calendar day. */
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** True iff `day` is a well-formed, real `YYYY-MM-DD` calendar day. Pure. */
export function isValidDay(day: string): boolean {
  if (!DAY_PATTERN.test(day)) {
    return false;
  }
  const [y, m, d] = day.split("-").map((part) => Number.parseInt(part, 10));
  if (m < 1 || m > 12 || d < 1 || d > 31) {
    return false;
  }
  // Round-trip through Date.UTC to reject impossible dates (e.g. 2024-02-31).
  const stamp = Date.UTC(y, m - 1, d);
  const back = new Date(stamp);
  return (
    back.getUTCFullYear() === y &&
    back.getUTCMonth() === m - 1 &&
    back.getUTCDate() === d
  );
}

/**
 * The number of whole calendar days from the Unix epoch to `day`, used purely
 * for deterministic day differencing. Pure; independent of local time zone.
 */
function epochDay(day: string): number {
  const [y, m, d] = day.split("-").map((part) => Number.parseInt(part, 10));
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

/**
 * The signed number of calendar days from `from` to `to` (`to - from`): `0`
 * when they are the same day, `1` when `to` is the day immediately after
 * `from`, negative when `to` precedes `from`. Pure.
 */
export function dayDifference(from: string, to: string): number {
  return epochDay(to) - epochDay(from);
}

// ---------------------------------------------------------------------------
// Streak state + transition (Req 5.1, 5.2, 5.3, 5.4, 5.9)
// ---------------------------------------------------------------------------

/**
 * The stored state of a single Streak: its current `count` (a non-negative
 * integer, Req 5.7) and the `YYYY-MM-DD` of the user's most recent active day
 * in the reference time zone, or `null` before any Qualifying_Activity.
 */
export interface StreakState {
  count: number;
  lastActiveDay: string | null;
}

/**
 * Applies a Qualifying_Activity performed on `activityDay` to a Streak's state,
 * returning the new state (Req 5.1, 5.2, 5.4, 5.9). Pure and non-mutating.
 *
 * Cases, in order:
 *   - **first-ever activity** (`lastActiveDay` is `null`): the Streak begins at
 *     `1` on `activityDay`.
 *   - **same day** as `lastActiveDay`: the state is returned unchanged, so at
 *     most one increment is counted per Streak per calendar day regardless of
 *     how many activities occur that day (Req 5.4).
 *   - **immediately following day** (`activityDay` is exactly one day after
 *     `lastActiveDay`): the Streak increments by `1` (Req 5.2).
 *   - **any other (non-consecutive) day**: the Streak is set to `1` (Req 5.9),
 *     covering both a forward gap of a full day or more and an out-of-order
 *     earlier day.
 *
 * The reset-from-idle behavior of Req 5.3 (no activity for a full day) is a
 * read-time concern handled by {@link currentStreak}, not by this write-time
 * transition.
 */
export function applyQualifyingActivity(
  state: StreakState,
  activityDay: string
): StreakState {
  // First-ever activity for this Streak (Req 5.1).
  if (state.lastActiveDay === null) {
    return { count: 1, lastActiveDay: activityDay };
  }

  const diff = dayDifference(state.lastActiveDay, activityDay);

  // Same calendar day: at most one increment per day (Req 5.4).
  if (diff === 0) {
    return { count: state.count, lastActiveDay: state.lastActiveDay };
  }

  // The day immediately following the most recent active day (Req 5.2).
  if (diff === 1) {
    return { count: state.count + 1, lastActiveDay: activityDay };
  }

  // Any non-consecutive day: the Streak starts over at 1 (Req 5.9).
  return { count: 1, lastActiveDay: activityDay };
}

/**
 * The user's current Streak count as of `today`, applying the idle-reset of
 * Req 5.3 (Req 5.3, 5.7). Pure.
 *
 * The stored `count` remains valid while `today` is the most recent active day
 * or the day immediately following it (no full calendar day has yet elapsed
 * without activity). Once a full calendar day has elapsed with no activity
 * following the most recent active day — i.e. `today` is two or more days after
 * `lastActiveDay` — the Streak has lapsed and reads as `0`. A Streak with no
 * recorded activity reads as `0`. The result is always a non-negative integer
 * (Req 5.7).
 */
export function currentStreak(state: StreakState, today: string): number {
  if (state.lastActiveDay === null) {
    return 0;
  }
  const diff = dayDifference(state.lastActiveDay, today);
  // diff <= 1 covers the active day itself and the immediately following day
  // (the user may still act today); diff >= 2 means a full idle day elapsed.
  return diff <= 1 ? state.count : 0;
}

// ---------------------------------------------------------------------------
// Badge criterion + idempotent award (Req 5.5, 5.8)
// ---------------------------------------------------------------------------

/**
 * The measurable condition that awards a Badge (Req 5.5): the user's cumulative
 * count for `activityType` first reaching or exceeding `threshold` awards the
 * Badge identified by the stable `badgeKey`.
 */
export interface BadgeCriterion {
  badgeKey: string;
  activityType: string;
  threshold: number;
}

/**
 * Decides whether a Badge should be awarded given the user's current cumulative
 * activity count and whether the Badge was already awarded (Req 5.5, 5.8). Pure
 * and deterministic.
 *
 * A Badge is awarded exactly once, when the cumulative count **first** reaches
 * or exceeds the criterion threshold. If the Badge was already awarded it is
 * never awarded again — and remains held even if the underlying count later
 * decreases (Req 5.8), because a decreasing count can only ever produce
 * `alreadyAwarded === true`, yielding no re-award. A count below the threshold
 * that has not yet been awarded produces no award.
 */
export function evaluateBadgeAward(input: {
  cumulativeCount: number;
  criterion: BadgeCriterion;
  alreadyAwarded: boolean;
}): { award: true } | { award: false } {
  if (input.alreadyAwarded) {
    return { award: false };
  }
  if (input.cumulativeCount >= input.criterion.threshold) {
    return { award: true };
  }
  return { award: false };
}

// ---------------------------------------------------------------------------
// Badge catalog (Req 5.6)
// ---------------------------------------------------------------------------

/** The category a Badge belongs to (Req 5.6). */
export type BadgeCategory = "creator" | "caller";

/**
 * The cumulative activity types a Creator_Streak / Caller_Streak tracks and
 * that back the Badge thresholds (Req 5.6). Aligns with the
 * `campusActivityCounters.activityType` values written by the service.
 */
export const CREATOR_ACTIVITY_TYPES = [
  "challenge_entries_posted", // posting Challenge_Entries
  "calls_received", // receiving calls
  "saves_received", // receiving saves
  "quizzes_answered", // answering quizzes
  "battles_won", // winning Agent_Battles
] as const;

export const CALLER_ACTIVITY_TYPES = [
  "agents_discovered", // discovering agents
  "calls_rated", // rating calls
  "agents_shared", // sharing agents
  "quests_completed", // completing Campus_Quests
] as const;

/** A Creator-side cumulative activity type (Req 5.6). */
export type CreatorActivityType = (typeof CREATOR_ACTIVITY_TYPES)[number];
/** A Caller-side cumulative activity type (Req 5.6). */
export type CallerActivityType = (typeof CALLER_ACTIVITY_TYPES)[number];
/** Any tracked cumulative activity type. */
export type ActivityType = CreatorActivityType | CallerActivityType;

/** A named milestone tier applied to every tracked activity type. */
export interface BadgeTier {
  tier: "bronze" | "silver" | "gold";
  threshold: number;
}

/**
 * The milestone thresholds each tracked activity earns a Badge at (Req 5.5).
 * A Badge is awarded the first time the cumulative count reaches each tier.
 */
export const BADGE_TIERS: readonly BadgeTier[] = [
  { tier: "bronze", threshold: 1 },
  { tier: "silver", threshold: 10 },
  { tier: "gold", threshold: 50 },
] as const;

/**
 * A single entry in the Badge catalog: a {@link BadgeCriterion} (so it can be
 * passed directly to {@link evaluateBadgeAward}) annotated with its
 * {@link BadgeCategory}, human-readable `label`, and milestone `tier`.
 */
export interface BadgeDefinition extends BadgeCriterion {
  category: BadgeCategory;
  label: string;
  tier: BadgeTier["tier"];
}

/** Metadata used to render each activity's Badge labels. */
interface ActivitySpec {
  activityType: ActivityType;
  category: BadgeCategory;
  /** Human-readable noun for the label, e.g. "Calls Received". */
  noun: string;
}

const ACTIVITY_SPECS: readonly ActivitySpec[] = [
  // Creator_Badges (Req 5.6).
  {
    activityType: "challenge_entries_posted",
    category: "creator",
    noun: "Challenge Entries",
  },
  { activityType: "calls_received", category: "creator", noun: "Calls Received" },
  { activityType: "saves_received", category: "creator", noun: "Saves Received" },
  {
    activityType: "quizzes_answered",
    category: "creator",
    noun: "Quizzes Answered",
  },
  { activityType: "battles_won", category: "creator", noun: "Battles Won" },
  // Caller_Badges (Req 5.6).
  {
    activityType: "agents_discovered",
    category: "caller",
    noun: "Agents Discovered",
  },
  { activityType: "calls_rated", category: "caller", noun: "Calls Rated" },
  { activityType: "agents_shared", category: "caller", noun: "Agents Shared" },
  {
    activityType: "quests_completed",
    category: "caller",
    noun: "Quests Completed",
  },
];

const TIER_LABEL: Record<BadgeTier["tier"], string> = {
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
};

function buildCatalog(): readonly BadgeDefinition[] {
  const catalog: BadgeDefinition[] = [];
  for (const spec of ACTIVITY_SPECS) {
    for (const { tier, threshold } of BADGE_TIERS) {
      catalog.push({
        badgeKey: `${spec.category}_${spec.activityType}_${tier}`,
        activityType: spec.activityType,
        threshold,
        category: spec.category,
        tier,
        label: `${spec.noun} — ${TIER_LABEL[tier]}`,
      });
    }
  }
  return catalog;
}

/**
 * The complete Badge catalog (Req 5.6): Creator_Badges for posting
 * Challenge_Entries, receiving calls, receiving saves, answering quizzes, and
 * winning Agent_Battles; and Caller_Badges for discovering agents, rating
 * calls, sharing agents, and completing Campus_Quests. Each tracked activity
 * carries one Badge per milestone {@link BADGE_TIERS tier}. Every entry is a
 * valid {@link BadgeCriterion} usable directly with {@link evaluateBadgeAward}.
 */
export const BADGE_CATALOG: readonly BadgeDefinition[] = buildCatalog();

/**
 * The Badge criteria whose threshold is measured against a given
 * `activityType`'s cumulative count (Req 5.5, 5.6), ordered ascending by
 * threshold. Returned to the service so it can evaluate every milestone Badge
 * for the activity that just advanced. Pure.
 */
export function badgeCriteriaForActivity(
  activityType: string
): readonly BadgeDefinition[] {
  return BADGE_CATALOG.filter(
    (badge) => badge.activityType === activityType
  ).sort((a, b) => a.threshold - b.threshold);
}
