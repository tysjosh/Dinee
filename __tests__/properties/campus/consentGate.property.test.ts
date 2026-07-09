// Feature: dinee-campus, Property 29: Voice-clone consent gate
/**
 * Feature: dinee-campus, Property 29: Voice-clone consent gate
 *
 * Validates: Requirements 11.11, 11.12
 *
 * For any publish attempt, publication SHALL be permitted with respect to
 * consent if and only if the agent does NOT represent a real person, OR a
 * verified Voice_Clone_Consent (recorded phrase or account ownership) exists
 * for that agent; otherwise publication SHALL be blocked with a
 * `consent_required` error.
 *
 * The pure gate under test is {@link evaluateConsentGate}. A `{ permitted: true }`
 * result models "publication is permitted with respect to consent"; a
 * `{ permitted: false, error: "consent_required" }` result models "publication
 * is blocked because recorded Voice_Clone_Consent or permission is missing"
 * (Req 11.12). Consent qualifies only when it belongs to the agent, uses one of
 * the accepted verification methods (recorded phrase / account ownership,
 * Req 11.11), and is `verified`.
 *
 * The property asserts the biconditional: evaluateConsentGate permits publish
 * exactly when the agent does not represent a real person OR a verified,
 * agent-matching, valid-method consent exists — and blocks with
 * `consent_required` in every other case.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  evaluateConsentGate,
  hasVerifiedConsent,
  CONSENT_METHODS,
  type ConsentRecordView,
  type ConsentGateInput,
} from "../../../convex/campus/logic/consent";

/**
 * Reference oracle for "a verified Voice_Clone_Consent exists for `agentId`":
 * some record belongs to the agent, is verified, and carries an accepted
 * method (recorded phrase / account ownership). Computed independently of the
 * implementation so the property is a genuine cross-check.
 */
function referenceHasVerifiedConsent(
  consents: readonly ConsentRecordView[] | undefined,
  agentId: string
): boolean {
  if (!consents) return false;
  for (const c of consents) {
    if (
      c.agentId === agentId &&
      c.verified === true &&
      (CONSENT_METHODS as readonly string[]).includes(c.method)
    ) {
      return true;
    }
  }
  return false;
}

/** A small pool of agent ids so consents sometimes match and sometimes don't. */
const agentIdArb: fc.Arbitrary<string> = fc.constantFrom(
  "agent_a",
  "agent_b",
  "agent_c"
);

const methodArb: fc.Arbitrary<ConsentMethodLike> = fc.oneof(
  fc.constantFrom<ConsentMethodLike>(...CONSENT_METHODS),
  // Occasionally inject an invalid method to ensure it does not qualify.
  fc.constantFrom<ConsentMethodLike>(
    "unknown_method" as ConsentMethodLike,
    "" as ConsentMethodLike
  )
);

// Loosen the method type so the arbitrary can emit invalid methods too, while
// the record still structurally matches ConsentRecordView for the gate.
type ConsentMethodLike = ConsentRecordView["method"];

const consentRecordArb: fc.Arbitrary<ConsentRecordView> = fc.record({
  agentId: agentIdArb,
  method: methodArb,
  verified: fc.boolean(),
});

const consentsArb: fc.Arbitrary<readonly ConsentRecordView[] | undefined> =
  fc.oneof(
    fc.constant(undefined),
    fc.array(consentRecordArb, { maxLength: 6 })
  );

const gateInputArb: fc.Arbitrary<ConsentGateInput> = fc.record({
  agentId: agentIdArb,
  representsRealPerson: fc.boolean(),
  consents: consentsArb,
});

describe("Property 29: Voice-clone consent gate", () => {
  it("permits publish iff the agent is not a real person or a verified consent exists; blocks with consent_required otherwise", () => {
    fc.assert(
      fc.property(gateInputArb, (input) => {
        const decision = evaluateConsentGate(input);
        const expectedPermitted =
          !input.representsRealPerson ||
          referenceHasVerifiedConsent(input.consents, input.agentId);

        expect(decision.permitted).toBe(expectedPermitted);

        if (!decision.permitted) {
          // Blocked publications carry exactly the consent_required error.
          expect(decision.error).toBe("consent_required");
        }
      }),
      { numRuns: 100 }
    );
  });

  it("always permits publish when the agent does not represent a real person, regardless of consents", () => {
    fc.assert(
      fc.property(agentIdArb, consentsArb, (agentId, consents) => {
        const decision = evaluateConsentGate({
          agentId,
          representsRealPerson: false,
          consents,
        });
        expect(decision.permitted).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("blocks with consent_required when a real person has no qualifying consent", () => {
    // Consents that never qualify for the target agent: either a different
    // agent, unverified, or an invalid method.
    const nonQualifyingConsentsArb = fc
      .array(consentRecordArb, { maxLength: 6 })
      .filter((cs) => !referenceHasVerifiedConsent(cs, "agent_a"));

    fc.assert(
      fc.property(nonQualifyingConsentsArb, (consents) => {
        const decision = evaluateConsentGate({
          agentId: "agent_a",
          representsRealPerson: true,
          consents,
        });
        expect(decision.permitted).toBe(false);
        if (!decision.permitted) {
          expect(decision.error).toBe("consent_required");
        }
      }),
      { numRuns: 100 }
    );
  });

  it("permits publish for a real person when a verified, agent-matching, valid-method consent exists", () => {
    fc.assert(
      fc.property(
        agentIdArb,
        fc.constantFrom(...CONSENT_METHODS),
        fc.array(consentRecordArb, { maxLength: 4 }),
        (agentId, method, otherConsents) => {
          const qualifying: ConsentRecordView = {
            agentId,
            method,
            verified: true,
          };
          // Sanity-check the oracle and helper agree the consent qualifies.
          const consents = [...otherConsents, qualifying];
          expect(hasVerifiedConsent(consents, agentId)).toBe(true);

          const decision = evaluateConsentGate({
            agentId,
            representsRealPerson: true,
            consents,
          });
          expect(decision.permitted).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});
