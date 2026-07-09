/**
 * Feature: dinee-campus (Task 21.1)
 *
 * Discovery_Service — the Convex query layer that wraps the pure, I/O-free
 * discovery/leaderboard core (`convex/campus/logic/discovery.ts` and
 * `convex/campus/logic/leaderboard.ts`) with `campusAgents` /
 * `campusAnalyticsDaily` reads.
 *
 * Exposes two public queries (Callers browse discovery without authentication):
 *   - `listAgents`: lists published + public Campus_Agents only, at most 50 per
 *     page, filterable by campus, Agent_Type, trending, and new. Trending is
 *     ranked by completed voice conversations in the trailing 7 days (sourced
 *     from `campusAnalyticsDaily`); new is `publishedAt` within the trailing 30
 *     days. Returns an empty-state indication when the filter matches no agent
 *     (Req 10.3, 10.4, 10.5, 10.6, 10.7).
 *   - `getCampusLeaderboard`: a per-campus ranking of published + public agents
 *     by completed voice conversations in the trailing 7 days (descending),
 *     bounded to the top 20, excluding every private / removed / blocked /
 *     deleted / non-published agent, with an empty-state indication when no
 *     qualifying agent has a completed conversation in the window (Req 15.10,
 *     15.11).
 *
 * All ranking, filtering, and bounding decisions live in the pure core so the
 * Convex layer only reads rows, adapts them to the core's view types, and
 * projects the results into publicly displayable listing cards. Excluded
 * (private / removed / blocked / deleted / draft / pending) agents never reach
 * the listing because the pure core reuses the same `isDiscoverable` invariant
 * as the profile/call-link access gate (Req 10.5, 10.8, 11.5, 15.10).
 */

import { query } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { v } from "convex/values";

import {
  deriveVisualIdentity,
  DESCRIPTION_MAX,
  type VisualIdentity,
} from "./logic/access";
import {
  listAgents as listAgentsCore,
  matchesDiscoveryFilter,
  MAX_AGENTS_PER_PAGE,
  TRENDING_WINDOW_DAYS,
  type CompletedCallCount,
  type DiscoveryAgentView,
  type DiscoveryFilter,
} from "./logic/discovery";
import { rankCampusLeaderboard } from "./logic/leaderboard";
import type { AgentType } from "./logic/validation";

// ---------------------------------------------------------------------------
// Local constants / helpers
// ---------------------------------------------------------------------------

/** Milliseconds in one day. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Convex validator for the seven Agent_Types, matching `campusAgents.agentType`
 * (Req 2.3). Kept in step with `AGENT_TYPES` in `logic/validation.ts`.
 */
const agentTypeValidator = v.union(
  v.literal("ai_twin"),
  v.literal("study_agent"),
  v.literal("club_agent"),
  v.literal("campus_guide"),
  v.literal("funny_character"),
  v.literal("tutor_agent"),
  v.literal("advice_agent")
);

/** Formats a millisecond timestamp as a UTC `YYYY-MM-DD` day key. */
function toUtcDay(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/** Parses a `YYYY-MM-DD` (UTC) day key into its midnight-UTC timestamp (ms). */
function dayToTimestamp(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`);
}

// ---------------------------------------------------------------------------
// Row → core-view / listing-card adapters
// ---------------------------------------------------------------------------

/** The publicly displayable listing card the Discovery_Service returns. */
interface DiscoveryCard {
  agentId: string;
  slug: string;
  name: string;
  agentType: AgentType;
  campusTag: string;
  description: string;
  visualIdentity: VisualIdentity;
  publishedAt: number | null;
  remixEnabled: boolean;
}

/**
 * Adapts a stored `campusAgents` row to the minimal {@link DiscoveryAgentView}
 * the pure discovery/leaderboard core consumes.
 */
function toDiscoveryView(row: Doc<"campusAgents">): DiscoveryAgentView {
  return {
    agentId: row.agentId,
    agentType: row.agentType,
    campusTag: row.campusTag,
    publishedAt: row.publishedAt,
    status: row.status,
    visibility: row.visibility,
  };
}

/**
 * Projects a stored `campusAgents` row to a publicly displayable listing card,
 * bounding the description to {@link DESCRIPTION_MAX} characters and deriving
 * the same deterministic visual identity as the public profile (Req 6.1).
 */
function toDiscoveryCard(row: Doc<"campusAgents">): DiscoveryCard {
  return {
    agentId: row.agentId,
    slug: row.slug,
    name: row.name,
    agentType: row.agentType,
    campusTag: row.campusTag ?? "",
    description: row.description.slice(0, DESCRIPTION_MAX),
    visualIdentity: deriveVisualIdentity(row),
    publishedAt: row.publishedAt ?? null,
    remixEnabled: row.remixEnabled === true,
  };
}

/**
 * Builds the completed-voice-conversation timeline for the given agents over
 * the trailing `windowDays` window ending at `now`, sourced from the
 * `campusAnalyticsDaily` rollup (Req 10.4, 15.10). Each day's `callCount` is
 * expanded into that many {@link CompletedCallCount} entries timestamped at the
 * day's midnight UTC so the pure core's window filter and count-based ranking
 * see the true completed-conversation magnitude. Only rollup rows inside the
 * window's day range are read; the core applies the precise millisecond cutoff.
 */
async function buildCompletions(
  ctx: QueryCtx,
  agentIds: readonly string[],
  now: number,
  windowDays: number
): Promise<CompletedCallCount[]> {
  const startDay = toUtcDay(now - windowDays * MS_PER_DAY);
  const endDay = toUtcDay(now);
  const completions: CompletedCallCount[] = [];

  for (const agentId of agentIds) {
    const rows = await ctx.db
      .query("campusAnalyticsDaily")
      .withIndex("by_agent_and_day", (q) =>
        q.eq("agentId", agentId).gte("day", startDay).lte("day", endDay)
      )
      .collect();

    for (const row of rows) {
      const completedAt = dayToTimestamp(row.day);
      for (let i = 0; i < row.callCount; i++) {
        completions.push({ agentId, completedAt });
      }
    }
  }

  return completions;
}

// ---------------------------------------------------------------------------
// listAgents (Req 10.3, 10.4, 10.5, 10.6, 10.7)
// ---------------------------------------------------------------------------

/**
 * Lists published + public Campus_Agents, at most 50 per page, filterable by
 * campus, Agent_Type, and a trending/new sort (Req 10.3, 10.4, 10.5). Returns
 * an `isEmpty` empty-state flag when the filter matches no agent (Req 10.6).
 */
export const listAgents = query({
  args: {
    campus: v.optional(v.string()),
    agentType: v.optional(agentTypeValidator),
    sort: v.optional(v.union(v.literal("trending"), v.literal("new"))),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const page = Math.max(0, Math.floor(args.page ?? 0));
    const pageSize = Math.min(
      MAX_AGENTS_PER_PAGE,
      Math.max(1, Math.floor(args.pageSize ?? MAX_AGENTS_PER_PAGE))
    );

    // Only published + public agents can ever appear; the pure core re-applies
    // this invariant, but scoping the read keeps private/removed/etc. rows out
    // of memory entirely (Req 10.3, 10.5).
    const rows = await ctx.db
      .query("campusAgents")
      .withIndex("by_status_visibility", (q) =>
        q.eq("status", "published").eq("visibility", "public")
      )
      .collect();

    const rowById = new Map<string, Doc<"campusAgents">>();
    const views: DiscoveryAgentView[] = [];
    for (const row of rows) {
      rowById.set(row.agentId, row);
      views.push(toDiscoveryView(row));
    }

    const filter: DiscoveryFilter = {
      campus: args.campus,
      agentType: args.agentType,
      sort: args.sort,
    };

    // Completed-conversation counts are only needed to rank the trending sort.
    const completions =
      args.sort === "trending"
        ? await buildCompletions(
            ctx,
            views.map((view) => view.agentId),
            now,
            TRENDING_WINDOW_DAYS
          )
        : [];

    const context = { now, completions };

    // Empty-state (Req 10.6) is based on the total set of matching agents, not
    // just an out-of-range page slice.
    const totalMatched = views.filter((view) =>
      matchesDiscoveryFilter(view, filter, context)
    ).length;

    const pageViews = listAgentsCore(views, filter, context, page, pageSize);
    const agents = pageViews.map((view) => toDiscoveryCard(rowById.get(view.agentId)!));

    return {
      agents,
      isEmpty: totalMatched === 0,
      page,
      pageSize,
    };
  },
});

// ---------------------------------------------------------------------------
// getCampusLeaderboard (Req 15.10, 15.11)
// ---------------------------------------------------------------------------

/**
 * Returns a per-campus Campus_Leaderboard: published + public agents of the
 * campus ranked by completed voice conversations in the trailing 7 days
 * (descending), bounded to the top 20, excluding every private / removed /
 * blocked / deleted / non-published agent (Req 15.10). `isEmpty` is `true` when
 * no qualifying agent has a completed conversation in the window (Req 15.11).
 */
export const getCampusLeaderboard = query({
  args: {
    campus: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Scope the read to the requested campus; the pure ranking re-applies the
    // published + public + matching-campus invariant (Req 15.10).
    const rows = await ctx.db
      .query("campusAgents")
      .withIndex("by_campus_tag", (q) => q.eq("campusTag", args.campus))
      .collect();

    const rowById = new Map<string, Doc<"campusAgents">>();
    const views: DiscoveryAgentView[] = [];
    for (const row of rows) {
      rowById.set(row.agentId, row);
      views.push(toDiscoveryView(row));
    }

    const completions = await buildCompletions(
      ctx,
      views.map((view) => view.agentId),
      now,
      TRENDING_WINDOW_DAYS
    );

    const result = rankCampusLeaderboard(views, completions, args.campus, now);

    const entries = result.entries.map((entry) => ({
      agent: toDiscoveryCard(rowById.get(entry.agent.agentId)!),
      completedCalls: entry.completedCalls,
    }));

    return {
      entries,
      isEmpty: result.isEmpty,
    };
  },
});
