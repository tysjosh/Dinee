// Feature: campus-social-loops, Property 7: Battle voting is open exactly for 24 hours
/**
 * Feature: campus-social-loops, Property 7: Battle voting is open exactly for
 * 24 hours
 *
 * Validates: Requirements 1.12
 *
 * Req 1.12: WHEN an Agent_Battle is opened for voting, THE Battle_Service SHALL
 * keep the voting period open for 24 hours and SHALL close the voting period at
 * the end of that period.
 *
 * The pure functions under test are {@link battleVotingWindow} and
 * {@link isBattleVotingOpen}. The property asserts the window spans exactly
 * 24 hours from the open instant, that voting is open for `openedAt <= now <
 * closesAt` and closed elsewhere, and that the boundary is half-open (open at
 * the open instant, closed exactly at the close instant).
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  battleVotingWindow,
  isBattleVotingOpen,
  BATTLE_VOTING_WINDOW_MS,
} from "../../../../convex/campus/social/logic/battles";
import { votingWindowClockArb } from "./arbitraries";

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

describe("Property 7: Battle voting is open exactly for 24 hours", () => {
  it("spans exactly 24 hours and is open iff now is within [openedAt, closesAt)", () => {
    fc.assert(
      fc.property(votingWindowClockArb, ({ openedAt, now }) => {
        const window = battleVotingWindow(openedAt);

        // The window opens at openedAt and spans exactly 24 hours.
        expect(window.opensAt).toBe(openedAt);
        expect(window.closesAt - window.opensAt).toBe(TWENTY_FOUR_HOURS_MS);
        expect(BATTLE_VOTING_WINDOW_MS).toBe(TWENTY_FOUR_HOURS_MS);

        // Openness is exactly the half-open interval [opensAt, closesAt).
        const expectedOpen = now >= window.opensAt && now < window.closesAt;
        expect(isBattleVotingOpen(openedAt, now)).toBe(expectedOpen);
      }),
      { numRuns: 100 }
    );
  });

  it("is open at the open instant and the last millisecond, and closed at the close instant", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 4_000_000_000_000 }),
        (openedAt) => {
          const { closesAt } = battleVotingWindow(openedAt);
          // Open at the very start.
          expect(isBattleVotingOpen(openedAt, openedAt)).toBe(true);
          // Open at the final millisecond before close.
          expect(isBattleVotingOpen(openedAt, closesAt - 1)).toBe(true);
          // Closed exactly at the close instant (open for exactly 24h, not more).
          expect(isBattleVotingOpen(openedAt, closesAt)).toBe(false);
          // Closed after.
          expect(isBattleVotingOpen(openedAt, closesAt + 1)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});
