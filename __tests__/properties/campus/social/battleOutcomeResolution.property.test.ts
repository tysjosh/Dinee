// Feature: campus-social-loops, Property 3: Battle outcome is the greater vote count, or a tie on equality
/**
 * Feature: campus-social-loops, Property 3: Battle outcome is the greater vote
 * count, or a tie on equality
 *
 * Validates: Requirements 1.6
 *
 * Req 1.6: WHEN an Agent_Battle's voting period closes, THE Battle_Service SHALL
 * resolve the Battle_Outcome as the Battle_Participant with the greater
 * Battle_Vote count, or as a tie when both Battle_Participants have equal
 * Battle_Vote counts.
 *
 * The pure function under test is {@link resolveBattle}. The property asserts
 * the resolved outcome is a `winner` for the strictly-greater tally and a `tie`
 * on equality (including 0–0), over both organically generated vote sequences
 * and exact constructed tallies clustered around equality.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  resolveBattle,
  type BattleVote,
} from "../../../../convex/campus/social/logic/battles";
import { battleWithVotesArb, voteTallyArb } from "./arbitraries";

/** Counts votes for each of the two participants, ignoring anything else. */
function tally(
  votes: readonly BattleVote[],
  pair: readonly [string, string]
): { a: number; b: number } {
  let a = 0;
  let b = 0;
  for (const v of votes) {
    if (v.choiceAgentId === pair[0]) a += 1;
    else if (v.choiceAgentId === pair[1]) b += 1;
  }
  return { a, b };
}

describe("Property 3: Battle outcome is the greater vote count, or a tie on equality", () => {
  it("resolves the greater tally as the winner and equal tallies as a tie (organic sequences)", () => {
    fc.assert(
      fc.property(battleWithVotesArb, ({ participantAgentIds, votes }) => {
        const outcome = resolveBattle(votes, participantAgentIds);
        const { a, b } = tally(votes, participantAgentIds);

        if (a > b) {
          expect(outcome).toEqual({
            kind: "winner",
            winnerAgentId: participantAgentIds[0],
          });
        } else if (b > a) {
          expect(outcome).toEqual({
            kind: "winner",
            winnerAgentId: participantAgentIds[1],
          });
        } else {
          expect(outcome).toEqual({ kind: "tie" });
        }
      }),
      { numRuns: 100 }
    );
  });

  it("resolves exact constructed tallies (winner-or-tie) around equality", () => {
    const pair: [string, string] = ["agent_a", "agent_b"];
    fc.assert(
      fc.property(voteTallyArb, ({ countA, countB }) => {
        const votes: BattleVote[] = [];
        for (let i = 0; i < countA; i++)
          votes.push({ voterKey: `a${i}`, choiceAgentId: pair[0] });
        for (let i = 0; i < countB; i++)
          votes.push({ voterKey: `b${i}`, choiceAgentId: pair[1] });

        const outcome = resolveBattle(votes, pair);

        if (countA > countB) {
          expect(outcome).toEqual({ kind: "winner", winnerAgentId: pair[0] });
        } else if (countB > countA) {
          expect(outcome).toEqual({ kind: "winner", winnerAgentId: pair[1] });
        } else {
          expect(outcome).toEqual({ kind: "tie" });
        }
      }),
      { numRuns: 100 }
    );
  });
});
