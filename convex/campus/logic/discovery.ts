/**
 * Feature: dinee-campus (Task 12.1)
 *
 * Pure, property-testable core for the Discovery_Service: the listing
 * invariant and the campus / agent-type / trending / new filter predicates
 * (Requirements 10.3, 10.4, 10.5, 11.5). These functions carry NO Convex `ctx`
 * and perform no I/O, so they can be exercised directly by unit and property
 * tests and imported by the Convex `discovery.ts` service that wraps them with
 * `campusAgents` / `campusAnalyticsDaily` reads.
 *
 * Covered behaviors:
 *   - 10.3: list only `published` + `public` Campus_Agents, presenting at most
 *     50 per page.
 *   - 10.4: filter by campus, Agent_Type, trending (most completed voice
 *     conversations in the trailing 7 days), and new (published within the
 *     trailing 30 days).
 *   - 10.5 / 11.5: exclude every private agent and every agent removed from
 *     public listing (and, by the same published-only invariant, any
 *     draft / publish_pending_link / link_failed / blocked / deleted agent).
 *
 * The listing invariant reuses {@link isDiscoverable} from the access module so
 * discovery and the profile/call-link access gate can never diverge on what
 * "published + public" means.
 */

import { isDiscoverable, type AgentCirculationView } from "./access";
import type { AgentType } from "./validation";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of Campus_Agents presented per discovery page (Req 10.3). */
export const MAX_AGENTS_PER_PAGE = 50;

/** Milliseconds in one day. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Trailing window, in days, over which completed voice conversations are
 * counted to rank trending Campus_Agents (Req 10.4).
 */
export const TRENDING_WINDOW_DAYS = 7;

/**
 * Trailing window, in days, within which a Campus_Agent must have been
 * published to qualify as new (Req 10.4).
 */
export const NEW_WINDOW_DAYS = 30;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The minimal view of a Campus_Agent the Discovery_Service needs to apply the
 * listing invariant and the filter predicates. Structurally satisfied by a full
 * `campusAgents` row, so a stored record can be passed directly. Extends
 * {@link AgentCirculationView} (`status` + `visibility`) so {@link isDiscoverable}
 * can be reused verbatim.
 */
export interface DiscoveryAgentView extends AgentCirculationView {
  agentId: string;
  agentType: AgentType;
  /** The Campus_Tag attached at publish; absent agents match no campus filter. */
  campusTag?: string;
  /** Publish timestamp (ms); drives the `new` predicate (Req 10.4). */
  publishedAt?: number;
}

/**
 * A completed-conversation tally for one agent over the trending window
 * (sourced from `campusAnalyticsDaily`). Used to rank trending agents (Req 10.4).
 */
export interface CompletedCallCount {
  agentId: string;
  /** Timestamp (ms) of a completed voice conversation. */
  completedAt: number;
}

/** The sort/ranking modes a discovery listing supports (Req 10.4). */
export type DiscoverySort = "trending" | "new";

/**
 * A discovery query: the optional campus / Agent_Type filters and an optional
 * trending/new sort. An absent filter field imposes no constraint on that
 * dimension (Req 10.4).
 */
export interface DiscoveryFilter {
  campus?: string;
  agentType?: AgentType;
  sort?: DiscoverySort;
}

// ---------------------------------------------------------------------------
// Listing invariant (Req 10.3, 10.5, 11.5)
// ---------------------------------------------------------------------------

/**
 * Retains only the Campus_Agents that belong in a discovery listing: an agent
 * must be in the `published` Publish_State AND have `public` visibility
 * (Req 10.3, 10.5, 11.5). Every private, removed, blocked, deleted, draft,
 * publish_pending_link, or link_failed agent is excluded. Pure and
 * non-mutating (a new array is returned). Reuses {@link isDiscoverable}.
 */
export function filterListable<T extends AgentCirculationView>(
  agents: readonly T[]
): T[] {
  return agents.filter((agent) => isDiscoverable(agent));
}

/**
 * Returns the page-sized slice of `items` for `page` (0-indexed), bounded so a
 * page never contains more than {@link MAX_AGENTS_PER_PAGE} entries (Req 10.3).
 * `pageSize` is clamped into `[1, MAX_AGENTS_PER_PAGE]` and a negative `page`
 * is treated as page 0. Pure and non-mutating.
 */
export function paginate<T>(
  items: readonly T[],
  page: number = 0,
  pageSize: number = MAX_AGENTS_PER_PAGE
): T[] {
  const boundedSize = Math.min(
    MAX_AGENTS_PER_PAGE,
    Math.max(1, Math.floor(pageSize))
  );
  const boundedPage = Math.max(0, Math.floor(page));
  const start = boundedPage * boundedSize;
  return items.slice(start, start + boundedSize);
}

// ---------------------------------------------------------------------------
// Filter predicates (Req 10.4)
// ---------------------------------------------------------------------------

/**
 * True iff `agent` matches the requested `campus` filter (Req 10.4). An
 * absent/empty `campus` filter matches every agent; otherwise the agent's
 * `campusTag` must equal the requested campus. An agent with no `campusTag`
 * never matches a non-empty campus filter. Pure.
 */
export function matchesCampus(
  agent: Pick<DiscoveryAgentView, "campusTag">,
  campus: string | null | undefined
): boolean {
  if (typeof campus !== "string" || campus.length === 0) {
    return true;
  }
  return agent.campusTag === campus;
}

/**
 * True iff `agent` matches the requested Agent_Type filter (Req 10.4). An
 * absent `agentType` filter matches every agent; otherwise the agent's
 * `agentType` must equal the requested type. Pure.
 */
export function matchesType(
  agent: Pick<DiscoveryAgentView, "agentType">,
  agentType: AgentType | null | undefined
): boolean {
  if (agentType == null) {
    return true;
  }
  return agent.agentType === agentType;
}

/**
 * True iff `agent` was published within the trailing {@link NEW_WINDOW_DAYS}
 * days ending at `now` — i.e., it qualifies as new (Req 10.4). An agent with no
 * `publishedAt` is never new. Pure.
 */
export function isNewAgent(
  agent: Pick<DiscoveryAgentView, "publishedAt">,
  now: number,
  windowDays: number = NEW_WINDOW_DAYS
): boolean {
  if (typeof agent.publishedAt !== "number") {
    return false;
  }
  const windowStart = now - windowDays * MS_PER_DAY;
  return agent.publishedAt >= windowStart && agent.publishedAt <= now;
}

/**
 * Counts the completed voice conversations for each agent within the trailing
 * `windowDays` ending at `now` (Req 10.4). Only completions inside the window
 * are tallied. Returns a map of `agentId → count`. Pure and non-mutating.
 */
export function countCompletedCallsInWindow(
  completions: readonly CompletedCallCount[],
  now: number,
  windowDays: number = TRENDING_WINDOW_DAYS
): Map<string, number> {
  const windowStart = now - windowDays * MS_PER_DAY;
  const counts = new Map<string, number>();
  for (const completion of completions) {
    if (completion.completedAt < windowStart || completion.completedAt > now) {
      continue;
    }
    counts.set(
      completion.agentId,
      (counts.get(completion.agentId) ?? 0) + 1
    );
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Combined filtering + ordering (Req 10.3, 10.4, 10.5, 11.5)
// ---------------------------------------------------------------------------

/** Context supplying the completed-call tallies needed for trending sort. */
export interface DiscoveryContext {
  now: number;
  /** Completed voice conversations used to rank trending agents (Req 10.4). */
  completions?: readonly CompletedCallCount[];
}

/**
 * True iff `agent` satisfies the listing invariant AND every active dimension
 * of `filter` (Req 10.3, 10.4, 10.5, 11.5). The `new` sort additionally
 * requires the agent to have been published within the trailing 30 days; the
 * `trending` sort imposes no membership constraint (it only orders results).
 * Pure.
 */
export function matchesDiscoveryFilter(
  agent: DiscoveryAgentView,
  filter: DiscoveryFilter,
  context: DiscoveryContext
): boolean {
  if (!isDiscoverable(agent)) {
    return false;
  }
  if (!matchesCampus(agent, filter.campus)) {
    return false;
  }
  if (!matchesType(agent, filter.agentType)) {
    return false;
  }
  if (filter.sort === "new" && !isNewAgent(agent, context.now)) {
    return false;
  }
  return true;
}

/**
 * Applies the full discovery query: filters `agents` to the listable set
 * matching `filter`, orders them (trending by descending completed-call count
 * in the trailing 7 days, new by descending `publishedAt`, otherwise by
 * descending `publishedAt` as a stable default), and returns the requested
 * page bounded to at most {@link MAX_AGENTS_PER_PAGE} entries (Req 10.3, 10.4,
 * 10.5, 11.5). Ties are broken by `agentId` for a deterministic ordering. Pure
 * and non-mutating.
 */
export function listAgents(
  agents: readonly DiscoveryAgentView[],
  filter: DiscoveryFilter,
  context: DiscoveryContext,
  page: number = 0,
  pageSize: number = MAX_AGENTS_PER_PAGE
): DiscoveryAgentView[] {
  const matched = agents.filter((agent) =>
    matchesDiscoveryFilter(agent, filter, context)
  );

  const trendingCounts =
    filter.sort === "trending"
      ? countCompletedCallsInWindow(context.completions ?? [], context.now)
      : undefined;

  const ordered = [...matched].sort((a, b) => {
    if (trendingCounts) {
      const diff =
        (trendingCounts.get(b.agentId) ?? 0) -
        (trendingCounts.get(a.agentId) ?? 0);
      if (diff !== 0) return diff;
    } else {
      const diff = (b.publishedAt ?? 0) - (a.publishedAt ?? 0);
      if (diff !== 0) return diff;
    }
    return a.agentId.localeCompare(b.agentId);
  });

  return paginate(ordered, page, pageSize);
}
