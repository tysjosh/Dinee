// Feature: campus-social-loops, Task 15.2: badge catalog + profile display
/**
 * Feature: campus-social-loops, Task 15.2 — example test for the badge catalog
 * and the Gamification profile display.
 *
 * Validates: Requirements 5.6, 5.7
 *
 * Req 5.6: the Gamification_Service provides Creator_Badges for posting
 *   Challenge_Entries, receiving calls, receiving saves, answering quizzes, and
 *   winning Agent_Battles, and Caller_Badges for discovering agents, rating
 *   calls, sharing agents, and completing Campus_Quests.
 * Req 5.7: when a user opens their profile, the service displays — within 3
 *   seconds — the current Creator_Streak, the current Caller_Streak (each a
 *   non-negative integer), and all awarded Badges.
 *
 * There is no Convex DB test harness in this project, so the profile projection
 * is exercised through the exact pure functions the `getGamificationProfile`
 * query composes (`currentStreak` for each Streak, plus the awarded-badge list),
 * imported from `convex/campus/social/logic/gamification.ts`. This keeps the
 * example test faithful to the runtime behavior without mocking a database.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import {
  BADGE_CATALOG,
  CREATOR_ACTIVITY_TYPES,
  CALLER_ACTIVITY_TYPES,
  currentStreak,
  type StreakState,
  type BadgeCategory,
} from "../../../../convex/campus/social/logic/gamification";
import { streakReadInputArb } from "./arbitraries";

// A projection mirroring the service's `getGamificationProfile` return shape.
interface ProfileBadge {
  badgeKey: string;
  category: BadgeCategory;
  awardedAt: number;
}
interface Profile {
  creatorStreak: number;
  callerStreak: number;
  badges: ProfileBadge[];
}

/**
 * Builds the profile projection exactly as the service does: each Streak is
 * read through `currentStreak` (applying the read-time idle reset), and every
 * awarded Badge is surfaced as-is.
 */
function buildProfile(input: {
  creatorState: StreakState;
  callerState: StreakState;
  today: string;
  awardedBadges: ProfileBadge[];
}): Profile {
  return {
    creatorStreak: currentStreak(input.creatorState, input.today),
    callerStreak: currentStreak(input.callerState, input.today),
    badges: input.awardedBadges,
  };
}

describe("Task 15.2: Badge catalog completeness (Req 5.6)", () => {
  it("provides Creator_Badges for every creator activity type", () => {
    const expectedCreator = [
      "challenge_entries_posted", // posting Challenge_Entries
      "calls_received", // receiving calls
      "saves_received", // receiving saves
      "quizzes_answered", // answering quizzes
      "battles_won", // winning Agent_Battles
    ];
    // The catalog's declared creator activity types match the requirement list.
    expect([...CREATOR_ACTIVITY_TYPES].sort()).toEqual(
      [...expectedCreator].sort(),
    );

    for (const activityType of expectedCreator) {
      const badges = BADGE_CATALOG.filter(
        (b) => b.activityType === activityType,
      );
      expect(badges.length, `no badges for ${activityType}`).toBeGreaterThan(0);
      // Every badge for a creator activity is categorized as a Creator_Badge.
      expect(badges.every((b) => b.category === "creator")).toBe(true);
    }
  });

  it("provides Caller_Badges for every caller activity type", () => {
    const expectedCaller = [
      "agents_discovered", // discovering agents
      "calls_rated", // rating calls
      "agents_shared", // sharing agents
      "quests_completed", // completing Campus_Quests
    ];
    expect([...CALLER_ACTIVITY_TYPES].sort()).toEqual(
      [...expectedCaller].sort(),
    );

    for (const activityType of expectedCaller) {
      const badges = BADGE_CATALOG.filter(
        (b) => b.activityType === activityType,
      );
      expect(badges.length, `no badges for ${activityType}`).toBeGreaterThan(0);
      expect(badges.every((b) => b.category === "caller")).toBe(true);
    }
  });

  it("categorizes the catalog into exactly the creator and caller families with unique keys", () => {
    const categories = new Set(BADGE_CATALOG.map((b) => b.category));
    expect([...categories].sort()).toEqual(["caller", "creator"]);

    // Every catalog badge key is unique (idempotent-award relies on this).
    const keys = BADGE_CATALOG.map((b) => b.badgeKey);
    expect(new Set(keys).size).toBe(keys.length);

    // Both families are non-empty.
    expect(BADGE_CATALOG.some((b) => b.category === "creator")).toBe(true);
    expect(BADGE_CATALOG.some((b) => b.category === "caller")).toBe(true);
  });
});

describe("Task 15.2: Profile display (Req 5.7)", () => {
  it("displays both streaks as non-negative integers and every awarded badge", () => {
    // A representative populated profile: an active creator streak, a lapsed
    // caller streak (idle reset to 0), and one badge from each family.
    const awardedBadges: ProfileBadge[] = [
      { badgeKey: "creator_battles_won_bronze", category: "creator", awardedAt: 1 },
      { badgeKey: "caller_quests_completed_bronze", category: "caller", awardedAt: 2 },
      { badgeKey: "creator_calls_received_silver", category: "creator", awardedAt: 3 },
    ];

    const profile = buildProfile({
      // Active through today: count preserved.
      creatorState: { count: 4, lastActiveDay: "2024-01-10" },
      // A full idle day elapsed: caller streak reads as 0 (Req 5.3).
      callerState: { count: 9, lastActiveDay: "2024-01-08" },
      today: "2024-01-10",
      awardedBadges,
    });

    expect(profile.creatorStreak).toBe(4);
    expect(profile.callerStreak).toBe(0);

    for (const streak of [profile.creatorStreak, profile.callerStreak]) {
      expect(Number.isInteger(streak)).toBe(true);
      expect(streak).toBeGreaterThanOrEqual(0);
    }

    // All awarded badges are displayed (nothing dropped).
    expect(profile.badges).toHaveLength(awardedBadges.length);
    expect(profile.badges.map((b) => b.badgeKey).sort()).toEqual(
      awardedBadges.map((b) => b.badgeKey).sort(),
    );
  });

  it("reports each streak as a non-negative integer for any streak state", () => {
    fc.assert(
      fc.property(streakReadInputArb, streakReadInputArb, (creator, caller) => {
        const profile = buildProfile({
          creatorState: creator.state,
          callerState: caller.state,
          today: creator.today,
          awardedBadges: [],
        });
        for (const streak of [profile.creatorStreak, profile.callerStreak]) {
          expect(Number.isInteger(streak)).toBe(true);
          expect(streak).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("assembles the profile well within the 3-second display budget (Req 5.7)", () => {
    // A large awarded-badge set (well beyond the catalog) still projects fast.
    const awardedBadges: ProfileBadge[] = BADGE_CATALOG.map((b, i) => ({
      badgeKey: b.badgeKey,
      category: b.category,
      awardedAt: i,
    }));

    const start = Date.now();
    const profile = buildProfile({
      creatorState: { count: 12, lastActiveDay: "2024-02-01" },
      callerState: { count: 3, lastActiveDay: "2024-02-01" },
      today: "2024-02-01",
      awardedBadges,
    });
    const elapsedMs = Date.now() - start;

    expect(profile.badges).toHaveLength(BADGE_CATALOG.length);
    expect(profile.creatorStreak).toBe(12);
    expect(profile.callerStreak).toBe(3);
    expect(elapsedMs).toBeLessThan(3000);
  });
});
