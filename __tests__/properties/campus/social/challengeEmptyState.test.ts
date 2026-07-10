// Feature: campus-social-loops, Task 12.2 — example test for the empty-challenge empty-state.
//
// Validates: Requirements 2.10
//
// Req 2.10: WHEN no Challenge_Entry has been submitted for a Daily_Challenge,
// THE Challenge_Service SHALL present an empty-state indication that no entries
// have been submitted.
//
// The Challenge_Service (`convex/campus/social/challenges.ts`)
// `getChallengeLeaderboard` query derives its empty-state through the pure
// `buildChallengeLeaderboardView` helper — the same function exercised here — so
// this example test verifies the exact decision the service enforces at runtime
// without a Convex harness (matching this repo's pure-core testing convention).

import { describe, it, expect } from "vitest";
import {
  buildChallengeLeaderboardView,
  rankChallengeLeaderboard,
  resolveChallengeWinner,
  type EntryView,
} from "../../../../convex/campus/social/logic/challenges";

/** A single published, public Challenge_Entry with the given vote count. */
function entry(
  entryId: string,
  votes: number,
  submittedAt: number
): EntryView {
  return {
    entryId,
    agentId: `agent_${entryId}`,
    status: "published",
    visibility: "public",
    submittedAt,
    votes,
  };
}

describe("Challenge empty-state (Req 2.10)", () => {
  it("a Daily_Challenge with no submitted entries presents the empty-state", () => {
    const view = buildChallengeLeaderboardView([]);

    // No entries are presented, and the empty-state indication is raised.
    expect(view.entries).toEqual([]);
    expect(view.isEmpty).toBe(true);
  });

  it("an empty Daily_Challenge has no winner to resolve", () => {
    // With no entries submitted there is nothing to rank or win.
    expect(rankChallengeLeaderboard([])).toEqual([]);
    expect(resolveChallengeWinner([])).toBeNull();
  });

  it("once at least one entry is submitted, the empty-state is no longer presented", () => {
    const view = buildChallengeLeaderboardView([entry("e1", 3, 1_000)]);

    expect(view.isEmpty).toBe(false);
    expect(view.entries).toHaveLength(1);
    expect(view.entries[0].entryId).toBe("e1");
  });

  it("a challenge whose only submitted entries are out of circulation still shows entries were submitted (not the empty-state)", () => {
    // A private/removed entry is excluded from the ranked list, but an entry
    // WAS submitted, so this is not the "no entries submitted" empty-state.
    const removed: EntryView = {
      entryId: "e2",
      agentId: "agent_e2",
      status: "removed",
      visibility: "public",
      submittedAt: 2_000,
      votes: 5,
    };

    const view = buildChallengeLeaderboardView([removed]);

    expect(view.isEmpty).toBe(false);
    expect(view.entries).toEqual([]);
  });
});
