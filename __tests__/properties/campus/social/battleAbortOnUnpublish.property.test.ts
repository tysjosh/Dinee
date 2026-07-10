// Feature: campus-social-loops, Property 6: A participant leaving published closes an open battle without a winner
/**
 * Feature: campus-social-loops, Property 6: A participant leaving published
 * closes an open battle without a winner
 *
 * Validates: Requirements 1.10
 *
 * Req 1.10: IF a Battle_Participant transitions out of the published
 * Publish_State while an Agent_Battle referencing it is open, THEN THE
 * Battle_Service SHALL close that Agent_Battle without a winner and present an
 * indication that a Battle_Participant is no longer available.
 *
 * The pure function under test is {@link abortBattleOnUnpublish}. The property
 * asserts the battle transitions to `aborted` (with no winner) exactly when it
 * is currently `open` and at least one participant is no longer `published`, and
 * that the status is otherwise left unchanged.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  abortBattleOnUnpublish,
  type BattleStatus,
} from "../../../../convex/campus/social/logic/battles";
import { publishStateArb } from "./arbitraries";
import type { PublishState } from "../../../../convex/campus/logic/access";

const battleStatusArb: fc.Arbitrary<BattleStatus> = fc.constantFrom(
  "generating",
  "open",
  "resolved",
  "aborted",
  "start_failed"
);

const participantsArb: fc.Arbitrary<{ status: PublishState }[]> = fc.array(
  fc.record({ status: publishStateArb }),
  { minLength: 0, maxLength: 3 }
);

describe("Property 6: A participant leaving published closes an open battle without a winner", () => {
  it("aborts iff the battle is open and some participant is no longer published, else leaves status unchanged", () => {
    fc.assert(
      fc.property(battleStatusArb, participantsArb, (status, participants) => {
        const decision = abortBattleOnUnpublish(status, participants);
        const shouldAbort =
          status === "open" &&
          participants.some((p) => p.status !== "published");

        if (shouldAbort) {
          expect(decision.aborted).toBe(true);
          expect(decision.status).toBe("aborted");
        } else {
          expect(decision.aborted).toBe(false);
          expect(decision.status).toBe(status);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("never aborts a battle that is not open, regardless of participant states", () => {
    const notOpenArb: fc.Arbitrary<BattleStatus> = fc.constantFrom(
      "generating",
      "resolved",
      "aborted",
      "start_failed"
    );
    fc.assert(
      fc.property(notOpenArb, participantsArb, (status, participants) => {
        const decision = abortBattleOnUnpublish(status, participants);
        expect(decision.aborted).toBe(false);
        expect(decision.status).toBe(status);
      }),
      { numRuns: 100 }
    );
  });
});
