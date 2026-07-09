"use client";

import React from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

/**
 * Feature: dinee-campus (Task 40.1) — `CreatorPage`.
 *
 * The public Creator_Page rendered at `/campus/u/[handle]` (Req 15.15–15.18).
 * It resolves the page through the access-gated `campus.creators.getCreatorPage`
 * query (by the creator's `campusHandle`) and:
 *   - on a public page, lists exactly the creator's public, published
 *     Campus_Agents — each entry carrying the agent's display name and its
 *     Campus_Tag — with the creator display name as the heading, and an
 *     empty-state when the creator has no qualifying agent (Req 15.15, 15.18);
 *   - on a hidden page requested by anyone other than the owning creator,
 *     withholds ALL content and shows an "unavailable" state (Req 15.17). The
 *     query returns the same `unavailable` result for an unknown handle, so this
 *     component never discloses whether a handle exists.
 *
 * All projection / gating decisions are made server-side in the pure core
 * (`convex/campus/logic/creatorPage.ts`, task 38); this component only renders
 * the discriminated result. Mobile-first: the shell hides horizontal overflow
 * and constrains width so the page renders without horizontal scroll at a 360px
 * viewport, and every interactive control meets the 44×44 CSS-pixel minimum
 * touch-target size (Req 14.1, 14.2).
 */

interface CreatorPageProps {
  readonly handle: string;
}

export function CreatorPage({ handle }: CreatorPageProps) {
  const result = useQuery(api.campus.creators.getCreatorPage, { handle });

  // --- Loading ------------------------------------------------------------

  if (result === undefined) {
    return (
      <CreatorPageShell>
        <div className="mt-16 flex items-center justify-center gap-3 text-white/70">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          <span className="text-sm">Loading creator…</span>
        </div>
      </CreatorPageShell>
    );
  }

  // --- Hidden / unknown handle (withhold all content) — Req 15.17 ---------

  if (!result.visible) {
    return (
      <CreatorPageShell>
        <div className="mt-16 text-center" data-testid="creator-page-unavailable">
          <h1 className="text-2xl font-bold sm:text-3xl">
            This page isn&apos;t available
          </h1>
          <p className="mx-auto mt-3 max-w-sm text-sm text-white/60">
            This creator page is private or doesn&apos;t exist.
          </p>
          <Link href="/campus/discover" className="btn btn-outline btn-md mt-6 min-h-[44px]">
            Explore Dinee Campus
          </Link>
        </div>
      </CreatorPageShell>
    );
  }

  // --- Public page --------------------------------------------------------

  const { creatorDisplayName, agents, isEmpty } = result;

  return (
    <CreatorPageShell>
      <header className="mt-4 flex flex-col items-center text-center">
        <span className="badge badge-accent" data-testid="ai-voice-agent-label">
          AI voice agents
        </span>
        <h1 className="mt-3 text-2xl font-bold sm:text-3xl" data-testid="creator-display-name">
          {creatorDisplayName || "Dinee Campus creator"}
        </h1>
        <p className="mt-1 text-sm text-white/60">
          {isEmpty
            ? "No public agents yet"
            : `${agents.length} public agent${agents.length === 1 ? "" : "s"}`}
        </p>
      </header>

      {isEmpty ? (
        <div className="mt-12 text-center" data-testid="creator-page-empty">
          <p className="mx-auto max-w-sm text-sm text-white/60">
            This creator hasn&apos;t published any public agents yet. Check back
            soon.
          </p>
          <Link href="/campus/discover" className="btn btn-outline btn-md mt-6 min-h-[44px]">
            Discover other agents
          </Link>
        </div>
      ) : (
        <ul className="mt-8 space-y-3" data-testid="creator-page-list">
          {agents.map((agent) => (
            <li key={agent.agentId}>
              <article
                className="card card-content flex items-center gap-4"
                data-testid="creator-page-agent"
              >
                <div
                  className="flex h-12 w-12 flex-none items-center justify-center rounded-full text-lg font-bold text-white shadow"
                  style={avatarStyle(agent.agentId)}
                  aria-hidden="true"
                >
                  {initialOf(agent.agentName)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-white">
                    {agent.agentName}
                  </p>
                  <p className="truncate text-xs text-white/60">
                    by {agent.creatorDisplayName}
                  </p>
                </div>
                {agent.campusTag && (
                  <span className="badge badge-primary flex-none" data-testid="creator-page-campus-tag">
                    {agent.campusTag}
                  </span>
                )}
              </article>
            </li>
          ))}
        </ul>
      )}
    </CreatorPageShell>
  );
}

/** Page chrome shared by the loading, unavailable, empty, and list states. */
function CreatorPageShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative min-h-screen w-full overflow-x-hidden bg-black text-white">
      <div className="mx-auto w-full max-w-xl px-5 py-8 sm:px-6">
        <header className="mb-2 flex items-center justify-between gap-3">
          <Link
            href="/campus"
            className="btn btn-ghost btn-sm min-h-[44px] min-w-[44px]"
            aria-label="Back to Dinee Campus"
          >
            ← Back
          </Link>
          <span className="badge badge-accent">Dinee Campus</span>
        </header>
        {children}
      </div>
    </main>
  );
}

/** The uppercase first character of a name, falling back to a neutral glyph. */
function initialOf(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed[0].toUpperCase() : "•";
}

/** A deterministic avatar background derived from the agent's id seed. */
function avatarStyle(seed: string): React.CSSProperties {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  return {
    background: `linear-gradient(135deg, hsl(${hue} 70% 45%), hsl(${
      (hue + 40) % 360
    } 70% 35%))`,
  };
}

export default CreatorPage;
