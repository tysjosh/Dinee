/**
 * Feature: dinee-campus (Task 37.1)
 *
 * Pure, property-testable core for the Campus_Leaderboard ranking
 * (Requirements 15.10, 15.11). These functions carry NO Convex `ctx` and
 * perform no I/O, so they can be exercised directly by unit and property tests
 * and imported by the Convex `discovery.ts` service that wraps them with
 * `campusAgents` / `campusAnalyticsDaily` reads (`getCampusLeaderboard`).
 *
 * Covered behaviors:
 *   - 15.10: a per-campus ranking of public, published Campus_Agents by the
 *     number of completed voice conversations within the trailing 7-day period,
 *     in non-increasing (descending) order, presenting at most the top 20 and
 *     excluding any private agent and any agent in the removed, blocked, or
 *     deleted Publish_State (and, by the same published+public invariant, any
 *     draft / publish_pending_link / link_failed agent).
 *   - 15.11: an empty-state indication when no qualifying (public, published,
 *     matching-campus) agent has a completed voice conversation within the
 *     trailing 7-day window.
 *
 * The leaderboard reuses {@link isDiscoverable} (the shared published+public
 * invariant), {@link matchesCampus} (the per-campus filter), and
 * {@link countCompletedCallsInWindow} + {@link TRENDING_WINDOW_DAYS} (the same
 * trailing-7-day completed-conversation tally that powers the `trending` sort)
 * so the leaderboard and discovery can never diverge on what "public,
 * published" or "completed in the trailing 7 days" means.
 */

import { isDiscoverable } from "./access";
import {
  countCompletedCallsInWindow,
  matchesCampus,
  TRENDING_WINDOW_DAYS,
  type CompletedCallCount,
  type DiscoveryAgentView,
} from "./discovery";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum number of Campus_Agents presented on a Campus_Leaderboard — the top
 * count the ranking is bounded to (Req 15.10).
 */
export const MAX_LEADERBOARD_ENTRIES = 20;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single ranked Campus_Leaderboard entry: the qualifying agent together with
 * its completed-voice-conversation count over the trailing 7-day window
 * (Req 15.10).
 */
export interface LeaderboardEntry {
  agent: DiscoveryAgentView;
  /** Completed voice conversations for this agent within the trailing window. */
  completedCalls: number;
}

/**
 * The result of a Campus_Leaderboard request (Req 15.10, 15.11). `entries` is
 * the ranked, bounded top list; `isEmpty` is `true` exactly when no qualifying
 * agent has a completed voice conversation in the window (Req 15.11), in which
 * case `entries` is empty.
 */
export interface LeaderboardResult {
  entries: LeaderboardEntry[];
  isEmpty: boolean;
}

// ---------------------------------------------------------------------------
// Campus_Leaderboard ranking (Req 15.10, 15.11)
// ---------------------------------------------------------------------------

/**
 * Ranks the public, published Campus_Agents of a campus by completed voice
 * conversations within the trailing 7-day window (Req 15.10, 15.11).
 *
 * The ranking:
 *   1. retains only agents that are `published` AND `public`
 *      (via {@link isDiscoverable}) AND match `campus`
 *      (via {@link matchesCampus}), thereby excluding every private, removed,
 *      blocked, deleted, draft, publish_pending_link, or link_failed agent and
 *      every agent belonging to another campus (Req 15.10);
 *   2. tallies each surviving agent's completed voice conversations inside the
 *      trailing {@link TRENDING_WINDOW_DAYS}-day window ending at `now`
 *      (via {@link countCompletedCallsInWindow}) (Req 15.10);
 *   3. drops any agent with zero completions in the window — only agents with a
 *      completed conversation appear (Req 15.10, 15.11);
 *   4. orders the remainder by completed-call count in non-increasing order,
 *      breaking ties by `agentId` for a deterministic ordering (Req 15.10);
 *   5. bounds the result to the top {@link MAX_LEADERBOARD_ENTRIES}
 *      (Req 15.10).
 *
 * When the resulting list is empty — no qualifying agent had a completed voice
 * conversation in the window — `isEmpty` is `true` (Req 15.11).
 *
 * Pure and non-mutating (a new array is returned; inputs are not modified).
 */
export function rankCampusLeaderboard(
  agents: readonly DiscoveryAgentView[],
  completions: readonly CompletedCallCount[],
  campus: string,
  now: number,
  windowDays: number = TRENDING_WINDOW_DAYS
): LeaderboardResult {
  // Tally completed voice conversations for every agent inside the trailing
  // window once (Req 15.10); reused across all qualifying agents.
  const counts = countCompletedCallsInWindow(completions, now, windowDays);

  const qualifying = agents.filter(
    (agent) => isDiscoverable(agent) && matchesCampus(agent, campus)
  );

  const entries: LeaderboardEntry[] = [];
  for (const agent of qualifying) {
    const completedCalls = counts.get(agent.agentId) ?? 0;
    // Only agents with a completed voice conversation in the window rank
    // (Req 15.10, 15.11).
    if (completedCalls > 0) {
      entries.push({ agent, completedCalls });
    }
  }

  entries.sort((a, b) => {
    const diff = b.completedCalls - a.completedCalls;
    if (diff !== 0) return diff;
    return a.agent.agentId.localeCompare(b.agent.agentId);
  });

  const bounded = entries.slice(0, MAX_LEADERBOARD_ENTRIES);

  return { entries: bounded, isEmpty: bounded.length === 0 };
}
