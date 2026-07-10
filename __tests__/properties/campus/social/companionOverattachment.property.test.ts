// Feature: campus-social-loops, Property 28: Companion overattachment reminders and take-a-break notices follow session-gap semantics
/**
 * Feature: campus-social-loops, Property 28: Companion overattachment reminders
 * and take-a-break notices follow session-gap semantics
 *
 * Validates: Requirements 7.4, 7.5
 *
 * The pure logic under test is {@link evaluateCompanionInteraction} from
 * `convex/campus/social/logic/companion.ts`. This property folds the function
 * over a timeline of interaction timestamps (starting from the initial state)
 * and cross-checks each decision against an independent oracle expressed in the
 * requirement's own quantities — continuous-session boundaries (a gap of 5
 * minutes or more starts a new session), time since the last identity reminder
 * (Req 7.4), and gapless cumulative interaction time (Req 7.5) — rather than
 * re-deriving the implementation's control flow.
 *
 * Req 7.4: for a companion-style Campus_Agent (`ai_twin` / `funny_character`),
 * present an AI-identity reminder before the first response of a continuous
 * interaction session and at least once every 30 minutes thereafter, where a
 * session ends after a gap of 5 minutes or more.
 *
 * Req 7.5: when gapless cumulative interaction with a single companion-style
 * agent reaches 60 minutes, present a take-a-break notice, and a further notice
 * at each subsequent 60-minute mark of such cumulative interaction.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import {
  evaluateCompanionInteraction,
  isCompanionAgentType,
  INITIAL_COMPANION_STATE,
  SESSION_GAP_MS,
  IDENTITY_REMINDER_INTERVAL_MS,
  BREAK_INTERVAL_MS,
  type CompanionState,
} from "../../../../convex/campus/social/logic/companion";
import type { AgentType } from "../../../../convex/campus/logic/validation";
import {
  companionTimelineArb,
  companionAgentTypeArb,
  AGENT_TYPES,
} from "./arbitraries";

/** Agent_Types that are NOT companion-style (never subject to the safeguard). */
const nonCompanionAgentTypeArb: fc.Arbitrary<AgentType> = fc.constantFrom(
  ...AGENT_TYPES.filter((t) => !isCompanionAgentType(t)),
);

describe("Property 28: Companion overattachment reminders and take-a-break notices follow session-gap semantics", () => {
  it("presents an AI-identity reminder at each session start and at least every 30 minutes, and a take-a-break notice at each 60-minute cumulative mark", () => {
    fc.assert(
      fc.property(
        companionTimelineArb,
        companionAgentTypeArb,
        (timeline, agentType) => {
          // Oracle state, tracked in the requirement's own quantities.
          let state: CompanionState = INITIAL_COMPANION_STATE;
          let prevNow: number | null = null;
          let lastReminderAt: number | null = null;
          let expectedCumulative = 0;
          let expectedBreaksShown = 0;

          for (const now of timeline) {
            const decision = evaluateCompanionInteraction(state, agentType, now);

            // A new continuous session begins on the first-ever interaction or
            // after a gap of 5 minutes or more (Req 7.4).
            const isNewSession =
              prevNow === null || now - prevNow >= SESSION_GAP_MS;

            if (isNewSession) {
              // Reminder before the first response of the session; no break
              // notice; cumulative interaction and break count reset (Req 7.4).
              expect(decision.showIdentityReminder).toBe(true);
              expect(decision.showBreakNotice).toBe(false);
              expect(decision.next.cumulativeMs).toBe(0);
              expect(decision.next.breaksShown).toBe(0);

              expectedCumulative = 0;
              expectedBreaksShown = 0;
              lastReminderAt = now;
            } else {
              // Continuing session: accrue the gap into gapless cumulative time.
              const gap = Math.max(0, now - (prevNow as number));
              expectedCumulative += gap;

              // Identity reminder due at least every 30 minutes (Req 7.4).
              const reminderDue =
                lastReminderAt === null ||
                now - lastReminderAt >= IDENTITY_REMINDER_INTERVAL_MS;
              expect(decision.showIdentityReminder).toBe(reminderDue);
              if (decision.showIdentityReminder) {
                lastReminderAt = now;
              }

              // Take-a-break notice at each new 60-minute cumulative mark
              // (Req 7.5).
              const marksReached = Math.floor(
                expectedCumulative / BREAK_INTERVAL_MS,
              );
              const breakDue = marksReached > expectedBreaksShown;
              expect(decision.showBreakNotice).toBe(breakDue);
              expect(decision.next.cumulativeMs).toBe(expectedCumulative);
              if (breakDue) {
                expectedBreaksShown = marksReached;
              }
              expect(decision.next.breaksShown).toBe(expectedBreaksShown);
            }

            prevNow = now;
            state = decision.next;
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("never presents a take-a-break notice before 60 minutes of gapless cumulative interaction have accrued", () => {
    fc.assert(
      fc.property(
        companionTimelineArb,
        companionAgentTypeArb,
        (timeline, agentType) => {
          let state: CompanionState = evaluateCompanionInteraction(
            INITIAL_COMPANION_STATE,
            agentType,
            timeline[0],
          ).next;

          for (let i = 1; i < timeline.length; i++) {
            const decision = evaluateCompanionInteraction(
              state,
              agentType,
              timeline[i],
            );
            // A break notice only ever coincides with the cumulative time
            // having reached at least one full 60-minute mark (Req 7.5).
            if (decision.showBreakNotice) {
              expect(decision.next.cumulativeMs).toBeGreaterThanOrEqual(
                BREAK_INTERVAL_MS,
              );
            }
            state = decision.next;
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("leaves non-companion agents untouched: no reminders, no break notices, state unchanged", () => {
    fc.assert(
      fc.property(
        companionTimelineArb,
        nonCompanionAgentTypeArb,
        (timeline, agentType) => {
          let state: CompanionState = INITIAL_COMPANION_STATE;
          for (const now of timeline) {
            const decision = evaluateCompanionInteraction(state, agentType, now);
            expect(decision.showIdentityReminder).toBe(false);
            expect(decision.showBreakNotice).toBe(false);
            expect(decision.next).toEqual(state);
            state = decision.next;
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
