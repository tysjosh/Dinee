/**
 * Feature: campus-social-loops (Task 15.1) — the `Gamification_Service`.
 *
 * The thin Convex layer that tracks Streaks and awards Badges, wrapping the
 * pure, property-tested core in `convex/campus/social/logic/gamification.ts`.
 * Every risky decision (streak arithmetic, idempotent badge award, the badge
 * catalog) lives in that pure module; this service only resolves the reference
 * calendar day, reads/writes the additive `campusStreaks`,
 * `campusActivityCounters`, and `campusBadges` tables, and exposes the
 * hand-off other social services call when a user performs a
 * Qualifying_Activity — the same reuse-over-duplication discipline used across
 * `convex/campus/**`.
 *
 * Covered behaviors:
 *   - 5.1/5.2/5.4/5.9: a Qualifying_Activity records its reference-tz calendar
 *     day and advances the applicable Creator_Streak / Caller_Streak
 *     (increment-once-per-day, +1 on the immediately-following day, set-to-1 on
 *     a gap) via `applyQualifyingActivity`.
 *   - 5.3/5.7: `getGamificationProfile` reports each Streak as a non-negative
 *     integer via `currentStreak`, applying the idle reset at read time.
 *   - 5.5/5.6/5.8: the cumulative `campusActivityCounters` count feeds
 *     `evaluateBadgeAward`, which awards each catalog Badge exactly once at its
 *     threshold (idempotent via `campusBadges.by_user_and_badge`) and never
 *     revokes it.
 *   - 6.5: `recordQualifyingActivity` is the hand-off the Quest_Service (and
 *     Battle/Challenge/Caller services) invoke to record a Qualifying_Activity.
 *
 * Reference time zone: the calendar day of a Qualifying_Activity is resolved in
 * the Campus_Platform's configured reference time zone (Req 5.1), read from the
 * `CAMPUS_REFERENCE_TZ` environment variable and defaulting to
 * `America/New_York` when unset. The day string is computed here in the service
 * and passed to the pure functions, which perform only calendar arithmetic.
 */

import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import {
  applyQualifyingActivity,
  currentStreak,
  evaluateBadgeAward,
  badgeCriteriaForActivity,
  BADGE_CATALOG,
  type StreakKind,
  type StreakState,
  type BadgeCategory,
} from "./logic/gamification";

// ---------------------------------------------------------------------------
// Reference time zone + calendar-day resolution (Req 5.1)
// ---------------------------------------------------------------------------

/**
 * The default reference time zone used when `CAMPUS_REFERENCE_TZ` is not set.
 * A US-eastern default is sensible for the campus audience this layer targets;
 * override it per deployment with the `CAMPUS_REFERENCE_TZ` env var.
 */
const DEFAULT_REFERENCE_TZ = "America/New_York";

/** The Campus_Platform's configured reference time zone (Req 5.1). */
function referenceTimeZone(): string {
  const configured = process.env.CAMPUS_REFERENCE_TZ;
  return configured && configured.length > 0 ? configured : DEFAULT_REFERENCE_TZ;
}

/**
 * Resolves the `YYYY-MM-DD` calendar day of `nowMs` in the configured reference
 * time zone (Req 5.1). The `en-CA` locale renders an ISO-style `YYYY-MM-DD`
 * date, which is exactly the day representation the pure logic consumes.
 */
function resolveReferenceDay(nowMs: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: referenceTimeZone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(nowMs));
}

// ---------------------------------------------------------------------------
// Activity-type → Streak kind derivation (Req 5.1, 5.6)
// ---------------------------------------------------------------------------

/**
 * Maps each tracked cumulative activity type to the Streak category it advances
 * (Req 5.6), derived directly from the Badge catalog so the service can never
 * drift from the catalog's creator/caller classification.
 */
const ACTIVITY_CATEGORY: Readonly<Record<string, BadgeCategory>> = (() => {
  const map: Record<string, BadgeCategory> = {};
  for (const badge of BADGE_CATALOG) {
    map[badge.activityType] = badge.category;
  }
  return map;
})();

/**
 * Resolves the Streak kind a Qualifying_Activity advances. When an explicit
 * `kind` is supplied by the calling service it wins; otherwise the kind is
 * derived from the activity type's catalog category, defaulting to `caller`
 * for any activity type outside the catalog.
 */
function resolveStreakKind(
  activityType: string,
  explicit?: StreakKind,
): StreakKind {
  if (explicit) {
    return explicit;
  }
  return ACTIVITY_CATEGORY[activityType] ?? "caller";
}

// ---------------------------------------------------------------------------
// Shared hand-off: record a Qualifying_Activity (Req 5.1–5.5, 5.8, 5.9, 6.5)
// ---------------------------------------------------------------------------

/** A Badge awarded during a `recordQualifyingActivity` call. */
export interface AwardedBadge {
  badgeKey: string;
  category: BadgeCategory;
}

/** The outcome of recording a Qualifying_Activity. */
export interface RecordActivityResult {
  kind: StreakKind;
  streak: number;
  cumulativeCount: number;
  newlyAwarded: AwardedBadge[];
}

/**
 * Records a single Qualifying_Activity for a user and returns the resulting
 * Streak count, cumulative activity count, and any newly-awarded Badges
 * (Req 5.1, 5.2, 5.4, 5.5, 5.8, 5.9). This is the hand-off other social
 * services (Quest_Service — Req 6.5 — and the Battle/Challenge/Caller flows)
 * call directly with their own `MutationCtx` so a Qualifying_Activity is
 * recorded consistently everywhere.
 *
 * The sequence, all in one transaction:
 *   1. Resolve the activity's calendar day in the reference tz (Req 5.1) and
 *      apply `applyQualifyingActivity` to the applicable `campusStreaks` row,
 *      keyed by `by_user_and_kind` (Req 5.2, 5.4, 5.9).
 *   2. Increment the `campusActivityCounters` cumulative count for the activity
 *      type, keyed by `by_user_and_type` (Req 5.5).
 *   3. For each catalog Badge measured against that activity type, award it
 *      exactly once via `evaluateBadgeAward`, guarded for idempotency by
 *      `campusBadges.by_user_and_badge` (Req 5.5, 5.8).
 */
export async function recordQualifyingActivity(
  ctx: MutationCtx,
  args: {
    userId: string;
    activityType: string;
    kind?: StreakKind;
    count?: number;
    nowMs?: number;
  },
): Promise<RecordActivityResult> {
  const now = args.nowMs ?? Date.now();
  const increment = args.count ?? 1;
  const kind = resolveStreakKind(args.activityType, args.kind);
  const activityDay = resolveReferenceDay(now);

  // --- 1. Streak transition (Req 5.1, 5.2, 5.4, 5.9) -----------------------
  const streakRow = await ctx.db
    .query("campusStreaks")
    .withIndex("by_user_and_kind", (q) =>
      q.eq("userId", args.userId).eq("kind", kind),
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
      updatedAt: now,
    });
  } else {
    await ctx.db.insert("campusStreaks", {
      userId: args.userId,
      kind,
      count: nextState.count,
      lastActiveDay: nextState.lastActiveDay ?? undefined,
      updatedAt: now,
    });
  }

  // --- 2. Cumulative activity counter (Req 5.5) ----------------------------
  const counterRow = await ctx.db
    .query("campusActivityCounters")
    .withIndex("by_user_and_type", (q) =>
      q.eq("userId", args.userId).eq("activityType", args.activityType),
    )
    .first();

  const cumulativeCount = (counterRow?.count ?? 0) + increment;
  if (counterRow) {
    await ctx.db.patch(counterRow._id, { count: cumulativeCount, updatedAt: now });
  } else {
    await ctx.db.insert("campusActivityCounters", {
      userId: args.userId,
      activityType: args.activityType,
      count: cumulativeCount,
      updatedAt: now,
    });
  }

  // --- 3. Idempotent badge award (Req 5.5, 5.8) ----------------------------
  const newlyAwarded: AwardedBadge[] = [];
  for (const criterion of badgeCriteriaForActivity(args.activityType)) {
    const existing = await ctx.db
      .query("campusBadges")
      .withIndex("by_user_and_badge", (q) =>
        q.eq("userId", args.userId).eq("badgeKey", criterion.badgeKey),
      )
      .first();

    const decision = evaluateBadgeAward({
      cumulativeCount,
      criterion,
      alreadyAwarded: existing !== null,
    });

    if (decision.award) {
      await ctx.db.insert("campusBadges", {
        userId: args.userId,
        badgeKey: criterion.badgeKey,
        category: criterion.category,
        awardedAt: now,
      });
      newlyAwarded.push({
        badgeKey: criterion.badgeKey,
        category: criterion.category,
      });
    }
  }

  return {
    kind,
    streak: nextState.count,
    cumulativeCount,
    newlyAwarded,
  };
}

// ---------------------------------------------------------------------------
// recordActivity mutation (Req 5.1–5.5, 5.8, 5.9, 6.5)
// ---------------------------------------------------------------------------

/**
 * Records a Qualifying_Activity for a user, advancing the applicable Streak,
 * incrementing the cumulative activity counter, and awarding any Badges whose
 * threshold is first reached (Req 5.1–5.5, 5.8, 5.9). Delegates entirely to
 * {@link recordQualifyingActivity}; exposed as a mutation so client surfaces
 * and scheduled jobs can record Caller/Creator activity, and re-exported as a
 * plain helper for in-process hand-off from the Quest_Service (Req 6.5) and the
 * Battle/Challenge flows.
 */
export const recordActivity = mutation({
  args: {
    userId: v.string(),
    activityType: v.string(),
    kind: v.optional(v.union(v.literal("creator"), v.literal("caller"))),
    count: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<RecordActivityResult> => {
    return await recordQualifyingActivity(ctx, {
      userId: args.userId,
      activityType: args.activityType,
      kind: args.kind,
      count: args.count,
    });
  },
});

// ---------------------------------------------------------------------------
// getGamificationProfile query (Req 5.6, 5.7, 6.5)
// ---------------------------------------------------------------------------

/** A Badge as presented on the profile view. */
export interface ProfileBadge {
  badgeKey: string;
  category: BadgeCategory;
  awardedAt: number;
}

/** The profile-view projection returned to the Streaks & Badges surface. */
export interface GamificationProfile {
  userId: string;
  creatorStreak: number;
  callerStreak: number;
  badges: ProfileBadge[];
  generatedAt: number;
}

/** Reads a user's Streak state for a kind, defaulting to an empty streak. */
async function readStreakState(
  ctx: QueryCtx,
  userId: string,
  kind: StreakKind,
): Promise<StreakState> {
  const row = await ctx.db
    .query("campusStreaks")
    .withIndex("by_user_and_kind", (q) =>
      q.eq("userId", userId).eq("kind", kind),
    )
    .first();
  return {
    count: row?.count ?? 0,
    lastActiveDay: row?.lastActiveDay ?? null,
  };
}

/**
 * Returns the user's current Creator_Streak, current Caller_Streak, and all
 * awarded Badges for the profile view (Req 5.6, 5.7). Each Streak is reported
 * as a non-negative integer via `currentStreak`, which applies the idle reset
 * at read time (Req 5.3) using today's reference-tz calendar day. The result is
 * a single projection so the surface can display it within the 3-second budget
 * (Req 5.7) without additional round-trips.
 */
export const getGamificationProfile = query({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args): Promise<GamificationProfile> => {
    const now = Date.now();
    const today = resolveReferenceDay(now);

    const creatorState = await readStreakState(ctx, args.userId, "creator");
    const callerState = await readStreakState(ctx, args.userId, "caller");

    const badgeRows = await ctx.db
      .query("campusBadges")
      .withIndex("by_user_id", (q) => q.eq("userId", args.userId))
      .collect();

    return {
      userId: args.userId,
      creatorStreak: currentStreak(creatorState, today),
      callerStreak: currentStreak(callerState, today),
      badges: badgeRows.map((b) => ({
        badgeKey: b.badgeKey,
        category: b.category,
        awardedAt: b.awardedAt,
      })),
      generatedAt: now,
    };
  },
});
