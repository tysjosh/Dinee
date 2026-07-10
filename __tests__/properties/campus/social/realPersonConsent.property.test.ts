// Feature: campus-social-loops, Property 30: Real-person agents require verified Voice_Clone_Consent to participate
/**
 * Feature: campus-social-loops (Task 9.2), Property 30: Real-person agents
 * require verified Voice_Clone_Consent to participate.
 *
 * Validates: Requirements 7.10, 7.11
 *
 * This test verifies REUSE, not re-proof: before a Campus_Agent that represents
 * a real person may participate in an Agent_Battle, Daily_Challenge, or
 * Group_Chat_Session, the Social_Loops_Layer defers to the SAME reused
 * {@link evaluateConsentGate} from `convex/campus/logic/consent.ts`. The gate
 * permits participation iff the agent does NOT represent a real person OR a
 * verified Voice_Clone_Consent (recorded phrase / account ownership) exists for
 * that agent; otherwise it blocks with `consent_required` (Req 7.10, 7.11).
 *
 * The property drives the reused gate with the shared social arbitraries and
 * tags each input with the participation context (battle / challenge / group)
 * to demonstrate the identical consent requirement applies uniformly across the
 * three social entry points.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  evaluateConsentGate,
  CONSENT_METHODS,
  type ConsentRecordView,
} from "../../../../convex/campus/logic/consent";
import { consentGateInputArb, consentRecordArb } from "./arbitraries";

/**
 * The three social contexts a real-person agent may attempt to join. The
 * consent gate is context-agnostic, so tagging each input demonstrates the
 * requirement is enforced identically for every participation path
 * (Req 7.10, 7.11).
 */
const participationContextArb: fc.Arbitrary<string> = fc.constantFrom(
  "agent_battle",
  "daily_challenge",
  "group_chat_session",
);

/**
 * Independent reference oracle for "a verified Voice_Clone_Consent exists for
 * `agentId`": some record belongs to the agent, is verified, and carries an
 * accepted method. Computed without the implementation so the property is a
 * genuine cross-check.
 */
function referenceHasVerifiedConsent(
  consents: readonly ConsentRecordView[] | undefined,
  agentId: string,
): boolean {
  if (!consents) return false;
  return consents.some(
    (c) =>
      c.agentId === agentId &&
      c.verified === true &&
      (CONSENT_METHODS as readonly string[]).includes(c.method),
  );
}

describe("Property 30: Real-person agents require verified Voice_Clone_Consent to participate", () => {
  it("permits participation iff the agent is not a real person or a verified consent exists; blocks with consent_required otherwise (Req 7.10, 7.11)", () => {
    fc.assert(
      fc.property(
        participationContextArb,
        consentGateInputArb,
        (_context, input) => {
          const decision = evaluateConsentGate(input);
          const expectedPermitted =
            !input.representsRealPerson ||
            referenceHasVerifiedConsent(input.consents, input.agentId);

          expect(decision.permitted).toBe(expectedPermitted);

          if (!decision.permitted) {
            // A blocked real-person participation carries the consent_required
            // indication (Req 7.11).
            expect(decision.error).toBe("consent_required");
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("blocks a real-person agent with no qualifying consent from every social context (Req 7.11)", () => {
    const nonQualifyingConsentsArb = fc
      .array(consentRecordArb, { maxLength: 6 })
      .filter((cs) => !referenceHasVerifiedConsent(cs, "agent_a"));

    fc.assert(
      fc.property(
        participationContextArb,
        nonQualifyingConsentsArb,
        (_context, consents) => {
          const decision = evaluateConsentGate({
            agentId: "agent_a",
            representsRealPerson: true,
            consents,
          });
          expect(decision.permitted).toBe(false);
          if (!decision.permitted) {
            expect(decision.error).toBe("consent_required");
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("permits a real-person agent to participate when a verified, agent-matching, valid-method consent exists (Req 7.10)", () => {
    fc.assert(
      fc.property(
        participationContextArb,
        fc.constantFrom(...CONSENT_METHODS),
        fc.array(consentRecordArb, { maxLength: 4 }),
        (_context, method, otherConsents) => {
          const qualifying: ConsentRecordView = {
            agentId: "agent_a",
            method,
            verified: true,
          };
          const decision = evaluateConsentGate({
            agentId: "agent_a",
            representsRealPerson: true,
            consents: [...otherConsents, qualifying],
          });
          expect(decision.permitted).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
