// Feature: campus-social-loops, Property 12: Challenge winner is the greatest vote count, tie-broken by earliest submission
/**
 * Feature: campus-social-loops, Property 12: Challenge winner is the greatest
 * vote count, tie-broken by earliest submission
 *
 * Validates: Requirements 2.9
 *
 * Req 2.9: WHEN a Daily_Challenge's voting period closes, THE Challenge_Service
 * SHALL record the winning Challenge_Entry as the Challenge_Entry with the
 * greatest Challenge_Vote count, breaking ties in favor of the earliest
 * submitted Challenge_Entry.
 *
 * The pure computation under test is {@link resolveChallengeWinner}.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  resolveChallengeWinner,
  type EntryView,
} from "../../../../convex/campus/social/logic/challenges";
import { challengeEntryViewsArb } from "./arbitraries";

describe("Property 12: Challenge winner resolution", () => {
  it("returns null exactly when there are no entries", () => {
    fc.assert(
      fc.property(challengeEntryViewsArb, (entries) => {
        const winner = resolveChallengeWinner(entries);
        if (entries.length === 0) {
          expect(winner).toBeNull();
        } else {
          expect(winner).not.toBeNull();
        }
      }),
      { numRuns: 100 },
    );
  });

  it("selects the greatest vote count, breaking ties by earliest submission then smallest entryId", () => {
    fc.assert(
      fc.property(
        challengeEntryViewsArb.filter((e) => e.length > 0),
        (entries) => {
          const winner = resolveChallengeWinner(entries) as EntryView;

          // The winner is one of the input entries.
          expect(entries).toContain(winner);

          // No entry has more votes than the winner (greatest vote count).
          const maxVotes = Math.max(...entries.map((e) => e.votes));
          expect(winner.votes).toBe(maxVotes);

          // Among entries tied on the max vote count, the winner is submitted no
          // later than any other, and — on a submission tie — has the smallest
          // entryId (the deterministic final tie-break).
          for (const e of entries) {
            if (e.votes !== winner.votes) continue;
            if (e.submittedAt < winner.submittedAt) {
              throw new Error("an earlier-submitted tie entry should have won");
            }
            if (
              e.submittedAt === winner.submittedAt &&
              e.entryId.localeCompare(winner.entryId) < 0
            ) {
              throw new Error(
                "a smaller-entryId tie entry should have won",
              );
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("ignores circulation status: winner is chosen over all entries regardless of visibility/state", () => {
    // Req 2.9 selects the winning entry by votes/submission with no exclusion,
    // in contrast to the leaderboard (Req 2.8). A private, high-vote entry can
    // still be the recorded winner.
    const entries: EntryView[] = [
      {
        entryId: "b",
        agentId: "agent_a",
        status: "published",
        visibility: "public",
        submittedAt: 1_000,
        votes: 3,
      },
      {
        entryId: "a",
        agentId: "agent_b",
        status: "removed",
        visibility: "private",
        submittedAt: 2_000,
        votes: 9,
      },
    ];
    const winner = resolveChallengeWinner(entries) as EntryView;
    expect(winner.entryId).toBe("a");
    expect(winner.votes).toBe(9);
  });
});
