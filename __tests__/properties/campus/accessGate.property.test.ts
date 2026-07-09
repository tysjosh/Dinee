// Feature: dinee-campus, Property 13: Profile and call-link availability access gate
/**
 * Feature: dinee-campus, Property 13: Profile and call-link availability access gate
 *
 * Validates: Requirements 6.6, 6.7, 6.10, 7.7, 7.8, 7.9, 10.8, 11.6
 *
 * For any profile or call-link request, content SHALL be served only when the
 * target agent exists AND is in the `published` Publish_State AND either
 *   (a) its visibility is public, or
 *   (b) it is private and the requester is the owner, or
 *   (c) it is private and the requester presents a valid, non-revoked
 *       Private_Link token for that agent.
 * In every other case — a private agent requested by a non-owner without a
 * valid token, an agent in the `draft`, `publish_pending_link`, `link_failed`,
 * `removed`, `blocked`, or `deleted` state, or a slug matching no agent — the
 * system SHALL withhold all profile content and return the appropriate
 * `access_denied`, `unavailable`, or `invalid` response with no agent fields
 * disclosed.
 *
 * The pure decision under test is {@link evaluateAccess} (and its combined form
 * {@link getAccessibleProfile}), backed by the {@link isOwner} and
 * {@link hasValidPrivateLinkToken} helpers. The generators below span the full
 * request space: every Publish_State (explicitly including the two new
 * `publish_pending_link` and `link_failed` states), both visibilities, an
 * owner/non-owner/anonymous requester, and a token that is valid, missing,
 * unknown, revoked, or bound to a different agent — so all four token outcomes
 * and every state exclusion are exercised.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  evaluateAccess,
  getAccessibleProfile,
  isOwner,
  hasValidPrivateLinkToken,
  type PublishState,
  type Visibility,
  type PrivateLinkRecord,
  type AgentAccessView,
  type CampusAgentRecord,
  type AgentType,
} from "../../../convex/campus/logic/access";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** All Publish_State literals — includes `publish_pending_link` + `link_failed`. */
const ALL_STATES: readonly PublishState[] = [
  "draft",
  "publish_pending_link",
  "published",
  "link_failed",
  "removed",
  "blocked",
  "deleted",
] as const;

/** Non-published states are all withheld as `unavailable`. */
const NON_PUBLISHED_STATES = ALL_STATES.filter((s) => s !== "published");

const publishStateArb: fc.Arbitrary<PublishState> = fc.constantFrom(
  ...ALL_STATES
);
const visibilityArb: fc.Arbitrary<Visibility> = fc.constantFrom(
  "public",
  "private"
);
const agentTypeArb: fc.Arbitrary<AgentType> = fc.constantFrom(
  "ai_twin",
  "study_agent",
  "club_agent",
  "campus_guide",
  "funny_character",
  "tutor_agent",
  "advice_agent"
);

/** A small pool of ids so owner/requester/token-agent collisions can occur. */
const idArb: fc.Arbitrary<string> = fc.constantFrom(
  "agent-1",
  "agent-2",
  "user-a",
  "user-b",
  "user-c"
);

const agentAccessViewArb: fc.Arbitrary<AgentAccessView> = fc.record({
  agentId: fc.constantFrom("agent-1", "agent-2"),
  ownerId: fc.constantFrom("user-a", "user-b"),
  status: publishStateArb,
  visibility: visibilityArb,
});

/**
 * A Private_Link store: a handful of tokens, each bound to some agent and either
 * active or revoked. Deliberately allows tokens bound to a different agent and
 * revoked tokens so invalid-token paths are covered.
 */
const privateLinksArb: fc.Arbitrary<PrivateLinkRecord[]> = fc.array(
  fc.record({
    token: fc.constantFrom("tok-1", "tok-2", "tok-3"),
    agentId: fc.constantFrom("agent-1", "agent-2"),
    status: fc.constantFrom<"active" | "revoked">("active", "revoked"),
  }),
  { maxLength: 4 }
);

/** A presented token: absent, empty, or one of the known/unknown token values. */
const presentedTokenArb: fc.Arbitrary<string | null | undefined> =
  fc.constantFrom(undefined, null, "", "tok-1", "tok-2", "tok-3", "tok-unknown");

/** A requester id: anonymous (null/undefined) or one of the users. */
const requesterArb: fc.Arbitrary<string | null | undefined> = fc.constantFrom(
  undefined,
  null,
  "user-a",
  "user-b",
  "user-c"
);

/** Full request, with the agent occasionally absent to exercise `invalid`. */
const requestArb = fc.record({
  agent: fc.option(agentAccessViewArb, { nil: null }),
  requesterId: requesterArb,
  token: presentedTokenArb,
  privateLinks: privateLinksArb,
});

/**
 * Reference oracle: the specification restated independently of the
 * implementation. Access is granted exactly under the published + (public |
 * owner | valid-token) conjunction; otherwise the appropriate denial code.
 */
function expectedDecision(req: {
  agent: AgentAccessView | null;
  requesterId?: string | null;
  token?: string | null;
  privateLinks: readonly PrivateLinkRecord[];
}): { granted: true } | { granted: false; denial: string } {
  const { agent } = req;
  if (!agent) return { granted: false, denial: "invalid" };
  if (agent.status !== "published") {
    return { granted: false, denial: "unavailable" };
  }
  if (agent.visibility === "public") return { granted: true };
  const ownerMatch =
    typeof req.requesterId === "string" &&
    req.requesterId.length > 0 &&
    req.requesterId === agent.ownerId;
  if (ownerMatch) return { granted: true };
  const tokenValid =
    typeof req.token === "string" &&
    req.token.length > 0 &&
    req.privateLinks.some(
      (l) =>
        l.token === req.token &&
        l.agentId === agent.agentId &&
        l.status === "active"
    );
  if (tokenValid) return { granted: true };
  return { granted: false, denial: "access_denied" };
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe("Property 13: Profile and call-link availability access gate", () => {
  it("matches the specification oracle across the full request space", () => {
    fc.assert(
      fc.property(requestArb, (req) => {
        const decision = evaluateAccess(req);
        const expected = expectedDecision(req);
        expect(decision.granted).toBe(expected.granted);
        if (!decision.granted && !expected.granted) {
          expect(decision.denial).toBe(expected.denial);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("returns `invalid` (no fields disclosed) when the slug matches no agent (Req 7.8)", () => {
    fc.assert(
      fc.property(
        requesterArb,
        presentedTokenArb,
        privateLinksArb,
        (requesterId, token, privateLinks) => {
          const decision = evaluateAccess({
            agent: null,
            requesterId,
            token,
            privateLinks,
          });
          expect(decision).toEqual({ granted: false, denial: "invalid" });
        }
      ),
      { numRuns: 100 }
    );
  });

  it("withholds every non-published state as `unavailable`, incl. publish_pending_link & link_failed (Req 6.7, 7.7, 7.9, 10.8, 11.6)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...NON_PUBLISHED_STATES),
        visibilityArb,
        requesterArb,
        presentedTokenArb,
        privateLinksArb,
        (status, visibility, requesterId, token, privateLinks) => {
          // Even an owner presenting a valid token cannot access a
          // non-published agent — state gating precedes authorization.
          const agent: AgentAccessView = {
            agentId: "agent-1",
            ownerId: typeof requesterId === "string" ? requesterId : "user-a",
            status,
            visibility,
          };
          const decision = evaluateAccess({
            agent,
            requesterId,
            token,
            privateLinks,
          });
          expect(decision).toEqual({ granted: false, denial: "unavailable" });
        }
      ),
      { numRuns: 100 }
    );
  });

  it("serves any published public agent regardless of requester or token (Req 6.1, 7.9)", () => {
    fc.assert(
      fc.property(requesterArb, presentedTokenArb, privateLinksArb, (requesterId, token, privateLinks) => {
        const agent: AgentAccessView = {
          agentId: "agent-1",
          ownerId: "user-a",
          status: "published",
          visibility: "public",
        };
        const decision = evaluateAccess({ agent, requesterId, token, privateLinks });
        expect(decision.granted).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("grants a published private agent to its owner, and denies non-owners lacking a valid token (Req 6.6, 6.10)", () => {
    fc.assert(
      fc.property(requesterArb, (requesterId) => {
        const agent: AgentAccessView = {
          agentId: "agent-1",
          ownerId: "user-a",
          status: "published",
          visibility: "private",
        };
        // No token store and no token presented: only the owner is granted.
        const decision = evaluateAccess({
          agent,
          requesterId,
          token: undefined,
          privateLinks: [],
        });
        if (requesterId === "user-a") {
          expect(decision.granted).toBe(true);
        } else {
          expect(decision).toEqual({ granted: false, denial: "access_denied" });
        }
      }),
      { numRuns: 100 }
    );
  });

  it("grants a published private agent to a non-owner with a valid non-revoked token, denies missing/unknown/revoked/cross-agent tokens (Req 6.10, 6.11)", () => {
    fc.assert(
      fc.property(presentedTokenArb, privateLinksArb, (token, privateLinks) => {
        const agent: AgentAccessView = {
          agentId: "agent-1",
          ownerId: "user-a",
          status: "published",
          visibility: "private",
        };
        // Non-owner requester so only the token can unlock access.
        const decision = evaluateAccess({
          agent,
          requesterId: "user-b",
          token,
          privateLinks,
        });
        const tokenValid = hasValidPrivateLinkToken(privateLinks, "agent-1", token);
        if (tokenValid) {
          expect(decision.granted).toBe(true);
        } else {
          expect(decision).toEqual({ granted: false, denial: "access_denied" });
        }
      }),
      { numRuns: 100 }
    );
  });

  it("hasValidPrivateLinkToken is true iff an active token for that exact agent is presented", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("agent-1", "agent-2"),
        presentedTokenArb,
        privateLinksArb,
        (agentId, token, privateLinks) => {
          const result = hasValidPrivateLinkToken(privateLinks, agentId, token);
          const oracle =
            typeof token === "string" &&
            token.length > 0 &&
            privateLinks.some(
              (l) =>
                l.token === token &&
                l.agentId === agentId &&
                l.status === "active"
            );
          expect(result).toBe(oracle);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("a revoked token never grants access even when it belongs to the agent (Req 6.11)", () => {
    fc.assert(
      fc.property(fc.constantFrom("tok-1", "tok-2", "tok-3"), (token) => {
        const agent: AgentAccessView = {
          agentId: "agent-1",
          ownerId: "user-a",
          status: "published",
          visibility: "private",
        };
        const privateLinks: PrivateLinkRecord[] = [
          { token, agentId: "agent-1", status: "revoked" },
        ];
        const decision = evaluateAccess({
          agent,
          requesterId: "user-b",
          token,
          privateLinks,
        });
        expect(decision).toEqual({ granted: false, denial: "access_denied" });
      }),
      { numRuns: 100 }
    );
  });

  it("isOwner is true iff a non-empty requester id equals the agent owner", () => {
    fc.assert(
      fc.property(idArb, requesterArb, (ownerId, requesterId) => {
        const result = isOwner({ ownerId }, requesterId);
        const oracle =
          typeof requesterId === "string" &&
          requesterId.length > 0 &&
          requesterId === ownerId;
        expect(result).toBe(oracle);
      }),
      { numRuns: 100 }
    );
  });

  it("getAccessibleProfile discloses a projection exactly when access is granted, and no agent fields on denial (Req 6.6, 6.7)", () => {
    // Build a full CampusAgentRecord so the projection branch can run.
    const recordArb: fc.Arbitrary<CampusAgentRecord> = fc.record({
      agentId: fc.constantFrom("agent-1", "agent-2"),
      ownerId: fc.constantFrom("user-a", "user-b"),
      status: publishStateArb,
      visibility: visibilityArb,
      name: fc.string({ minLength: 1, maxLength: 60 }),
      creatorDisplayName: fc.string({ minLength: 1, maxLength: 50 }),
      campusTag: fc.option(fc.string({ maxLength: 40 }), { nil: undefined }),
      agentType: agentTypeArb,
      description: fc.string({ maxLength: 400 }),
      previewPrompts: fc.array(fc.string({ maxLength: 40 }), { maxLength: 8 }),
      remixEnabled: fc.option(fc.boolean(), { nil: undefined }),
    });

    fc.assert(
      fc.property(
        fc.option(recordArb, { nil: null }),
        requesterArb,
        presentedTokenArb,
        privateLinksArb,
        (agent, requesterId, token, privateLinks) => {
          const result = getAccessibleProfile({
            agent,
            requesterId,
            token,
            privateLinks,
          });
          const gate = evaluateAccess({
            agent: agent
              ? {
                  agentId: agent.agentId,
                  ownerId: agent.ownerId,
                  status: agent.status,
                  visibility: agent.visibility,
                }
              : agent,
            requesterId,
            token,
            privateLinks,
          });
          expect(result.granted).toBe(gate.granted);
          if (result.granted) {
            // A projection is disclosed only on grant.
            expect(result.profile).toBeDefined();
          } else {
            // Denial carries only a status code, no agent content fields.
            expect(Object.keys(result).sort()).toEqual(["denial", "granted"]);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
