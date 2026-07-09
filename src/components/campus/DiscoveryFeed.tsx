"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { campusCopy } from "@/lib/campus/copy";

/**
 * Feature: dinee-campus (Task 31.1) — `DiscoveryFeed`.
 *
 * The student-facing discovery surface at `/campus/discover`. It has two views
 * a Caller can switch between:
 *
 *   - Discover — a paginated listing (≤50 per page) of public + published
 *     Campus_Agents, filterable by campus, Agent_Type, and a trending/new sort,
 *     sourced from the access-gated `campus.discovery.listAgents` query. When a
 *     filter matches no agent it shows an empty-state (Req 10.3, 10.4, 10.6).
 *     Selecting an agent links to its Agent_Profile_Page (`/campus/a/[slug]`),
 *     which the App Router opens well within 3 seconds (Req 10.7); if that agent
 *     became private or was removed after the listing rendered, the profile page
 *     itself resolves the current access state and shows the unavailable
 *     indication rather than the profile (Req 10.8).
 *
 *   - Leaderboard — the per-campus Campus_Leaderboard: the top 20 public +
 *     published agents of a campus ranked by completed voice conversations in
 *     the trailing 7 days, sourced from `campus.discovery.getCampusLeaderboard`,
 *     with its own empty-state when no qualifying agent has a completed
 *     conversation in the window (Req 15.10, 15.11). The leaderboard is scoped
 *     to a single campus, so it uses the campus filter value and prompts for one
 *     when empty.
 *
 * Mobile-first: the outer container hides horizontal overflow and content is
 * width-constrained with fluid padding so the page renders without horizontal
 * scrolling at a 360px viewport, and every interactive control meets the 44×44
 * CSS-pixel minimum touch-target size (Req 14.1, 14.2).
 */

/** The seven Agent_Types + their student-facing labels, from the shared copy. */
const AGENT_TYPE_OPTIONS = campusCopy.onboarding.options;

/** Maps an Agent_Type to its student-facing label from the shared copy corpus. */
const AGENT_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  AGENT_TYPE_OPTIONS.map((o) => [o.agentType, o.label])
);

type AgentType = (typeof AGENT_TYPE_OPTIONS)[number]["agentType"];
type SortOption = "trending" | "new";
type ViewTab = "discover" | "leaderboard";

/** The listing card shape returned by the Discovery_Service queries. */
interface DiscoveryCard {
  readonly agentId: string;
  readonly slug: string;
  readonly name: string;
  readonly agentType: string;
  readonly campusTag: string;
  readonly description: string;
  readonly visualIdentity: { readonly initial: string; readonly colorSeed: string };
  readonly publishedAt: number | null;
  readonly remixEnabled: boolean;
}

/** A deterministic avatar background derived from the agent's color seed. */
function avatarStyle(colorSeed: string): React.CSSProperties {
  let hash = 0;
  for (let i = 0; i < colorSeed.length; i++) {
    hash = (hash * 31 + colorSeed.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  return {
    background: `linear-gradient(135deg, hsl(${hue} 70% 45%), hsl(${
      (hue + 40) % 360
    } 70% 35%))`,
  };
}

export function DiscoveryFeed() {
  const [tab, setTab] = useState<ViewTab>("discover");
  const [campus, setCampus] = useState("");
  const [agentType, setAgentType] = useState<AgentType | "">("");
  const [sort, setSort] = useState<SortOption | "">("");
  const [page, setPage] = useState(0);

  const trimmedCampus = campus.trim();

  return (
    <DiscoveryShell>
      {/* View switcher */}
      <div
        className="mt-2 grid grid-cols-2 gap-2 rounded-xl border border-white/10 bg-white/5 p-1"
        role="tablist"
        aria-label="Discovery views"
      >
        <TabButton
          active={tab === "discover"}
          onClick={() => setTab("discover")}
          testId="discover-tab-discover"
        >
          Discover
        </TabButton>
        <TabButton
          active={tab === "leaderboard"}
          onClick={() => setTab("leaderboard")}
          testId="discover-tab-leaderboard"
        >
          Leaderboard
        </TabButton>
      </div>

      {tab === "discover" ? (
        <DiscoverView
          campus={trimmedCampus}
          campusInput={campus}
          onCampusChange={(value) => {
            setCampus(value);
            setPage(0);
          }}
          agentType={agentType}
          onAgentTypeChange={(value) => {
            setAgentType(value);
            setPage(0);
          }}
          sort={sort}
          onSortChange={(value) => {
            setSort(value);
            setPage(0);
          }}
          page={page}
          onPageChange={setPage}
        />
      ) : (
        <LeaderboardView
          campus={trimmedCampus}
          campusInput={campus}
          onCampusChange={setCampus}
        />
      )}
    </DiscoveryShell>
  );
}

// ---------------------------------------------------------------------------
// Discover view (Req 10.3, 10.4, 10.6, 10.7, 10.8)
// ---------------------------------------------------------------------------

interface DiscoverViewProps {
  readonly campus: string;
  readonly campusInput: string;
  readonly onCampusChange: (value: string) => void;
  readonly agentType: AgentType | "";
  readonly onAgentTypeChange: (value: AgentType | "") => void;
  readonly sort: SortOption | "";
  readonly onSortChange: (value: SortOption | "") => void;
  readonly page: number;
  readonly onPageChange: (page: number) => void;
}

function DiscoverView({
  campus,
  campusInput,
  onCampusChange,
  agentType,
  onAgentTypeChange,
  sort,
  onSortChange,
  page,
  onPageChange,
}: DiscoverViewProps) {
  const result = useQuery(api.campus.discovery.listAgents, {
    campus: campus.length > 0 ? campus : undefined,
    agentType: agentType !== "" ? agentType : undefined,
    sort: sort !== "" ? sort : undefined,
    page,
  });

  const agents = (result?.agents ?? []) as DiscoveryCard[];
  const pageSize = result?.pageSize ?? 0;
  // With no server-side total, a full page is the signal that more may exist.
  const hasNext = result !== undefined && agents.length === pageSize && pageSize > 0;
  const hasPrev = page > 0;

  return (
    <div>
      {/* Filters (Req 10.4) */}
      <div className="mt-4 space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-white/60">
            Campus or school
          </span>
          <input
            type="text"
            value={campusInput}
            onChange={(e) => onCampusChange(e.target.value)}
            placeholder="Filter by campus"
            className="input min-h-[44px] w-full"
            data-testid="discover-filter-campus"
          />
        </label>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-white/60">
              Type
            </span>
            <select
              value={agentType}
              onChange={(e) => onAgentTypeChange(e.target.value as AgentType | "")}
              className="input min-h-[44px] w-full"
              data-testid="discover-filter-type"
            >
              <option value="">All types</option>
              {AGENT_TYPE_OPTIONS.map((o) => (
                <option key={o.agentType} value={o.agentType}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-white/60">
              Sort
            </span>
            <select
              value={sort}
              onChange={(e) => onSortChange(e.target.value as SortOption | "")}
              className="input min-h-[44px] w-full"
              data-testid="discover-filter-sort"
            >
              <option value="">Featured</option>
              <option value="trending">Trending</option>
              <option value="new">New</option>
            </select>
          </label>
        </div>
      </div>

      {/* Results */}
      <div className="mt-6">
        {result === undefined ? (
          <LoadingRow label="Finding agents…" />
        ) : result.isEmpty ? (
          <EmptyState
            testId="discover-empty"
            title="No agents match those filters"
            body="Try a different campus, type, or sort — or clear the filters to see everything."
          />
        ) : (
          <ul className="space-y-3" data-testid="discover-results">
            {agents.map((agent) => (
              <li key={agent.agentId}>
                <AgentCard agent={agent} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Pagination (≤50/page, Req 10.3) */}
      {result !== undefined && !result.isEmpty && (hasPrev || hasNext) && (
        <div className="mt-6 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => onPageChange(Math.max(0, page - 1))}
            disabled={!hasPrev}
            className="btn btn-outline btn-md min-h-[44px] disabled:opacity-40"
            data-testid="discover-prev"
          >
            ← Previous
          </button>
          <span className="text-xs text-white/50" data-testid="discover-page">
            Page {page + 1}
          </span>
          <button
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={!hasNext}
            className="btn btn-outline btn-md min-h-[44px] disabled:opacity-40"
            data-testid="discover-next"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Leaderboard view (Req 15.10, 15.11)
// ---------------------------------------------------------------------------

interface LeaderboardViewProps {
  readonly campus: string;
  readonly campusInput: string;
  readonly onCampusChange: (value: string) => void;
}

function LeaderboardView({
  campus,
  campusInput,
  onCampusChange,
}: LeaderboardViewProps) {
  // The leaderboard is per-campus; skip the query until a campus is chosen.
  const result = useQuery(
    api.campus.discovery.getCampusLeaderboard,
    campus.length > 0 ? { campus } : "skip"
  );

  const entries = result?.entries ?? [];

  return (
    <div>
      <label className="mt-4 block">
        <span className="mb-1 block text-xs font-medium text-white/60">
          Campus or school
        </span>
        <input
          type="text"
          value={campusInput}
          onChange={(e) => onCampusChange(e.target.value)}
          placeholder="Enter a campus to see its leaderboard"
          className="input min-h-[44px] w-full"
          data-testid="leaderboard-campus"
        />
      </label>

      <p className="mt-3 text-xs text-white/50">
        Top 20 agents on this campus by completed calls in the last 7 days.
      </p>

      <div className="mt-6">
        {campus.length === 0 ? (
          <EmptyState
            testId="leaderboard-prompt"
            title="Pick a campus"
            body="Enter a campus or school above to see who's topping the leaderboard this week."
          />
        ) : result === undefined ? (
          <LoadingRow label="Building the leaderboard…" />
        ) : result.isEmpty ? (
          <EmptyState
            testId="leaderboard-empty"
            title="No leaderboard yet"
            body="No agents on this campus have completed a call in the last 7 days. Be the first."
          />
        ) : (
          <ol className="space-y-3" data-testid="leaderboard-results">
            {entries.map((entry, index) => (
              <li key={entry.agent.agentId}>
                <AgentCard
                  agent={entry.agent as DiscoveryCard}
                  rank={index + 1}
                  completedCalls={entry.completedCalls}
                />
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared presentational pieces
// ---------------------------------------------------------------------------

interface AgentCardProps {
  readonly agent: DiscoveryCard;
  readonly rank?: number;
  readonly completedCalls?: number;
}

/**
 * A single selectable agent listing. Selecting it links to the
 * Agent_Profile_Page (`/campus/a/[slug]`), which the App Router opens well
 * within 3 seconds (Req 10.7) and which resolves the agent's current access
 * state — showing the unavailable indication if it became private/removed after
 * the listing rendered (Req 10.8).
 */
function AgentCard({ agent, rank, completedCalls }: AgentCardProps) {
  const typeLabel = AGENT_TYPE_LABELS[agent.agentType] ?? agent.agentType;

  return (
    <Link
      href={`/campus/a/${encodeURIComponent(agent.slug)}`}
      className="card card-content flex min-h-[44px] items-center gap-3 transition-colors hover:border-[var(--color-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
      data-testid="discover-card"
    >
      {typeof rank === "number" && (
        <span
          className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-white/10 text-sm font-bold tabular-nums text-white/80"
          aria-label={`Rank ${rank}`}
        >
          {rank}
        </span>
      )}

      <span
        className="flex h-12 w-12 flex-none items-center justify-center rounded-full text-lg font-bold text-white shadow-md"
        style={avatarStyle(agent.visualIdentity.colorSeed)}
        aria-hidden="true"
      >
        {agent.visualIdentity.initial}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-semibold text-white">{agent.name}</span>
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          {agent.campusTag && (
            <span className="badge badge-primary">{agent.campusTag}</span>
          )}
          <span className="badge badge-neutral">{typeLabel}</span>
          {typeof completedCalls === "number" && (
            <span className="badge badge-accent tabular-nums">
              {completedCalls} {completedCalls === 1 ? "call" : "calls"}
            </span>
          )}
        </span>
        {agent.description && (
          <span className="mt-2 line-clamp-2 block text-sm text-white/70">
            {agent.description}
          </span>
        )}
      </span>

      <span className="flex-none text-white/40" aria-hidden="true">
        →
      </span>
    </Link>
  );
}

function TabButton({
  active,
  onClick,
  children,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      data-testid={testId}
      className={`min-h-[44px] rounded-lg px-4 text-sm font-medium transition-colors ${
        active
          ? "bg-[var(--color-primary)] text-white"
          : "text-white/70 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function LoadingRow({ label }: { label: string }) {
  return (
    <div className="mt-8 flex items-center justify-center gap-3 text-white/70">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

function EmptyState({
  title,
  body,
  testId,
}: {
  title: string;
  body: string;
  testId: string;
}) {
  return (
    <div className="mt-8 rounded-xl border border-white/10 bg-white/5 px-5 py-10 text-center" data-testid={testId}>
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-white/60">{body}</p>
    </div>
  );
}

/** Page chrome shared across the discovery views. */
function DiscoveryShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative min-h-screen w-full overflow-x-hidden bg-black text-white">
      <div className="mx-auto w-full max-w-xl px-5 py-8 sm:px-6">
        <header className="mb-4 flex items-center justify-between gap-3">
          <Link
            href="/campus"
            className="btn btn-ghost btn-sm min-h-[44px] min-w-[44px]"
            aria-label="Back to Dinee Campus"
          >
            ← Back
          </Link>
          <span className="badge badge-accent">Dinee Campus</span>
        </header>
        <h1 className="text-2xl font-bold sm:text-3xl">Discover agents</h1>
        <p className="mt-1 text-sm text-white/60">
          Browse AI voice agents built by students across campus.
        </p>
        {children}
      </div>
    </main>
  );
}

export default DiscoveryFeed;
