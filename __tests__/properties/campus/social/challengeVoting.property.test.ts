// Feature: campus-social-loops, Property 10: Challenge voting records one vote per user (latest wins) and is refused after voting closes
/**
 * Feature: campus-social-loops, Property 10: Challenge voting records one vote
 * per user (latest wins) and is refused after voting closes
 *
 * Validates: Requirements 2.6, 2.7
 *
 * Req 2.6: WHILE the voting period is open, WHEN a user casts a Challenge_Vote,
 * THE Challenge_Service SHALL record at most one Challenge_Vote per user per
 * Daily_Challenge, counting the most recent selection when a user changes vote.
 * Req 2.7: a Challenge_Vote cast after the voting period has closed is rejected
 * with a "voting is closed" indication.
 *
 * The pure computation under test is {@link castChallengeVote}.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  castChallengeVote,
  type ChallengeVote,
} from "../../../../convex/campus/social/logic/challenges";
import { voterKeyArb } from "./arbitraries";

/** A small pool of entry ids so the same voter genuinely changes selection. */
const entryIdArb: fc.Arbitrary<string> = fc.constantFrom(
  "entry_1",
  "entry_2",
  "entry_3",
);

interface VoteStep {
  voterKey: string;
  entryId: string;
  votingOpen: boolean;
}

/** A single cast attempt, mixing open and closed voting states. */
const voteStepArb: fc.Arbitrary<VoteStep> = fc.record({
  voterKey: voterKeyArb,
  entryId: entryIdArb,
  // Bias toward open so accepted votes accumulate, but include closed attempts.
  votingOpen: fc.oneof(
    { weight: 3, arbitrary: fc.constant(true) },
    { weight: 1, arbitrary: fc.constant(false) },
  ),
});

/** A sequence of cast attempts to fold over a running vote set. */
const voteSequenceArb: fc.Arbitrary<VoteStep[]> = fc.array(voteStepArb, {
  minLength: 0,
  maxLength: 20,
});

/** True iff no two votes in the set share a voterKey. */
function hasUniqueVoters(votes: readonly ChallengeVote[]): boolean {
  return new Set(votes.map((v) => v.voterKey)).size === votes.length;
}

describe("Property 10: Challenge voting idempotency and close", () => {
  it("keeps at most one vote per user (latest selection) while open and refuses votes once closed", () => {
    fc.assert(
      fc.property(voteSequenceArb, (steps) => {
        let votes: ChallengeVote[] = [];
        // A reference model of the expected final state: voterKey -> entryId,
        // updated only on accepted (open) casts.
        const expected = new Map<string, string>();

        for (const step of steps) {
          const before = votes;
          const result = castChallengeVote(before, {
            voterKey: step.voterKey,
            entryId: step.entryId,
            votingOpen: step.votingOpen,
          });

          if (!step.votingOpen) {
            // Req 2.7: refused after close, existing votes returned unchanged.
            expect(result.accepted).toBe(false);
            expect(result.reason).toBe("voting_closed");
            expect(result.votes).toEqual(before);
          } else {
            // Req 2.6: accepted; the latest selection is recorded.
            expect(result.accepted).toBe(true);
            expect(result.reason).toBeUndefined();
            expected.set(step.voterKey, step.entryId);
          }

          votes = result.votes;

          // At most one vote per user always holds after each step (Req 2.6).
          expect(hasUniqueVoters(votes)).toBe(true);
        }

        // Final state matches the reference model exactly.
        expect(votes).toHaveLength(expected.size);
        for (const vote of votes) {
          expect(expected.get(vote.voterKey)).toBe(vote.entryId);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("replacing a vote does not change the vote count and reflects the new choice", () => {
    fc.assert(
      fc.property(voterKeyArb, entryIdArb, entryIdArb, (voter, first, second) => {
        const afterFirst = castChallengeVote([], {
          voterKey: voter,
          entryId: first,
          votingOpen: true,
        });
        expect(afterFirst.accepted).toBe(true);
        expect(afterFirst.votes).toHaveLength(1);

        const afterSecond = castChallengeVote(afterFirst.votes, {
          voterKey: voter,
          entryId: second,
          votingOpen: true,
        });
        expect(afterSecond.accepted).toBe(true);

        // Changing a vote never grows the count; the latest choice survives.
        expect(afterSecond.votes).toHaveLength(1);
        expect(afterSecond.votes[0]).toEqual({
          voterKey: voter,
          entryId: second,
        });
      }),
      { numRuns: 100 },
    );
  });

  it("does not mutate the input vote array on either accept or reject", () => {
    const original: ChallengeVote[] = [{ voterKey: "voter_1", entryId: "entry_1" }];
    const snapshot = original.map((v) => ({ ...v }));

    castChallengeVote(original, {
      voterKey: "voter_2",
      entryId: "entry_2",
      votingOpen: true,
    });
    castChallengeVote(original, {
      voterKey: "voter_2",
      entryId: "entry_2",
      votingOpen: false,
    });

    expect(original).toEqual(snapshot);
  });
});
