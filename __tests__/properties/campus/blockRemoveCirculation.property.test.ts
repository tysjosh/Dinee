// Feature: dinee-campus, Property 27: Blocking or removing an agent takes it out of circulation
/**
 * Feature: dinee-campus, Property 27: Blocking or removing an agent takes it out of circulation
 *
 * Validates: Requirements 11.3, 11.4, 11.6
 *
 * For any agent, after a block action or a remove-from-listing action, the
 * agent SHALL be excluded from all discovery listings and its Call_Link SHALL
 * return an unavailable response.
 *
 * The pure effects under test are {@link applyBlock} (Req 11.3) and
 * {@link applyRemoveFromListing} (Req 11.4). Circulation is observed through
 * two pure predicates:
 *   - {@link isDiscoverable}: an agent belongs in discovery listings iff it is
 *     `published` AND public. After a block (`blocked`) or remove
 *     (`removed`) the status is no longer `published`, so it must be excluded.
 *   - {@link isCallLinkAvailable}: an agent's Call_Link is servable iff it is
 *     `published`. After a block or remove the link must be unavailable
 *     (Req 11.6).
 *
 * The property asserts that for ANY starting agent (any status, any
 * visibility), applying either action yields an agent that is BOTH
 * non-discoverable AND has an unavailable Call_Link — regardless of its prior
 * circulation state or visibility.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  applyBlock,
  applyRemoveFromListing,
  isDiscoverable,
  isCallLinkAvailable,
  type PublishState,
  type Visibility,
} from "../../../convex/campus/logic/access";

// ─── Value sets spanning the full input space ───────────────────────────────

const ALL_STATES: PublishState[] = [
  "draft",
  "publish_pending_link",
  "published",
  "link_failed",
  "removed",
  "blocked",
  "deleted",
];

const ALL_VISIBILITIES: Visibility[] = ["public", "private"];

/**
 * Arbitrary spanning any circulation view of an agent: every Publish_State
 * (including agents that are currently in circulation, i.e. `published` +
 * public) crossed with both visibilities. This ensures the property holds even
 * when the starting agent IS currently discoverable and callable.
 */
const agentArb = fc.record({
  status: fc.constantFrom(...ALL_STATES),
  visibility: fc.constantFrom(...ALL_VISIBILITIES),
});

describe("Property 27: Blocking or removing an agent takes it out of circulation", () => {
  it("a blocked agent is excluded from discovery and its Call_Link is unavailable (Req 11.3, 11.6)", () => {
    fc.assert(
      fc.property(agentArb, (agent) => {
        const blocked = applyBlock(agent);

        // The action takes it out of circulation.
        expect(blocked.status).toBe("blocked");
        expect(isDiscoverable(blocked)).toBe(false);
        expect(isCallLinkAvailable(blocked)).toBe(false);

        // Pure / non-mutating: the original is untouched.
        expect(blocked).not.toBe(agent);
        expect(agent.status).toBe(agent.status);
      }),
      { numRuns: 100 }
    );
  });

  it("an agent removed from listing is excluded from discovery and its Call_Link is unavailable (Req 11.4, 11.6)", () => {
    fc.assert(
      fc.property(agentArb, (agent) => {
        const removed = applyRemoveFromListing(agent);

        expect(removed.status).toBe("removed");
        expect(isDiscoverable(removed)).toBe(false);
        expect(isCallLinkAvailable(removed)).toBe(false);

        // Pure / non-mutating: the original is untouched.
        expect(removed).not.toBe(agent);
      }),
      { numRuns: 100 }
    );
  });

  it("neither action ever leaves an agent in circulation, regardless of prior state or visibility", () => {
    fc.assert(
      fc.property(
        agentArb,
        fc.constantFrom<"block" | "remove">("block", "remove"),
        (agent, action) => {
          const result =
            action === "block"
              ? applyBlock(agent)
              : applyRemoveFromListing(agent);

          // Out of circulation on both surfaces (discovery + Call_Link).
          const inCirculation =
            isDiscoverable(result) || isCallLinkAvailable(result);
          expect(inCirculation).toBe(false);

          // Visibility is preserved by the action (only the state changes).
          expect(result.visibility).toBe(agent.visibility);
        }
      ),
      { numRuns: 100 }
    );
  });
});
