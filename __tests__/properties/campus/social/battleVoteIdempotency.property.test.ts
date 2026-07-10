// Feature: campus-social-loops, Property 2: Battle voting records one vote per voter (latest wins) and excludes participant owners
/**
 * Feature: campus-social-loops, Property 2: Battle voting records one vote per
 * voter (latest wins) and excludes participant owners
 *
 * Validates: Requirements 1.4, 1.5
 *
 * Req 1.4: WHEN a user other than the owner of either Battle_Participant casts a
 * Battle_Vote in an open Agent_Battle, THE Battle_Service SHALL record at most
 * one Battle_Vote per Voter per Agent_Battle, counting the most recent selection
 * when a Voter changes the vote.
 * Req 1.5: IF the owner of either Battle_Participant attempts to cast a
 * Battle_Vote in that Agent_Battle, THEN THE Battle_Service SHALL reject the
 * Battle_Vote and present an indication that owners cannot vote.
 *
 * The pure function under test is {@link castBattleVote}. Folding an accepted
 * sequence yields a tally with at most one vote per `voterKey`, and each voter's
 * recorded choice equals that voter's most recent accepted selection. An owner
 * requester is always rejected as `owner_excluded`, and a closed window is
 * always rejected as `voting_closed`, both leaving the tally unchanged.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  castBattleVote,
  type BattleVote,
} from "../../../../convex/campus/social/logic/battles";
import { battleWithVotesArb, ownerIdArb, voterKeyArb } from "./arbitraries";

describe("Property 2: Battle voting records one vote per voter (latest wins) and excludes participant owners", () => {
  it("folds an open vote sequence to one vote per voter with the latest selection winning", () => {
    fc.assert(
      fc.property(battleWithVotesArb, ({ participantAgentIds, votes }) => {
        let tally: BattleVote[] = [];
        // Track the last selection per voter, independently of the logic.
        const lastChoice = new Map<string, string>();

        for (const v of votes) {
          const result = castBattleVote(tally, {
            voterKey: v.voterKey,
            choiceAgentId: v.choiceAgentId,
            isOpen: true,
            participantAgentIds,
            ownerIds: [],
          });
          // A vote for one of the two participants in an open battle by a
          // non-owner is always accepted.
          expect(result.accepted).toBe(true);
          if (result.accepted) {
            tally = result.votes;
            lastChoice.set(v.voterKey, v.choiceAgentId);
          }
        }

        // At most one vote per voter.
        const keys = tally.map((t) => t.voterKey);
        expect(new Set(keys).size).toBe(keys.length);

        // The recorded set of voters equals the set of voters who cast a vote.
        expect(new Set(keys)).toEqual(new Set(lastChoice.keys()));

        // Latest selection wins for each voter.
        for (const entry of tally) {
          expect(entry.choiceAgentId).toBe(lastChoice.get(entry.voterKey));
        }
      }),
      { numRuns: 100 }
    );
  });

  it("rejects an owner's vote with owner_excluded and leaves the tally unchanged", () => {
    fc.assert(
      fc.property(
        battleWithVotesArb,
        voterKeyArb,
        ownerIdArb,
        ({ participantAgentIds }, voterKey, ownerId) => {
          const existing: BattleVote[] = [
            { voterKey: "prior_voter", choiceAgentId: participantAgentIds[0] },
          ];
          const result = castBattleVote(existing, {
            voterKey,
            choiceAgentId: participantAgentIds[0],
            isOpen: true,
            participantAgentIds,
            // The requester owns a participant.
            ownerIds: [ownerId],
            requesterId: ownerId,
          });
          expect(result.accepted).toBe(false);
          if (!result.accepted) {
            expect(result.reason).toBe("owner_excluded");
            expect(result.votes).toEqual(existing);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("rejects any vote after the window closes with voting_closed and leaves the tally unchanged", () => {
    fc.assert(
      fc.property(
        battleWithVotesArb,
        voterKeyArb,
        ({ participantAgentIds }, voterKey) => {
          const existing: BattleVote[] = [
            { voterKey: "prior_voter", choiceAgentId: participantAgentIds[1] },
          ];
          const result = castBattleVote(existing, {
            voterKey,
            choiceAgentId: participantAgentIds[0],
            isOpen: false,
            participantAgentIds,
            ownerIds: [],
          });
          expect(result.accepted).toBe(false);
          if (!result.accepted) {
            expect(result.reason).toBe("voting_closed");
            expect(result.votes).toEqual(existing);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
