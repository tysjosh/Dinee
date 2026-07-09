// Feature: dinee-campus, Property 24: Discovery filter predicate holds for all results
/**
 * Feature: dinee-campus, Property 24: Discovery filter predicate holds for all results
 *
 * Validates: Requirements 10.4
 *
 * The Discovery_Service allows filtering the listed Campus_Agents by campus,
 * Agent_Type, trending (most completed voice conversations in the trailing
 * 7 days), and new (published within the trailing 30 days) (Req 10.4).
 *
 * This property asserts the soundness of that filtering: for ANY collection of
 * Campus_Agents, ANY {@link DiscoveryFilter}, and ANY discovery context, every
 * agent returned by {@link listAgents} SHALL satisfy the requested filter
 * predicate — i.e., it is discoverable (published + public), its `campusTag`
 * matches the requested campus (when a campus filter is set), its `agentType`
 * matches the requested Agent_Type (when a type filter is set), and — when the
 * `new` sort is requested — it was published within the trailing 30 days.
 *
 * The pure predicate under test is {@link matchesDiscoveryFilter}; the property
 * checks it against every element of the {@link listAgents} result and, for
 * defense in depth, re-checks each individual filter dimension via
 * {@link isDiscoverable}, {@link matchesCampus}, {@link matchesType}, and
 * {@link isNewAgent}. `trending` is a pure ordering (it imposes no membership
 * constraint), so a trending listing is only required to remain listable.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  listAgents,
  matchesDiscoveryFilter,
  matchesCampus,
  matchesType,
  isNewAgent,
  NEW_WINDOW_DAYS,
  type DiscoveryAgentView,
  type DiscoveryFilter,
  type DiscoveryContext,
  type CompletedCallCount,
} from "../../../convex/campus/logic/discovery";
import { isDiscoverable } from "../../../convex/campus/logic/access";
import { AGENT_TYPES } from "../../../convex/campus/logic/validation";

/** A fixed reference "now" so publishedAt windows are deterministic. */
const NOW = 1_700_000_000_000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** All seven Publish_States, so non-published agents are exercised too. */
const PUBLISH_STATES = [
  "draft",
  "publish_pending_link",
  "published",
  "link_failed",
  "removed",
  "blocked",
  "deleted",
] as const;

/** A small pool of campuses so filters actually match some agents. */
const CAMPUS_POOL = ["mit", "stanford", "berkeley", "nyu"] as const;

/** Publish timestamps spanning inside and outside the trailing 30-day window. */
const publishedAtArb: fc.Arbitrary<number> = fc.integer({
  // From ~90 days before NOW to ~10 days after NOW, so some agents are new,
  // some are stale, and some publishedAt values fall in the future.
  min: NOW - 90 * MS_PER_DAY,
  max: NOW + 10 * MS_PER_DAY,
});

/**
 * A Campus_Agent view spanning the full input space: every Publish_State, both
 * visibilities, all Agent_Types, an optional campus tag drawn from the pool,
 * and an optional publish timestamp.
 */
const agentArb: fc.Arbitrary<DiscoveryAgentView> = fc.record({
  agentId: fc.string({ minLength: 1, maxLength: 12 }),
  status: fc.constantFrom(...PUBLISH_STATES),
  visibility: fc.constantFrom("public" as const, "private" as const),
  agentType: fc.constantFrom(...AGENT_TYPES),
  campusTag: fc.option(fc.constantFrom(...CAMPUS_POOL), { nil: undefined }),
  publishedAt: fc.option(publishedAtArb, { nil: undefined }),
});

/**
 * A discovery query: an optional campus (drawn from the pool, plus an
 * unmatched sentinel), an optional Agent_Type, and an optional sort. Absent
 * fields impose no constraint on their dimension.
 */
const filterArb: fc.Arbitrary<DiscoveryFilter> = fc.record({
  campus: fc.option(fc.constantFrom(...CAMPUS_POOL, "no-such-campus"), {
    nil: undefined,
  }),
  agentType: fc.option(fc.constantFrom(...AGENT_TYPES), { nil: undefined }),
  sort: fc.option(fc.constantFrom("trending" as const, "new" as const), {
    nil: undefined,
  }),
});

/** Completed-call tallies used to rank a trending listing. */
const completionArb: fc.Arbitrary<CompletedCallCount> = fc.record({
  agentId: fc.string({ minLength: 1, maxLength: 12 }),
  completedAt: fc.integer({ min: NOW - 30 * MS_PER_DAY, max: NOW }),
});

const contextArb: fc.Arbitrary<DiscoveryContext> = fc.record({
  now: fc.constant(NOW),
  completions: fc.array(completionArb, { maxLength: 40 }),
});

const pageArb = fc.integer({ min: -2, max: 5 });
const pageSizeArb = fc.integer({ min: 1, max: 60 });

describe("Property 24: Discovery filter predicate holds for all results", () => {
  it("every listed agent satisfies the combined discovery filter predicate", () => {
    fc.assert(
      fc.property(
        fc.array(agentArb, { maxLength: 60 }),
        filterArb,
        contextArb,
        pageArb,
        pageSizeArb,
        (agents, filter, context, page, pageSize) => {
          const results = listAgents(agents, filter, context, page, pageSize);
          for (const agent of results) {
            expect(matchesDiscoveryFilter(agent, filter, context)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("every listed agent independently satisfies each active filter dimension", () => {
    fc.assert(
      fc.property(
        fc.array(agentArb, { maxLength: 60 }),
        filterArb,
        contextArb,
        (agents, filter, context) => {
          const results = listAgents(agents, filter, context);
          for (const agent of results) {
            // Listing invariant: only published + public agents (Req 10.3/10.5).
            expect(isDiscoverable(agent)).toBe(true);
            // Campus dimension (Req 10.4).
            expect(matchesCampus(agent, filter.campus)).toBe(true);
            // Agent_Type dimension (Req 10.4).
            expect(matchesType(agent, filter.agentType)).toBe(true);
            // `new` dimension: published within the trailing 30 days (Req 10.4).
            if (filter.sort === "new") {
              expect(isNewAgent(agent, context.now, NEW_WINDOW_DAYS)).toBe(true);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
