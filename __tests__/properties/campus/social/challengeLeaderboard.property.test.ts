// Feature: campus-social-loops, Property 11: Challenge_Leaderboard is descending by votes, tie-broken by earliest submission, bounded to 20, and excludes non-circulating entries
/**
 * Feature: campus-social-loops, Property 11: Challenge_Leaderboard is descending
 * by votes, tie-broken by earliest submission, bounded to 20, and excludes
 * non-circulating entries
 *
 * Validates: Requirements 2.8, 8.3
 *
 * Req 2.8: THE Challenge_Service SHALL present a per-campus Challenge_Leaderboard
 * ordered by descending Challenge_Vote count, breaking ties in favor of the
 * earliest submitted Challenge_Entry, presenting at most the top 20 entries and
 * excluding any entry whose Campus_Agent has Visibility private or is in the
 * removed, blocked, or deleted Publish_State.
 * Req 8.3: social ranking reuses the same "in circulation" exclusion invariant
 * ({@link isDiscoverable}) as Discovery_Service.
 *
 * The pure computation under test is {@link rankChallengeLeaderboard}.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  rankChallengeLeaderboard,
  MAX_CHALLENGE_LEADERBOARD_ENTRIES,
  type EntryView,
} from "../../../../convex/campus/social/logic/challenges";
import { isDiscoverable } from "../../../../convex/campus/logic/access";
import { challengeEntryViewsArb } from "./arbitraries";

/**
 * The leaderboard ordering: descending votes, then earliest submission, then
 * ascending entryId — mirrors the module's `compareEntries` so the strong
 * "exactly the expected ranking" check below is faithful.
 */
function compareEntries(a: EntryView, b: EntryView): number {
  const byVotes = b.votes - a.votes;
  if (byVotes !== 0) return byVotes;
  const bySubmission = a.submittedAt - b.submittedAt;
  if (bySubmission !== 0) return bySubmission;
  return a.entryId.localeCompare(b.entryId);
}

describe("Property 11: Challenge_Leaderboard ranking, bounds, and exclusion", () => {
  it("returns only circulating entries, descending by votes with earliest-submission tie-break, bounded to 20", () => {
    fc.assert(
      fc.property(challengeEntryViewsArb, (entries) => {
        const ranked = rankChallengeLeaderboard(entries);

        // Bounded to the top 20 (Req 2.8).
        expect(ranked.length).toBeLessThanOrEqual(
          MAX_CHALLENGE_LEADERBOARD_ENTRIES,
        );

        // Every surfaced entry is in circulation: published AND public. This
        // excludes private, removed, blocked, deleted, and any non-published
        // entry (Req 2.8, 8.3).
        for (const entry of ranked) {
          expect(isDiscoverable(entry)).toBe(true);
        }

        // Length equals min(circulating count, 20): nothing droppable is kept,
        // nothing keepable is dropped except by the bound.
        const circulating = entries.filter((e) => isDiscoverable(e));
        expect(ranked.length).toBe(
          Math.min(circulating.length, MAX_CHALLENGE_LEADERBOARD_ENTRIES),
        );

        // Ordering: each adjacent pair respects the comparator.
        for (let i = 1; i < ranked.length; i++) {
          const prev = ranked[i - 1];
          const cur = ranked[i];
          if (prev.votes !== cur.votes) {
            expect(prev.votes).toBeGreaterThan(cur.votes);
          } else if (prev.submittedAt !== cur.submittedAt) {
            expect(prev.submittedAt).toBeLessThan(cur.submittedAt);
          } else {
            expect(prev.entryId.localeCompare(cur.entryId)).toBeLessThanOrEqual(
              0,
            );
          }
        }

        // Strong check: the result equals the circulating entries sorted by the
        // ranking comparator and truncated to the bound (stable sort matches).
        const expectedRanking = circulating
          .slice()
          .sort(compareEntries)
          .slice(0, MAX_CHALLENGE_LEADERBOARD_ENTRIES);
        expect(ranked).toEqual(expectedRanking);
      }),
      { numRuns: 100 },
    );
  });

  it("top-N correctness: no dropped circulating entry out-ranks a surfaced one", () => {
    fc.assert(
      fc.property(challengeEntryViewsArb, (entries) => {
        const ranked = rankChallengeLeaderboard(entries);
        if (ranked.length < MAX_CHALLENGE_LEADERBOARD_ENTRIES) {
          // Nothing was dropped by the bound, so there is nothing to compare.
          return;
        }
        const surfaced = new Set(ranked);
        const weakestSurfaced = ranked[ranked.length - 1];
        const dropped = entries.filter(
          (e) => isDiscoverable(e) && !surfaced.has(e),
        );
        for (const d of dropped) {
          // A dropped entry must not sort strictly before the weakest surfaced
          // entry under the ranking comparator.
          expect(compareEntries(d, weakestSurfaced)).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("does not mutate its input array", () => {
    fc.assert(
      fc.property(challengeEntryViewsArb, (entries) => {
        const snapshot = entries.map((e) => ({ ...e }));
        rankChallengeLeaderboard(entries);
        expect(entries).toEqual(snapshot);
      }),
      { numRuns: 100 },
    );
  });
});
