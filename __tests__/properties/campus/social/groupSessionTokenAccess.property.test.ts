// Feature: campus-social-loops, Property 16: A Group_Chat_Session access token resolves only to its own open session
/**
 * Feature: campus-social-loops, Property 16: A Group_Chat_Session access token
 * resolves only to its own open session.
 *
 * Validates: Requirements 4.1, 4.7
 *
 * Req 4.1: starting a Group_Chat_Session generates a share link carrying a
 * unique access token that resolves ONLY to that Group_Chat_Session.
 * Req 4.7: a share link whose token is missing, invalid, revoked, or
 * mismatched yields an access-denied response that discloses no session
 * content.
 *
 * The pure gate under test is {@link evaluateGroupAccess}. Access is granted iff
 * the presented token is a non-empty string that exactly matches the session's
 * own token AND the session is `open`. Every other case is denied: a
 * missing/mismatched/revoked/empty token or absent session yields
 * `access_denied` (disclosing nothing), while a token that matches a `closed`
 * session yields `session_closed`.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  evaluateGroupAccess,
  type GroupSessionView,
} from "../../../../convex/campus/social/logic/groupchat";
import {
  groupAccessInputArb,
  groupSessionViewArb,
  groupTokenArb,
} from "./arbitraries";

/**
 * Reference oracle for "the token resolves to this open session", computed
 * independently of the implementation so the property is a genuine cross-check.
 */
function referenceAccess(
  session: GroupSessionView | null | undefined,
  token: string | null | undefined
): { granted: boolean; reason?: "access_denied" | "session_closed" } {
  if (
    session === null ||
    session === undefined ||
    typeof token !== "string" ||
    token.length === 0 ||
    token !== session.token
  ) {
    return { granted: false, reason: "access_denied" };
  }
  if (session.status !== "open") {
    return { granted: false, reason: "session_closed" };
  }
  return { granted: true };
}

describe("Property 16: a Group_Chat_Session access token resolves only to its own open session", () => {
  it("grants access iff a non-empty token exactly matches an open session's token", () => {
    fc.assert(
      fc.property(groupAccessInputArb, ({ session, token }) => {
        const result = evaluateGroupAccess(session, token);
        const expected = referenceAccess(session, token);

        expect(result.granted).toBe(expected.granted);
        if (result.granted) {
          // A grant resolves precisely to the matched session (Req 4.1).
          expect(session).toBeTruthy();
          expect(result.sessionId).toBe((session as GroupSessionView).sessionId);
          expect((session as GroupSessionView).status).toBe("open");
          expect(token).toBe((session as GroupSessionView).token);
        } else {
          // Denial discloses no sessionId, only the reason (Req 4.7).
          expect(result.reason).toBe(expected.reason);
          expect(
            (result as { sessionId?: string }).sessionId
          ).toBeUndefined();
        }
      }),
      { numRuns: 100 }
    );
  });

  it("denies a token that does not exactly match the session's own token (uniqueness — Req 4.1, 4.7)", () => {
    fc.assert(
      fc.property(groupSessionViewArb, groupTokenArb, (session, presented) => {
        const result = evaluateGroupAccess(session, presented);

        if (presented !== session.token) {
          // A token belonging to a different session never resolves here.
          expect(result.granted).toBe(false);
          expect(
            result.granted ? undefined : result.reason
          ).toBe("access_denied");
        } else if (session.status === "open") {
          expect(result.granted).toBe(true);
        } else {
          expect(result.granted).toBe(false);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("denies with access_denied for a missing/empty token or absent session, disclosing nothing", () => {
    fc.assert(
      fc.property(
        fc.option(groupSessionViewArb, { nil: undefined }),
        fc.constantFrom<string | null | undefined>("", null, undefined),
        (session, emptyToken) => {
          const result = evaluateGroupAccess(session ?? null, emptyToken);
          expect(result.granted).toBe(false);
          expect(
            result.granted ? undefined : result.reason
          ).toBe("access_denied");
        }
      ),
      { numRuns: 100 }
    );
  });
});
