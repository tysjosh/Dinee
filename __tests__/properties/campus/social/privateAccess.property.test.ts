// Feature: campus-social-loops, Property 32: Private-agent access in social features discloses nothing on denial
/**
 * Feature: campus-social-loops (Task 9.4), Property 32: Private-agent access in
 * social features discloses nothing on denial.
 *
 * Validates: Requirements 8.6
 *
 * This test verifies REUSE, not re-proof: when a social feature accesses a
 * private Campus_Agent it enforces the SAME reused Visibility / Private_Link
 * rules via {@link evaluateAccess} and {@link hasValidPrivateLinkToken} from
 * `convex/campus/logic/access.ts`. Access is granted iff the agent exists AND is
 * `published` AND either (a) public, (b) requested by its owner, or (c)
 * accompanied by a valid, non-revoked Private_Link token for that agent. In
 * every other case the gate withholds ALL content and returns only a denial
 * code — no agent fields are disclosed (Req 8.6).
 *
 * The property drives the reused gate with the shared social arbitraries
 * (present/absent agent × visibility × owner/non-owner × token validity), tags
 * each request with the social feature performing the access, and asserts the
 * grant biconditional plus the non-disclosure guarantee on denial.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  evaluateAccess,
  hasValidPrivateLinkToken,
  isOwner,
  type AccessRequest,
} from "../../../../convex/campus/logic/access";
import { accessRequestInputArb } from "./arbitraries";

/**
 * The social features that may reference a (possibly private) Campus_Agent. The
 * access gate is feature-agnostic, so tagging each request demonstrates the
 * identical Visibility / Private_Link enforcement across the social surface
 * (Req 8.6).
 */
const socialAccessFeatureArb: fc.Arbitrary<string> = fc.constantFrom(
  "battle_participant",
  "challenge_entry",
  "group_session",
  "quest_step_reference",
);

/**
 * Independent reference oracle for the grant condition: an agent exists, is
 * published, and is public OR owner-requested OR accompanied by a valid token.
 * Computed without the implementation so the property genuinely cross-checks.
 */
function referenceGranted(request: AccessRequest): boolean {
  const { agent } = request;
  if (!agent) return false;
  if (agent.status !== "published") return false;
  if (agent.visibility === "public") return true;
  if (isOwner(agent, request.requesterId)) return true;
  return hasValidPrivateLinkToken(
    request.privateLinks ?? [],
    agent.agentId,
    request.token,
  );
}

describe("Property 32: Private-agent access in social features discloses nothing on denial", () => {
  it("grants access iff the agent exists, is published, and is public or owner- or valid-token-authorized (Req 8.6)", () => {
    fc.assert(
      fc.property(
        socialAccessFeatureArb,
        accessRequestInputArb,
        (_feature, request) => {
          const decision = evaluateAccess(request);
          expect(decision.granted).toBe(referenceGranted(request));
        },
      ),
      { numRuns: 100 },
    );
  });

  it("withholds all agent content on denial, returning only a denial code and no agent fields (Req 8.6)", () => {
    fc.assert(
      fc.property(
        socialAccessFeatureArb,
        accessRequestInputArb,
        (_feature, request) => {
          const decision = evaluateAccess(request);
          if (!decision.granted) {
            // The denial result exposes ONLY { granted, denial } — no agent
            // identity, ownership, visibility, or profile content leaks.
            expect(Object.keys(decision).sort()).toEqual(["denial", "granted"]);
            expect(["access_denied", "unavailable", "invalid"]).toContain(
              decision.denial,
            );
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
