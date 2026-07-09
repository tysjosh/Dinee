// Feature: dinee-campus, Property 16: Conditional creator-contact routing
/**
 * Feature: dinee-campus, Property 16: Conditional creator-contact routing
 *
 * Validates: Requirements 8.6
 *
 * For any agent and any caller request, the runtime SHALL offer the creator
 * contact link if and only if the agent has a creator contact link configured
 * AND the request matches the configured routing condition, and the offered
 * link SHALL equal the configured link.
 *
 * Modules under test:
 *   - {@link decideCreatorContactOffer} — the offer decision (Req 8.6).
 *   - {@link requestMatchesRoutingCondition} — the routing-condition match
 *     (Req 8.6): the request matches when it contains any configured keyword
 *     (case-insensitive, after trimming); an undefined/empty routing condition
 *     or only blank keywords never match.
 *
 * The property asserts the biconditional against an INDEPENDENT reference
 * oracle (not the implementation) so a bug in the implementation cannot hide
 * behind a shared helper, and asserts that on an offer the returned link is
 * exactly the configured link.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  decideCreatorContactOffer,
  requestMatchesRoutingCondition,
  type CampusAgentRuntimeConfig,
  type CreatorContactRouting,
} from "../../../convex/campus/logic/session";

// ─── Independent reference oracles ───────────────────────────────────────────

/**
 * Reference oracle for "the request matches the configured routing condition":
 * a routing condition matches when it is present with at least one keyword
 * that, after trimming, is non-empty and appears (case-insensitively) as a
 * substring of the request text. Implemented independently of the module under
 * test.
 */
function oracleMatches(
  requestText: string,
  routing: CreatorContactRouting | undefined
): boolean {
  if (!routing) return false;
  const haystack = requestText.toLowerCase();
  for (const keyword of routing.keywords) {
    const needle = keyword.trim().toLowerCase();
    if (needle.length > 0 && haystack.indexOf(needle) !== -1) {
      return true;
    }
  }
  return false;
}

/**
 * Reference oracle for "the runtime offers the creator contact link": true iff
 * a non-empty link is configured AND the request matches the routing condition.
 */
function oracleShouldOffer(
  agent: CampusAgentRuntimeConfig,
  requestText: string
): boolean {
  const link = agent.creatorContactLink;
  const hasLink = typeof link === "string" && link.length > 0;
  return hasLink && oracleMatches(requestText, agent.creatorContactRouting);
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/**
 * A keyword candidate: real words, words with surrounding whitespace, mixed
 * case, and blank/whitespace-only strings (which must never match).
 */
const keywordArb: fc.Arbitrary<string> = fc.oneof(
  fc.string({ minLength: 1, maxLength: 12 }).filter((s) => s.trim().length > 0),
  fc.constantFrom("refund", "human", "manager", "Contact", "  BOOK  ", "help"),
  fc.constantFrom("", " ", "\t", "\n", "   ")
);

const routingArb: fc.Arbitrary<CreatorContactRouting | undefined> = fc.oneof(
  fc.constant(undefined),
  fc
    .array(keywordArb, { minLength: 0, maxLength: 5 })
    .map((keywords) => ({ keywords })),
);

/**
 * A creator-contact link candidate: undefined (not configured), empty string
 * (treated as not configured), or a non-empty URL-like string.
 */
const linkArb: fc.Arbitrary<string | undefined> = fc.oneof(
  fc.constant(undefined),
  fc.constant(""),
  fc
    .webUrl()
    .map((u) => u),
  fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.length > 0)
);

const agentArb: fc.Arbitrary<CampusAgentRuntimeConfig> = fc.record({
  agentId: fc.string({ minLength: 1, maxLength: 12 }),
  name: fc.string({ minLength: 1, maxLength: 20 }),
  voiceId: fc.string({ minLength: 1, maxLength: 12 }),
  purpose: fc.string({ maxLength: 40 }),
  creatorContactLink: linkArb,
  creatorContactRouting: routingArb,
});

/**
 * A request text that, when a routing condition has usable keywords, has a
 * meaningful chance of actually containing one of them (with arbitrary
 * surrounding text and altered casing). This exercises BOTH sides of the
 * biconditional rather than almost always producing non-matches.
 */
function requestArbFor(
  routing: CreatorContactRouting | undefined
): fc.Arbitrary<string> {
  const usable = (routing?.keywords ?? []).filter(
    (k) => k.trim().length > 0
  );
  const plain = fc.string({ maxLength: 60 });
  if (usable.length === 0) {
    return plain;
  }
  const embedded = fc
    .tuple(
      fc.constantFrom(...usable),
      fc.string({ maxLength: 20 }),
      fc.string({ maxLength: 20 }),
      fc.boolean()
    )
    .map(([kw, pre, post, upper]) => {
      const core = upper ? kw.toUpperCase() : kw;
      return `${pre}${core}${post}`;
    });
  return fc.oneof(plain, embedded);
}

// ─── Properties ──────────────────────────────────────────────────────────────

describe("Property 16: Conditional creator-contact routing", () => {
  it("offers the creator contact link iff a link is configured AND the request matches the routing condition", () => {
    fc.assert(
      fc.property(
        agentArb.chain((agent) =>
          requestArbFor(agent.creatorContactRouting).map((requestText) => ({
            agent,
            requestText,
          }))
        ),
        ({ agent, requestText }) => {
          const decision = decideCreatorContactOffer(agent, requestText);
          const expectedOffer = oracleShouldOffer(agent, requestText);

          expect(decision.offer).toBe(expectedOffer);

          // On an offer, the returned link must equal the configured link.
          if (decision.offer) {
            expect(decision.link).toBe(agent.creatorContactLink);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("never offers when no link is configured, regardless of the request", () => {
    fc.assert(
      fc.property(
        fc.record({
          agentId: fc.string({ minLength: 1, maxLength: 12 }),
          name: fc.string({ minLength: 1, maxLength: 20 }),
          voiceId: fc.string({ minLength: 1, maxLength: 12 }),
          purpose: fc.string({ maxLength: 40 }),
          creatorContactLink: fc.constantFrom(undefined, ""),
          creatorContactRouting: routingArb,
        }),
        fc.string({ maxLength: 60 }),
        (agent, requestText) => {
          expect(decideCreatorContactOffer(agent, requestText).offer).toBe(
            false
          );
        }
      ),
      { numRuns: 100 }
    );
  });

  it("routing matches iff the request contains a configured keyword (case-insensitive), matching the oracle", () => {
    fc.assert(
      fc.property(
        routingArb.chain((routing) =>
          requestArbFor(routing).map((requestText) => ({ routing, requestText }))
        ),
        ({ routing, requestText }) => {
          expect(requestMatchesRoutingCondition(requestText, routing)).toBe(
            oracleMatches(requestText, routing)
          );
        }
      ),
      { numRuns: 100 }
    );
  });
});
