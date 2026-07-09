// Feature: dinee-campus, Property 22: Analytics access is owner-restricted
/**
 * Feature: dinee-campus, Property 22: Analytics access is owner-restricted
 *
 * Validates: Requirements 9.6
 *
 * For any analytics request where the requester is not the owner of the target
 * agent, the system SHALL deny access and disclose no metrics, questions, or
 * call summaries for that agent. Access is granted iff the requester is a
 * present, non-empty identity that exactly equals the (present, non-empty)
 * owner of the target agent; every other case — including a missing/empty
 * requester or owner — is denied as `unauthorized`.
 *
 * The pure decision under test is {@link authorizeAnalyticsAccess}. Its denial
 * variant carries only `{ authorized: false, error: "unauthorized" }` and no
 * agent payload, so a caller physically cannot leak metrics, questions, or
 * summaries on denial (defense-in-depth by construction). The generators span
 * the full identity space: a shared pool of ids (so owner/requester collisions
 * occur), plus the absent (`null`/`undefined`) and empty-string edge cases for
 * both the requester and the owner.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  authorizeAnalyticsAccess,
  type AnalyticsAccessResult,
} from "../../../convex/campus/logic/analytics";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * An identity value spanning the full input space: a small pool of concrete
 * ids so requester/owner collisions occur, plus the boundary cases that must
 * all fail closed (absent identities and the empty string).
 */
const identityArb: fc.Arbitrary<string | null | undefined> = fc.oneof(
  fc.constantFrom("user-a", "user-b", "user-c", "owner-1", "owner-2"),
  fc.constantFrom<string | null | undefined>(null, undefined, ""),
  fc.string({ maxLength: 12 })
);

/**
 * Reference oracle restating the specification independently of the
 * implementation: access is granted exactly when both identities are non-empty
 * strings and are equal.
 */
function shouldAuthorize(
  requesterId: string | null | undefined,
  ownerId: string | null | undefined
): boolean {
  return (
    typeof requesterId === "string" &&
    requesterId.length > 0 &&
    typeof ownerId === "string" &&
    ownerId.length > 0 &&
    requesterId === ownerId
  );
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe("Property 22: Analytics access is owner-restricted", () => {
  it("matches the owner-only specification oracle across the full identity space", () => {
    fc.assert(
      fc.property(identityArb, identityArb, (requesterId, ownerId) => {
        const result = authorizeAnalyticsAccess(requesterId, ownerId);
        expect(result.authorized).toBe(shouldAuthorize(requesterId, ownerId));
      }),
      { numRuns: 100 }
    );
  });

  it("denies every non-owner request as `unauthorized` and discloses no agent payload (Req 9.6)", () => {
    fc.assert(
      fc.property(identityArb, identityArb, (requesterId, ownerId) => {
        fc.pre(!shouldAuthorize(requesterId, ownerId));
        const result = authorizeAnalyticsAccess(requesterId, ownerId);
        // Denial is exactly the unauthorized sentinel with no extra fields, so
        // no metrics, questions, or summaries can ride along on the result.
        expect(result).toEqual({ authorized: false, error: "unauthorized" });
        expect(Object.keys(result).sort()).toEqual(["authorized", "error"]);
      }),
      { numRuns: 100 }
    );
  });

  it("grants access only to the exact owner and denies all other requesters for a fixed agent (Req 9.6)", () => {
    fc.assert(
      fc.property(identityArb, (requesterId) => {
        const ownerId = "owner-1";
        const result = authorizeAnalyticsAccess(requesterId, ownerId);
        if (requesterId === ownerId) {
          expect(result).toEqual({ authorized: true });
        } else {
          expect(result).toEqual({ authorized: false, error: "unauthorized" });
        }
      }),
      { numRuns: 100 }
    );
  });

  it("fails closed whenever the requester or owner identity is absent or empty (Req 9.6)", () => {
    const missingArb = fc.constantFrom<string | null | undefined>(
      null,
      undefined,
      ""
    );
    fc.assert(
      fc.property(
        fc.oneof(missingArb, identityArb),
        missingArb,
        (requesterId, presentOrMissingOwner) => {
          // At least one side is missing/empty in each branch below.
          const deniedByOwner = authorizeAnalyticsAccess(
            requesterId,
            presentOrMissingOwner
          );
          expect(deniedByOwner).toEqual({
            authorized: false,
            error: "unauthorized",
          });
          const deniedByRequester = authorizeAnalyticsAccess(
            presentOrMissingOwner,
            requesterId
          );
          expect(deniedByRequester).toEqual({
            authorized: false,
            error: "unauthorized",
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  it("only ever returns one of the two documented result shapes", () => {
    fc.assert(
      fc.property(identityArb, identityArb, (requesterId, ownerId) => {
        const result: AnalyticsAccessResult = authorizeAnalyticsAccess(
          requesterId,
          ownerId
        );
        if (result.authorized) {
          expect(result).toEqual({ authorized: true });
        } else {
          expect(result).toEqual({ authorized: false, error: "unauthorized" });
        }
      }),
      { numRuns: 100 }
    );
  });
});
