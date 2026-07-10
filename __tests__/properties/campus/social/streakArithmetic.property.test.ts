// Feature: campus-social-loops, Property 20: Streak arithmetic increments once per day, sets to 1 on a gap, and resets after an idle day
/**
 * Feature: campus-social-loops, Property 20: Streak arithmetic increments once
 * per day, sets to 1 on a gap, and resets after an idle day
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.9
 *
 * The pure logic under test is {@link applyQualifyingActivity} (write-time
 * transition) and {@link currentStreak} (read-time idle reset) from
 * `convex/campus/social/logic/gamification.ts`.
 *
 * Req 5.1: the calendar day of a Qualifying_Activity (in the reference tz) is
 *   recorded as an active day for the applicable Streak.
 * Req 5.2: a Qualifying_Activity on the day immediately following the most
 *   recent active day increments that Streak by 1.
 * Req 5.3: no Qualifying_Activity for a full calendar day following the most
 *   recent active day resets the Streak to 0 (a read-time concern).
 * Req 5.4: at most one Streak increment per Streak per calendar day regardless
 *   of how many Qualifying_Activities occur that day.
 * Req 5.9: a Qualifying_Activity on a day that is not immediately following the
 *   most recent active day sets that Streak to 1.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import {
  applyQualifyingActivity,
  currentStreak,
  dayDifference,
  type StreakState,
} from "../../../../convex/campus/social/logic/gamification";
import {
  activityDayArb,
  activityDaySequenceArb,
  streakReadInputArb,
  streakStateArb,
} from "./arbitraries";

const EMPTY_STATE: StreakState = { count: 0, lastActiveDay: null };

describe("Property 20: Streak arithmetic", () => {
  it("first-ever Qualifying_Activity begins the Streak at 1 on that day (Req 5.1)", () => {
    fc.assert(
      fc.property(activityDayArb, (day) => {
        const next = applyQualifyingActivity(EMPTY_STATE, day);
        expect(next.count).toBe(1);
        expect(next.lastActiveDay).toBe(day);
      }),
      { numRuns: 100 },
    );
  });

  it("an activity on the immediately following day increments by exactly 1 (Req 5.2)", () => {
    fc.assert(
      fc.property(streakStateArb, activityDayArb, (state, activityDay) => {
        // Only exercise states that already have an active day.
        fc.pre(state.lastActiveDay !== null);
        fc.pre(dayDifference(state.lastActiveDay as string, activityDay) === 1);

        const next = applyQualifyingActivity(state, activityDay);
        expect(next.count).toBe(state.count + 1);
        expect(next.lastActiveDay).toBe(activityDay);
      }),
      { numRuns: 100 },
    );
  });

  it("a second activity on the same day leaves the Streak unchanged (at most one increment per day — Req 5.4)", () => {
    fc.assert(
      fc.property(streakStateArb, (state) => {
        fc.pre(state.lastActiveDay !== null);
        const sameDay = state.lastActiveDay as string;
        const next = applyQualifyingActivity(state, sameDay);
        expect(next.count).toBe(state.count);
        expect(next.lastActiveDay).toBe(sameDay);
      }),
      { numRuns: 100 },
    );
  });

  it("an activity on any non-consecutive day sets the Streak to 1 (Req 5.9)", () => {
    fc.assert(
      fc.property(streakStateArb, activityDayArb, (state, activityDay) => {
        fc.pre(state.lastActiveDay !== null);
        const diff = dayDifference(state.lastActiveDay as string, activityDay);
        // Non-consecutive: a forward gap of a full day or more, or an
        // out-of-order earlier day. (diff === 0 and diff === 1 handled above.)
        fc.pre(diff !== 0 && diff !== 1);

        const next = applyQualifyingActivity(state, activityDay);
        expect(next.count).toBe(1);
        expect(next.lastActiveDay).toBe(activityDay);
      }),
      { numRuns: 100 },
    );
  });

  it("counts at most one increment per calendar day across a full activity sequence (Req 5.2, 5.4, 5.9)", () => {
    fc.assert(
      fc.property(activityDaySequenceArb, (days) => {
        let state = EMPTY_STATE;
        const distinctActiveDays = new Set<string>();

        for (const day of days) {
          const prev = state;
          state = applyQualifyingActivity(state, day);
          distinctActiveDays.add(day);

          if (prev.lastActiveDay === null) {
            // First-ever activity.
            expect(state.count).toBe(1);
          } else {
            const diff = dayDifference(prev.lastActiveDay, day);
            if (diff === 0) {
              // Same day: no change (Req 5.4).
              expect(state.count).toBe(prev.count);
            } else if (diff === 1) {
              // Consecutive day: +1 (Req 5.2).
              expect(state.count).toBe(prev.count + 1);
            } else {
              // Gap or out-of-order: reset to 1 (Req 5.9).
              expect(state.count).toBe(1);
            }
          }

          // The count never exceeds the number of distinct calendar days seen
          // so far — a direct consequence of "at most one increment per day".
          expect(state.count).toBeLessThanOrEqual(distinctActiveDays.size);
          // The count is always a positive integer once any activity occurred.
          expect(Number.isInteger(state.count)).toBe(true);
          expect(state.count).toBeGreaterThanOrEqual(1);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("current streak reads the stored count on the active day or the day after, and 0 once a full idle day elapses (Req 5.3)", () => {
    fc.assert(
      fc.property(streakReadInputArb, ({ state, today }) => {
        const reported = currentStreak(state, today);
        expect(Number.isInteger(reported)).toBe(true);
        expect(reported).toBeGreaterThanOrEqual(0);

        if (state.lastActiveDay === null) {
          expect(reported).toBe(0);
          return;
        }
        const diff = dayDifference(state.lastActiveDay, today);
        if (diff <= 1) {
          // Same day or the immediately following day: streak still stands.
          expect(reported).toBe(state.count);
        } else {
          // A full calendar day elapsed with no activity: reset to 0 (Req 5.3).
          expect(reported).toBe(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("current streak is always a non-negative integer for any state and read day", () => {
    fc.assert(
      fc.property(streakStateArb, activityDayArb, (state, today) => {
        const reported = currentStreak(state, today);
        expect(Number.isInteger(reported)).toBe(true);
        expect(reported).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 100 },
    );
  });
});
