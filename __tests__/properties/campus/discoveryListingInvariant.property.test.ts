// Feature: dinee-campus, Property 23: Discovery listing invariant
/**
 * Feature: dinee-campus, Property 23: Discovery listing invariant
 *
 * Validates: Requirements 10.3, 10.5, 11.5, 7.9
 *
 * For any stored set of agents and any requested page, every listed agent
 * SHALL have status `published` AND visibility `public` — never private,
 * draft, publish_pending_link, link_failed, removed, blocked, or deleted — and
 * the page SHALL contain at most 50 agents (Req 10.3, 10.5, 11.5, 7.9).
 *
 * The pure core under test is {@link listAgents} (the full discovery pipeline:
 * listing invariant → filter → order → paginate) and its building blocks
 * {@link filterListable} and {@link paginate}. The invariant is observed
 * through {@link isDiscoverable}: a listed agent must be `published` + public.
 *
 * The generators span the ENTIRE Publish_State x Visibility space — including
 * agents that ARE currently in circulation (published + public), the excluded
 * `publish_pending_link` / `link_failed` states called out by this task, and
 * every other non-listable combination — across arbitrary filters, pages, and
 * page sizes, so the invariant is exercised even when a page would otherwise
 * be tempted to include a non-published or private agent.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  listAgents,
  filterListable,
  paginate,
  MAX_AGENTS_PER_PAGE,
  type DiscoveryAgentView,
  type DiscoveryFilter,
  type DiscoveryContext,
} from "../../../convex/campus/logic/discovery";
import {
  isDiscoverable,
  type PublishState,
  type Visibility,
  type AgentType,
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

const ALL_AGENT_TYPES: AgentType[] = [
  "ai_twin",
  "study_agent",
  "club_agent",
  "campus_guide",
  "funny_character",
  "tutor_agent",
  "advice_agent",
];

// A fixed "now" so publishedAt windows are deterministic.
const NOW = 1_700_000_000_000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Arbitrary spanning any discovery view of an agent: every Publish_State
 * (including `published`, `publish_pending_link`, and `link_failed`) crossed
 * with both visibilities, an arbitrary campus tag / agent type, and a
 * publishedAt drawn from a wide range (well before, within, and after the 30d
 * "new" window relative to NOW).
 */
const agentArb: fc.Arbitrary<DiscoveryAgentView> = fc.record({
  agentId: fc.uuid(),
  agentType: fc.constantFrom(...ALL_AGENT_TYPES),
  status: fc.constantFrom(...ALL_STATES),
  visibility: fc.constantFrom(...ALL_VISIBILITIES),
  campusTag: fc.option(
    fc.constantFrom("berkeley", "mit", "stanford", "howard"),
    { nil: undefined }
  ),
  publishedAt: fc.option(
    fc.integer({ min: NOW - 90 * MS_PER_DAY, max: NOW + MS_PER_DAY }),
    { nil: undefined }
  ),
});

// Enough agents to overflow multiple pages of 50 so the size bound is exercised.
const agentsArb = fc.array(agentArb, { minLength: 0, maxLength: 130 });

const filterArb: fc.Arbitrary<DiscoveryFilter> = fc.record({
  campus: fc.option(fc.constantFrom("berkeley", "mit", "stanford", "howard"), {
    nil: undefined,
  }),
  agentType: fc.option(fc.constantFrom(...ALL_AGENT_TYPES), { nil: undefined }),
  sort: fc.option(fc.constantFrom<"trending" | "new">("trending", "new"), {
    nil: undefined,
  }),
});

const contextArb: fc.Arbitrary<DiscoveryContext> = fc.record({
  now: fc.constant(NOW),
  completions: fc.array(
    fc.record({
      agentId: fc.uuid(),
      completedAt: fc.integer({
        min: NOW - 30 * MS_PER_DAY,
        max: NOW,
      }),
    }),
    { maxLength: 40 }
  ),
});

// Page indices include negatives (treated as page 0) and out-of-range pages.
const pageArb = fc.integer({ min: -3, max: 10 });
// Page sizes include out-of-range values that must be clamped into [1, 50].
const pageSizeArb = fc.integer({ min: -10, max: 200 });

describe("Property 23: Discovery listing invariant", () => {
  it("every listed agent is published + public and the page holds at most 50 (Req 10.3, 10.5, 11.5, 7.9)", () => {
    fc.assert(
      fc.property(
        agentsArb,
        filterArb,
        contextArb,
        pageArb,
        pageSizeArb,
        (agents, filter, context, page, pageSize) => {
          const listed = listAgents(agents, filter, context, page, pageSize);

          // Size bound: never more than 50 per page (Req 10.3).
          expect(listed.length).toBeLessThanOrEqual(MAX_AGENTS_PER_PAGE);

          for (const agent of listed) {
            // published + public — nothing else may ever be listed
            // (Req 10.5, 11.5, 7.9).
            expect(agent.status).toBe("published");
            expect(agent.visibility).toBe("public");
            expect(isDiscoverable(agent)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("none of the excluded states ever appears in a listing, regardless of filter or page", () => {
    const EXCLUDED_STATES: PublishState[] = [
      "draft",
      "publish_pending_link",
      "link_failed",
      "removed",
      "blocked",
      "deleted",
    ];
    fc.assert(
      fc.property(
        agentsArb,
        filterArb,
        contextArb,
        pageArb,
        pageSizeArb,
        (agents, filter, context, page, pageSize) => {
          const listed = listAgents(agents, filter, context, page, pageSize);
          for (const agent of listed) {
            expect(EXCLUDED_STATES).not.toContain(agent.status);
            // A published-but-private agent must also never be listed.
            expect(agent.visibility).not.toBe("private");
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("filterListable retains exactly the discoverable agents and drops all others", () => {
    fc.assert(
      fc.property(agentsArb, (agents) => {
        const listable = filterListable(agents);
        const expected = agents.filter((a) => isDiscoverable(a));

        // Same membership as isDiscoverable, and every survivor is published+public.
        expect(listable.length).toBe(expected.length);
        for (const agent of listable) {
          expect(isDiscoverable(agent)).toBe(true);
        }
        // Non-mutating: a new array is returned.
        expect(listable).not.toBe(agents);
      }),
      { numRuns: 100 }
    );
  });

  it("paginate never returns more than 50 entries for any page/size", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer(), { maxLength: 300 }),
        pageArb,
        pageSizeArb,
        (items, page, pageSize) => {
          const pageSlice = paginate(items, page, pageSize);
          expect(pageSlice.length).toBeLessThanOrEqual(MAX_AGENTS_PER_PAGE);
        }
      ),
      { numRuns: 100 }
    );
  });
});
