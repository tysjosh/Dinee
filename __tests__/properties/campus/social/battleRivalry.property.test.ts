// Feature: campus-social-loops, Property 5: Rivalry records reflect head-to-head battle outcomes
/**
 * Feature: campus-social-loops, Property 5: Rivalry records reflect head-to-head
 * battle outcomes
 *
 * Validates: Requirements 1.7
 *
 * Req 1.7: WHEN a Battle_Outcome is resolved, THE Battle_Service SHALL update
 * each Battle_Participant's Battle_Ranking record and the Rivalry record for the
 * two Battle_Participants.
 *
 * The pure functions under test are {@link foldRivalry} and
 * {@link canonicalPairKey}. The property asserts the folded Rivalry record has a
 * canonical, order-independent identity, that per-agent win counts and the tie
 * count exactly reflect the head-to-head outcome sequence, and that
 * aWins + bWins + ties equals the total battle count.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  foldRivalry,
  canonicalPairKey,
  type BattleOutcome,
} from "../../../../convex/campus/social/logic/battles";
import { rivalrySequenceArb, type RivalryOutcome } from "./arbitraries";

/** Maps a test RivalryOutcome to the logic's BattleOutcome shape. */
function toBattleOutcome(o: RivalryOutcome): BattleOutcome {
  return o.kind === "tie"
    ? { kind: "tie" }
    : { kind: "winner", winnerAgentId: o.winnerAgentId };
}

describe("Property 5: Rivalry records reflect head-to-head battle outcomes", () => {
  it("counts per-agent wins and ties accurately with a canonical, order-independent identity", () => {
    fc.assert(
      fc.property(rivalrySequenceArb, ({ pair, outcomes }) => {
        const [x, y] = pair;
        const battleOutcomes = outcomes.map(toBattleOutcome);
        const record = foldRivalry(x, y, battleOutcomes);

        // Canonical identity: pairKey and agent ordering match canonicalPairKey.
        const canonical = canonicalPairKey(x, y);
        expect(record.pairKey).toBe(canonical.pairKey);
        expect(record.agentAId).toBe(canonical.agentAId);
        expect(record.agentBId).toBe(canonical.agentBId);
        expect(record.pairKey).toBe(`${record.agentAId}|${record.agentBId}`);

        // Independently tally against the canonical agent ids.
        let aWins = 0;
        let bWins = 0;
        let ties = 0;
        for (const o of battleOutcomes) {
          if (o.kind === "tie") ties += 1;
          else if (o.winnerAgentId === record.agentAId) aWins += 1;
          else if (o.winnerAgentId === record.agentBId) bWins += 1;
        }
        expect(record.aWins).toBe(aWins);
        expect(record.bWins).toBe(bWins);
        expect(record.ties).toBe(ties);

        // Total accounting: every outcome is classified exactly once.
        expect(record.battleCount).toBe(outcomes.length);
        expect(record.aWins + record.bWins + record.ties).toBe(
          record.battleCount
        );
      }),
      { numRuns: 100 }
    );
  });

  it("is independent of participant argument order", () => {
    fc.assert(
      fc.property(rivalrySequenceArb, ({ pair, outcomes }) => {
        const [x, y] = pair;
        const battleOutcomes = outcomes.map(toBattleOutcome);
        const forward = foldRivalry(x, y, battleOutcomes);
        const reversed = foldRivalry(y, x, battleOutcomes);
        expect(reversed).toEqual(forward);
      }),
      { numRuns: 100 }
    );
  });
});
