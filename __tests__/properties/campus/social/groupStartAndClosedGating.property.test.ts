// Feature: campus-social-loops, Property 19: Group session start requires an owned, published agent, and a closed session accepts no questions
/**
 * Feature: campus-social-loops, Property 19: Group session start requires an
 * owned, published agent, and a closed session accepts no questions.
 *
 * Validates: Requirements 4.10, 4.8
 *
 * Req 4.10: a Group_Chat_Session is created only when the requester owns the
 * Campus_Agent AND that agent is in the `published` Publish_State; otherwise it
 * is not created and the reason is identified (not_owner / not_published).
 * Req 4.8: once a Student_Creator closes a Group_Chat_Session, it stops
 * accepting new Group_Questions — a closed session admits no one.
 *
 * The pure functions under test are {@link validateGroupStart} (start gate) and
 * {@link evaluateGroupAccess} (which surfaces `session_closed` when a token
 * matches a `closed` session, the point at which no further questions can be
 * accepted). Ownership is checked before publish state so a non-owner learns
 * nothing about the agent's state.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  validateGroupStart,
  evaluateGroupAccess,
  type GroupSessionView,
} from "../../../../convex/campus/social/logic/groupchat";
import { groupStartInputArb, groupTokenArb } from "./arbitraries";

/** A session that is definitively `closed`, with a token from the shared pool. */
const closedSessionArb: fc.Arbitrary<GroupSessionView> = fc.record({
  sessionId: fc.string({ minLength: 1, maxLength: 6 }),
  token: groupTokenArb,
  status: fc.constant("closed" as const),
});

describe("Property 19: group start requires an owned, published agent; a closed session accepts no questions", () => {
  it("permits start iff owner AND published, identifying the specific reason otherwise (Req 4.10)", () => {
    fc.assert(
      fc.property(groupStartInputArb, ({ isOwner, agentStatus }) => {
        const result = validateGroupStart({ isOwner, agentStatus });

        const shouldStart = isOwner && agentStatus === "published";
        expect(result.ok).toBe(shouldStart);

        if (!result.ok) {
          if (!isOwner) {
            // Ownership is checked first: a non-owner never leaks the state.
            expect(result.reason).toBe("not_owner");
          } else {
            expect(result.reason).toBe("not_published");
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  it("a closed session accepts no one even with the correct token (Req 4.8)", () => {
    fc.assert(
      fc.property(closedSessionArb, (session) => {
        // Present the session's own (correct) token against the closed session.
        const result = evaluateGroupAccess(session, session.token);
        expect(result.granted).toBe(false);
        expect(result.granted ? undefined : result.reason).toBe(
          "session_closed"
        );
      }),
      { numRuns: 100 }
    );
  });
});
