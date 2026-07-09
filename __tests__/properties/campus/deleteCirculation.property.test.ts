// Feature: dinee-campus, Property 30: Deleting an agent removes it and disables its link
/**
 * Feature: dinee-campus, Property 30: Deleting an agent removes it and disables its link
 *
 * Validates: Requirements 12.2, 12.3
 *
 * For any agent, after a successful delete, the agent SHALL NOT be retrievable,
 * SHALL be excluded from all discovery listings, and its Call_Link SHALL return
 * an unavailable response.
 *
 * The pure circulation core under test is {@link applyDelete} (the Privacy_Controls
 * delete effect, Req 12.2/12.3) together with the three circulation predicates
 * that model how the rest of the platform observes an agent:
 *   - {@link isRetrievable}      — whether the agent can still be fetched at all.
 *   - {@link isDiscoverable}     — whether the agent appears in Discovery_Service listings.
 *   - {@link isCallLinkAvailable}— whether the agent's Call_Link serves content.
 *
 * The property asserts that starting from ANY agent (any Publish_State, any
 * Visibility), applying a delete yields an agent that is simultaneously
 * not retrievable, not discoverable, and whose Call_Link is unavailable — the
 * three post-delete guarantees of Requirement 12.3.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  applyDelete,
  isDiscoverable,
  isCallLinkAvailable,
  isRetrievable,
  type PublishState,
  type Visibility,
  type AgentCirculationView,
} from "../../../convex/campus/logic/access";

/** Every Publish_State, so the delete is exercised from any starting state. */
const publishStateArb: fc.Arbitrary<PublishState> = fc.constantFrom<PublishState>(
  "draft",
  "publish_pending_link",
  "published",
  "link_failed",
  "removed",
  "blocked",
  "deleted"
);

/** Both visibilities, so the delete is exercised for public and private agents. */
const visibilityArb: fc.Arbitrary<Visibility> = fc.constantFrom<Visibility>(
  "public",
  "private"
);

/** An arbitrary circulation view spanning the full (state × visibility) space. */
const agentArb: fc.Arbitrary<AgentCirculationView> = fc.record({
  status: publishStateArb,
  visibility: visibilityArb,
});

describe("Property 30: Deleting an agent removes it and disables its link", () => {
  it("makes a deleted agent not retrievable, not discoverable, and its Call_Link unavailable", () => {
    fc.assert(
      fc.property(agentArb, (agent) => {
        const deleted = applyDelete(agent);

        // The delete effect transitions the agent to the `deleted` state (Req 12.2).
        expect(deleted.status).toBe("deleted");

        // Req 12.3: after a successful delete the agent is no longer retrievable...
        expect(isRetrievable(deleted)).toBe(false);
        // ...is excluded from all discovery listings...
        expect(isDiscoverable(deleted)).toBe(false);
        // ...and its Call_Link returns an unavailable response.
        expect(isCallLinkAvailable(deleted)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it("is a pure, non-mutating effect that only changes status to `deleted`", () => {
    fc.assert(
      fc.property(agentArb, (agent) => {
        const snapshot = { ...agent };
        const deleted = applyDelete(agent);

        // The input is not mutated (Req 12.2/12.3 effects are pure copies).
        expect(agent).toEqual(snapshot);
        // Non-status fields are preserved verbatim on the returned copy.
        expect(deleted.visibility).toBe(agent.visibility);
      }),
      { numRuns: 100 }
    );
  });
});
