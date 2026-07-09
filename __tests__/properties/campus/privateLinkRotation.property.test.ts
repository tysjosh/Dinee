// Feature: dinee-campus, Property 35: Private_Link token access and rotation
/**
 * Feature: dinee-campus, Property 35: Private_Link token access and rotation
 *
 * Validates: Requirements 6.10, 6.11, 6.12
 *
 * For any private, published agent and any Private_Link token store, a
 * profile/call-link request presenting a token SHALL be granted access if and
 * only if the store contains a matching token for that agent whose status is
 * `active` (the owner is always granted regardless of token); a request
 * presenting a missing, unknown, or revoked token SHALL be denied.
 *
 * For any token rotation (revoke-then-issue), after rotation the previously
 * active token SHALL be denied and the newly issued token SHALL be granted;
 * after a revoke with no re-issue, the revoked token SHALL be denied.
 *
 * The pure decisions under test are {@link evaluateAccess} and
 * {@link hasValidPrivateLinkToken} over the {@link PrivateLinkRecord} store.
 * Rotation is modeled the way the Convex Private_Link store enacts it: the old
 * token's record flips to `status: "revoked"` and a fresh `active` record for a
 * new token is appended. A plain revoke flips the record to `revoked` with no
 * new record appended.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  evaluateAccess,
  hasValidPrivateLinkToken,
  type PrivateLinkRecord,
  type AgentAccessView,
} from "../../../convex/campus/logic/access";

// ---------------------------------------------------------------------------
// Fixtures & generators
// ---------------------------------------------------------------------------

const AGENT_ID = "agent-1";
const OWNER_ID = "user-owner";

/** A private, published agent — the only case where the token gate matters. */
const privatePublishedAgent: AgentAccessView = {
  agentId: AGENT_ID,
  ownerId: OWNER_ID,
  status: "published",
  visibility: "private",
};

/** A token string pool spanning known and unknown values. */
const tokenValueArb: fc.Arbitrary<string> = fc.constantFrom(
  "tok-1",
  "tok-2",
  "tok-3",
  "tok-4",
  "tok-unknown"
);

/** The agent a token binds to — sometimes a *different* agent. */
const tokenAgentArb: fc.Arbitrary<string> = fc.constantFrom(AGENT_ID, "agent-2");

/**
 * A Private_Link store: several tokens each bound to some agent and either
 * active or revoked, deliberately allowing cross-agent and revoked records so
 * every invalid-token path is exercised.
 */
const privateLinksArb: fc.Arbitrary<PrivateLinkRecord[]> = fc.array(
  fc.record({
    token: tokenValueArb,
    agentId: tokenAgentArb,
    status: fc.constantFrom<"active" | "revoked">("active", "revoked"),
  }),
  { maxLength: 5 }
);

/** A presented token: absent, empty, or one of the known/unknown values. */
const presentedTokenArb: fc.Arbitrary<string | null | undefined> =
  fc.constantFrom(undefined, null, "", "tok-1", "tok-2", "tok-3", "tok-4", "tok-unknown");

/** A non-owner requester so only the token can unlock access. */
const NON_OWNER = "user-caller";

/**
 * Reference oracle for token validity, restated independently of the impl: an
 * active record for that exact agent whose token equals a non-empty presented
 * token.
 */
function tokenIsValid(
  store: readonly PrivateLinkRecord[],
  agentId: string,
  token: string | null | undefined
): boolean {
  return (
    typeof token === "string" &&
    token.length > 0 &&
    store.some(
      (l) => l.token === token && l.agentId === agentId && l.status === "active"
    )
  );
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe("Property 35: Private_Link token access and rotation", () => {
  it("grants a non-owner iff an active matching token for that agent is presented; denies missing/unknown/revoked/cross-agent (Req 6.10, 6.11)", () => {
    fc.assert(
      fc.property(presentedTokenArb, privateLinksArb, (token, store) => {
        const decision = evaluateAccess({
          agent: privatePublishedAgent,
          requesterId: NON_OWNER,
          token,
          privateLinks: store,
        });
        if (tokenIsValid(store, AGENT_ID, token)) {
          expect(decision).toEqual({ granted: true });
        } else {
          expect(decision).toEqual({ granted: false, denial: "access_denied" });
        }
      }),
      { numRuns: 100 }
    );
  });

  it("grants the owner regardless of token (missing/unknown/revoked/valid) (Req 6.10)", () => {
    fc.assert(
      fc.property(presentedTokenArb, privateLinksArb, (token, store) => {
        const decision = evaluateAccess({
          agent: privatePublishedAgent,
          requesterId: OWNER_ID,
          token,
          privateLinks: store,
        });
        expect(decision).toEqual({ granted: true });
      }),
      { numRuns: 100 }
    );
  });

  it("denies a missing token for a non-owner (Req 6.11)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<string | null | undefined>(undefined, null, ""),
        privateLinksArb,
        (token, store) => {
          const decision = evaluateAccess({
            agent: privatePublishedAgent,
            requesterId: NON_OWNER,
            token,
            privateLinks: store,
          });
          expect(decision).toEqual({ granted: false, denial: "access_denied" });
        }
      ),
      { numRuns: 100 }
    );
  });

  it("denies a revoked token even when it matches the agent exactly (Req 6.11)", () => {
    fc.assert(
      fc.property(tokenValueArb, (token) => {
        const store: PrivateLinkRecord[] = [
          { token, agentId: AGENT_ID, status: "revoked" },
        ];
        const decision = evaluateAccess({
          agent: privatePublishedAgent,
          requesterId: NON_OWNER,
          token,
          privateLinks: store,
        });
        expect(decision).toEqual({ granted: false, denial: "access_denied" });
      }),
      { numRuns: 100 }
    );
  });

  it("rotation (revoke old + issue new) denies the old token and grants the new one (Req 6.12)", () => {
    // Two distinct token values so old != new.
    const twoTokensArb = fc
      .tuple(tokenValueArb, tokenValueArb)
      .filter(([a, b]) => a !== b);

    fc.assert(
      fc.property(twoTokensArb, privateLinksArb, ([oldToken, newToken], noise) => {
        // Start with the old token active for the agent, alongside arbitrary
        // noise records bound to other tokens/agents (never the new token).
        const noiseWithoutRotationTokens = noise.filter(
          (l) => l.token !== oldToken && l.token !== newToken
        );
        const beforeRotation: PrivateLinkRecord[] = [
          { token: oldToken, agentId: AGENT_ID, status: "active" },
          ...noiseWithoutRotationTokens,
        ];

        // Sanity: before rotation the old token grants the non-owner access.
        const beforeDecision = evaluateAccess({
          agent: privatePublishedAgent,
          requesterId: NON_OWNER,
          token: oldToken,
          privateLinks: beforeRotation,
        });
        expect(beforeDecision).toEqual({ granted: true });

        // Rotate: revoke the old record, append a fresh active record for the
        // new token (as the Private_Link store does).
        const afterRotation: PrivateLinkRecord[] = [
          ...beforeRotation.map((l) =>
            l.token === oldToken && l.agentId === AGENT_ID
              ? { ...l, status: "revoked" as const }
              : l
          ),
          { token: newToken, agentId: AGENT_ID, status: "active" },
        ];

        // Old token is now denied.
        expect(
          evaluateAccess({
            agent: privatePublishedAgent,
            requesterId: NON_OWNER,
            token: oldToken,
            privateLinks: afterRotation,
          })
        ).toEqual({ granted: false, denial: "access_denied" });

        // New token is now granted.
        expect(
          evaluateAccess({
            agent: privatePublishedAgent,
            requesterId: NON_OWNER,
            token: newToken,
            privateLinks: afterRotation,
          })
        ).toEqual({ granted: true });

        // The helper agrees with the gate on both tokens.
        expect(
          hasValidPrivateLinkToken(afterRotation, AGENT_ID, oldToken)
        ).toBe(false);
        expect(
          hasValidPrivateLinkToken(afterRotation, AGENT_ID, newToken)
        ).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("revoke with no re-issue denies the revoked token (Req 6.12)", () => {
    fc.assert(
      fc.property(tokenValueArb, privateLinksArb, (token, noise) => {
        const noiseWithoutToken = noise.filter((l) => l.token !== token);
        const active: PrivateLinkRecord[] = [
          { token, agentId: AGENT_ID, status: "active" },
          ...noiseWithoutToken,
        ];
        // Active first grants.
        expect(
          evaluateAccess({
            agent: privatePublishedAgent,
            requesterId: NON_OWNER,
            token,
            privateLinks: active,
          })
        ).toEqual({ granted: true });

        // Revoke in place, issue nothing new.
        const afterRevoke: PrivateLinkRecord[] = active.map((l) =>
          l.token === token && l.agentId === AGENT_ID
            ? { ...l, status: "revoked" as const }
            : l
        );
        expect(
          evaluateAccess({
            agent: privatePublishedAgent,
            requesterId: NON_OWNER,
            token,
            privateLinks: afterRevoke,
          })
        ).toEqual({ granted: false, denial: "access_denied" });
      }),
      { numRuns: 100 }
    );
  });
});
