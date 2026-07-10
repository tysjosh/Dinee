// Feature: campus-social-loops, Property 17: Group admission respects the 100-participant cap
/**
 * Feature: campus-social-loops, Property 17: Group admission respects the
 * 100-participant cap.
 *
 * Validates: Requirements 4.2, 4.12
 *
 * Req 4.2: a Group_Chat_Session admits up to a maximum of 100 concurrent
 * Participants.
 * Req 4.12: opening the link when the session already has 100 concurrent
 * Participants denies admission with a "session is full" indication.
 *
 * The pure gate under test is {@link admitParticipant}. An already-admitted
 * Participant is always (re)admitted — reopening the link never evicts them and
 * never over-counts. A new Participant is admitted iff the current count is
 * strictly below {@link GROUP_MAX_PARTICIPANTS} (100); the 101st distinct
 * Participant is denied as `session_full`.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  admitParticipant,
  GROUP_MAX_PARTICIPANTS,
} from "../../../../convex/campus/social/logic/groupchat";
import { groupAdmissionInputArb } from "./arbitraries";

describe("Property 17: group admission respects the 100-participant cap", () => {
  it("admits members always, and new participants only while below the cap", () => {
    fc.assert(
      fc.property(groupAdmissionInputArb, ({ currentCount, alreadyMember }) => {
        const result = admitParticipant({ currentCount, alreadyMember });

        const expectedAdmit =
          alreadyMember || currentCount < GROUP_MAX_PARTICIPANTS;

        expect(result.admitted).toBe(expectedAdmit);
        if (!result.admitted) {
          expect(result.reason).toBe("session_full");
          // Only a non-member at/over capacity is ever refused (Req 4.12).
          expect(alreadyMember).toBe(false);
          expect(currentCount).toBeGreaterThanOrEqual(GROUP_MAX_PARTICIPANTS);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("uses 100 as the exact boundary: 99 admits, 100 denies a new participant", () => {
    fc.assert(
      fc.property(fc.boolean(), (alreadyMember) => {
        const atBoundary = admitParticipant({
          currentCount: GROUP_MAX_PARTICIPANTS - 1,
          alreadyMember: false,
        });
        expect(atBoundary.admitted).toBe(true);

        const atCap = admitParticipant({
          currentCount: GROUP_MAX_PARTICIPANTS,
          alreadyMember,
        });
        // At exactly the cap, only an existing member is (re)admitted.
        expect(atCap.admitted).toBe(alreadyMember);
      }),
      { numRuns: 100 }
    );
  });
});
