"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { NearLimitBanner } from "@/components/campus/NearLimitBanner";

/**
 * Feature: dinee-campus (Task 33.1) — `AnalyticsDashboard`.
 *
 * The owner-gated Usage_Dashboard at `/campus/dashboard` (Req 9.1–9.8, 14.1).
 * It reads the target Campus_Agent id from the `?agentId=` query string and
 * renders the owner-only analytics for a selected reporting period, sourced
 * from `campus.analytics.getAgentAnalytics`.
 *
 * Sections:
 *   - Metric cards — total calls, unique callers, shares, saves/remixes, average
 *     call duration (seconds), and average rating on a 1–5 scale rounded to one
 *     decimal (Req 9.1).
 *   - Top questions — the top 10 most-asked questions ranked by descending
 *     frequency, and the 20 most-recent call summaries (Req 9.2).
 *   - Type-specific panels — for a study_agent, the top confusing topics /
 *     requested explanations and the quiz-completion count (Req 9.3); for a
 *     club_agent, the event-interest, join-intent, and contact-click counts
 *     (Req 9.4).
 *   - Monetization — the conversion-click count for a configured monetization
 *     link (Req 9.5).
 *   - Period selector — 7 / 30 / 90 days, defaulting to the most recent 30 days
 *     when none is chosen; the Convex query recomputes for the selected window
 *     (Req 9.8).
 *
 * Access is owner-gated (Req 9.6): the query returns `{ authorized: false }`
 * for anonymous requesters, non-owners, or an unknown agent, in which case an
 * unauthorized error indication is shown and no metrics are disclosed. When the
 * owned agent has no recorded activity, an empty-state is shown (Req 9.7).
 *
 * Mobile-first: the shell hides horizontal overflow and is width-constrained so
 * the page renders without horizontal scrolling at a 360px viewport, and every
 * interactive control meets the 44×44 CSS-pixel minimum touch-target size
 * (Req 14.1, 14.2).
 *
 * Note (known gap): there is no "list my agents" Convex query yet, so this
 * surface takes the agent id from the query string rather than showing an agent
 * picker. When no `agentId` is supplied it prompts for one.
 */

/** One reporting-period option (Req 9.8). */
interface PeriodOption {
  readonly key: string;
  readonly label: string;
  readonly days: number;
}

const PERIOD_OPTIONS: readonly PeriodOption[] = [
  { key: "7d", label: "Last 7 days", days: 7 },
  { key: "30d", label: "Last 30 days", days: 30 },
  { key: "90d", label: "Last 90 days", days: 90 },
];

/** Default reporting period — the most recent 30 days (Req 9.8). */
const DEFAULT_PERIOD_KEY = "30d";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Formats a duration in seconds as a compact human-readable string. */
function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s";
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const rem = total % 60;
  if (minutes < 60) return rem > 0 ? `${minutes}m ${rem}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  return remMin > 0 ? `${hours}h ${remMin}m` : `${hours}h`;
}

export function AnalyticsDashboard() {
  const searchParams = useSearchParams();
  const agentId = searchParams.get("agentId");
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();

  const [periodKey, setPeriodKey] = useState<string>(DEFAULT_PERIOD_KEY);

  // A stable "now" per mount so switching periods doesn't drift the window.
  const [now] = useState(() => Date.now());

  const period = useMemo(() => {
    const option =
      PERIOD_OPTIONS.find((p) => p.key === periodKey) ?? PERIOD_OPTIONS[1];
    return { startMs: now - option.days * MS_PER_DAY, endMs: now };
  }, [periodKey, now]);

  const result = useQuery(
    api.campus.analytics.getAgentAnalytics,
    isAuthenticated && agentId
      ? { agentId, startMs: period.startMs, endMs: period.endMs }
      : "skip"
  );

  // --- No agent selected -------------------------------------------------
  if (!agentId) {
    return (
      <DashboardShell>
        <EmptyState
          testId="dashboard-no-agent"
          title="Pick an agent to see its analytics"
          body="Open your dashboard from an agent's page, or add ?agentId=… to this link to view a specific agent's analytics."
        />
      </DashboardShell>
    );
  }

  // --- Auth / load guards ------------------------------------------------
  if (authLoading || (isAuthenticated && result === undefined)) {
    return (
      <DashboardShell>
        <LoadingRow label="Loading analytics…" />
      </DashboardShell>
    );
  }

  // Unauthorized: anonymous, a non-owner, or an unknown agent (Req 9.6).
  if (!isAuthenticated || (result && !result.authorized)) {
    return (
      <DashboardShell>
        <div
          className="mt-8 rounded-xl border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 px-5 py-10 text-center"
          data-testid="dashboard-unauthorized"
        >
          <h2 className="text-lg font-semibold text-white">
            You can&apos;t view these analytics
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-white/60">
            Analytics are private to the student who created the agent. Sign in
            with the owning account to see them.
          </p>
        </div>
      </DashboardShell>
    );
  }

  // `authorized` is true here.
  const analytics = result!.authorized ? result!.analytics : null;
  if (!analytics) {
    return (
      <DashboardShell>
        <LoadingRow label="Loading analytics…" />
      </DashboardShell>
    );
  }

  return (
    <DashboardShell>
      {/* Near-limit warning + upgrade option from the shared Usage_Meter
          (Req 13.2, 13.3). Renders only when a dimension is near its limit. */}
      <NearLimitBanner />

      {/* Period selector (Req 9.8) */}
      <div
        className="mt-2 flex flex-wrap gap-2"
        role="group"
        aria-label="Reporting period"
        data-testid="dashboard-period"
      >
        {PERIOD_OPTIONS.map((option) => {
          const active = option.key === periodKey;
          return (
            <button
              key={option.key}
              type="button"
              aria-pressed={active}
              onClick={() => setPeriodKey(option.key)}
              data-testid={`dashboard-period-${option.key}`}
              className={`min-h-[44px] rounded-lg px-4 text-sm font-medium transition-colors ${
                active
                  ? "bg-[var(--color-primary)] text-white"
                  : "border border-white/10 bg-white/5 text-white/70 hover:text-white"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {analytics.isEmpty ? (
        <EmptyState
          testId="dashboard-empty"
          title="No activity yet"
          body="Once people call, share, or save this agent, its metrics will show up here."
        />
      ) : (
        <div className="mt-6 space-y-6">
          {/* Metric cards (Req 9.1) */}
          <section
            className="grid grid-cols-2 gap-3 lg:grid-cols-3"
            data-testid="dashboard-metrics"
          >
            <MetricCard label="Total calls" value={String(analytics.callCount)} />
            <MetricCard
              label="Unique callers"
              value={String(analytics.uniqueCallerCount)}
            />
            <MetricCard label="Shares" value={String(analytics.shareCount)} />
            <MetricCard
              label="Saves & remixes"
              value={String(analytics.saveRemixCount)}
            />
            <MetricCard
              label="Avg call length"
              value={formatDuration(analytics.averageCallDurationSeconds)}
            />
            <MetricCard
              label="Avg rating"
              value={
                analytics.averageRating === null
                  ? "—"
                  : analytics.averageRating.toFixed(1)
              }
              suffix={analytics.averageRating === null ? undefined : "/ 5"}
              testId="dashboard-avg-rating"
            />
          </section>

          {/* Monetization conversion clicks (Req 9.5) */}
          {typeof analytics.conversionClickCount === "number" && (
            <section data-testid="dashboard-monetization">
              <SectionHeading>Monetization</SectionHeading>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                <MetricCard
                  label="Link conversion clicks"
                  value={String(analytics.conversionClickCount)}
                />
              </div>
            </section>
          )}

          {/* Type-specific panels (Req 9.3, 9.4) */}
          {analytics.typeMetrics && (
            <TypeMetricsPanel metrics={analytics.typeMetrics} />
          )}

          {/* Top questions (Req 9.2) */}
          <section data-testid="dashboard-top-questions">
            <SectionHeading>Top questions</SectionHeading>
            {analytics.topQuestions.length === 0 ? (
              <EmptyPanel body="No questions have been asked in this period." />
            ) : (
              <RankedList entries={analytics.topQuestions} />
            )}
          </section>

          {/* Recent summaries (Req 9.2) */}
          <section data-testid="dashboard-recent-summaries">
            <SectionHeading>Recent call summaries</SectionHeading>
            {analytics.recentSummaries.length === 0 ? (
              <EmptyPanel body="No call summaries have been recorded in this period." />
            ) : (
              <ul className="space-y-2">
                {analytics.recentSummaries.map((summary) => (
                  <li key={summary.callId} className="card card-content">
                    <p className="text-sm text-white/80">{summary.summary}</p>
                    <p className="mt-1 text-xs text-white/40">
                      {new Date(summary.createdAt).toLocaleString()}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {/* Settings link keeps the surfaces connected (Req 12.x). */}
      <div className="mt-8">
        <Link
          href={`/campus/dashboard/${encodeURIComponent(agentId)}/settings`}
          className="btn btn-outline btn-md min-h-[44px] w-full"
          data-testid="dashboard-settings-link"
        >
          Manage settings &amp; privacy
        </Link>
      </div>
    </DashboardShell>
  );
}

// ---------------------------------------------------------------------------
// Type-specific panels (Req 9.3 study_agent, Req 9.4 club_agent)
// ---------------------------------------------------------------------------

interface RankedEntry {
  readonly text: string;
  readonly count: number;
}

interface TypeMetrics {
  readonly confusingTopics?: readonly RankedEntry[];
  readonly requestedExplanations?: readonly RankedEntry[];
  readonly quizCompletions?: number;
  readonly eventInterest?: number;
  readonly joinIntent?: number;
  readonly contactClicks?: number;
}

function TypeMetricsPanel({ metrics }: { metrics: TypeMetrics }) {
  const isStudy =
    metrics.confusingTopics !== undefined ||
    metrics.requestedExplanations !== undefined ||
    metrics.quizCompletions !== undefined;
  const isClub =
    metrics.eventInterest !== undefined ||
    metrics.joinIntent !== undefined ||
    metrics.contactClicks !== undefined;

  if (isStudy) {
    return (
      <section data-testid="dashboard-study-panel">
        <SectionHeading>Study insights</SectionHeading>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <MetricCard
            label="Quiz completions"
            value={String(metrics.quizCompletions ?? 0)}
          />
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <h4 className="mb-2 text-sm font-medium text-white/70">
              Most confusing topics
            </h4>
            {metrics.confusingTopics && metrics.confusingTopics.length > 0 ? (
              <RankedList entries={metrics.confusingTopics} />
            ) : (
              <EmptyPanel body="No confusing topics recorded yet." />
            )}
          </div>
          <div>
            <h4 className="mb-2 text-sm font-medium text-white/70">
              Most requested explanations
            </h4>
            {metrics.requestedExplanations &&
            metrics.requestedExplanations.length > 0 ? (
              <RankedList entries={metrics.requestedExplanations} />
            ) : (
              <EmptyPanel body="No explanation requests recorded yet." />
            )}
          </div>
        </div>
      </section>
    );
  }

  if (isClub) {
    return (
      <section data-testid="dashboard-club-panel">
        <SectionHeading>Club insights</SectionHeading>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <MetricCard
            label="Event interest"
            value={String(metrics.eventInterest ?? 0)}
          />
          <MetricCard
            label="Join intent"
            value={String(metrics.joinIntent ?? 0)}
          />
          <MetricCard
            label="Contact clicks"
            value={String(metrics.contactClicks ?? 0)}
          />
        </div>
      </section>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Presentational pieces
// ---------------------------------------------------------------------------

function MetricCard({
  label,
  value,
  suffix,
  testId,
}: {
  label: string;
  value: string;
  suffix?: string;
  testId?: string;
}) {
  return (
    <div className="card card-content" data-testid={testId}>
      <p className="text-xs font-medium text-white/50">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-white">
        {value}
        {suffix && (
          <span className="ml-1 text-sm font-normal text-white/40">
            {suffix}
          </span>
        )}
      </p>
    </div>
  );
}

function RankedList({ entries }: { entries: readonly RankedEntry[] }) {
  return (
    <ol className="space-y-2">
      {entries.map((entry, index) => (
        <li
          key={`${entry.text}-${index}`}
          className="card card-content flex items-center gap-3"
        >
          <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-white/10 text-sm font-bold tabular-nums text-white/80">
            {index + 1}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm text-white/80">
            {entry.text}
          </span>
          <span className="badge badge-neutral tabular-nums">{entry.count}</span>
        </li>
      ))}
    </ol>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-3 text-lg font-semibold text-white">{children}</h3>;
}

function EmptyPanel({ body }: { body: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-6 text-center text-sm text-white/50">
      {body}
    </div>
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
    <div
      className="mt-8 rounded-xl border border-white/10 bg-white/5 px-5 py-10 text-center"
      data-testid={testId}
    >
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-white/60">{body}</p>
    </div>
  );
}

/** Page chrome shared across the dashboard states. */
function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative min-h-screen w-full overflow-x-hidden bg-black text-white">
      <div className="mx-auto w-full max-w-2xl px-5 py-8 sm:px-6">
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
        <h1 className="text-2xl font-bold sm:text-3xl">Your analytics</h1>
        <p className="mt-1 text-sm text-white/60">
          See how students are calling, sharing, and saving your AI voice agent.
        </p>
        {children}
      </div>
    </main>
  );
}

export default AnalyticsDashboard;
