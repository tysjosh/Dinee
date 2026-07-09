"use client";

import React, { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { campusCopy } from "@/lib/campus/copy";
import { ShareSheet } from "./ShareSheet";

/**
 * Feature: dinee-campus (Task 30.1) — `AgentProfile`.
 *
 * The public Agent_Profile_Page for a Campus_Agent, rendered at
 * `/campus/a/[slug]` (Req 6.1–6.10, 7.6). It resolves the profile through the
 * access-gated `campus.agents.getPublicProfile` query (by Call_Link `slug`, plus
 * an optional `?token=` Private_Link token) and:
 *   - on a grant, shows the agent's identity — visual monogram, name, creator
 *     display name, campus tag, agent type, description (≤280 chars), and 1–5
 *     preview prompts — with the visible "AI voice agent" label (Req 6.1, 6.3,
 *     6.4), plus call / share / report buttons (Req 6.2), a save toggle
 *     (Req 15.1, 15.2), and a remix button when the remix option is enabled
 *     (Req 6.5, 15.5);
 *   - on a denial, withholds ALL agent content and shows the matching
 *     access-denied / unavailable / invalid state (Req 6.6, 6.7, 6.11, 7.7, 7.8).
 *
 * Share is delegated to `ShareSheet` (copy-link/QR/SMS/social/embed/Share_Card,
 * Req 7.3–7.6, 15.14). Report is submitted through `campus.safety.submitReport`
 * and shows a confirmation while keeping the profile content on screen
 * (Req 6.9). Mobile-first: no horizontal scroll at 360px, 44×44 touch targets
 * (Req 14.1).
 *
 * Save and Remix (Req 15.1, 15.2, 15.5) are wired to the `Social_Service`
 * Convex wrapper (`campus.social.*`, spec task 39): the save toggle reflects
 * `isSaved` / `getSaveCount` and persists through `saveAgent` / `unsaveAgent`
 * with an optimistic label that reconciles to the server (and reverts on a
 * denial, e.g. a private agent without a valid token); the remix button calls
 * `remixAgent` and routes to the new draft in the creation flow.
 */

/** Maps an Agent_Type to its student-facing label from the shared copy corpus. */
const AGENT_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  campusCopy.onboarding.options.map((o) => [o.agentType, o.label])
);

const REPORT_REASON_MAX = 1000;

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

interface AgentProfileProps {
  readonly slug: string;
  readonly token?: string;
}

export function AgentProfile({ slug, token }: AgentProfileProps) {
  const router = useRouter();
  const result = useQuery(api.campus.agents.getPublicProfile, { slug, token });
  const submitReport = useMutation(api.campus.safety.submitReport);

  const agentId = result?.granted ? result.agentId : undefined;

  // Social_Service wiring (Req 15.1–15.5). Queries are skipped until the
  // profile grant yields an `agentId`.
  const isSavedResult = useQuery(
    api.campus.social.isSaved,
    agentId ? { agentId } : "skip"
  );
  const saveCountResult = useQuery(
    api.campus.social.getSaveCount,
    agentId ? { agentId } : "skip"
  );
  const saveAgent = useMutation(api.campus.social.saveAgent);
  const unsaveAgent = useMutation(api.campus.social.unsaveAgent);
  const remixAgent = useMutation(api.campus.social.remixAgent);

  const [shareOpen, setShareOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportDone, setReportDone] = useState(false);
  const [reportError, setReportError] = useState("");

  // Optimistic save state (Req 15.1, 15.2): `null` means "defer to the server"
  // (`isSaved`); a boolean is the pending optimistic value shown until the
  // mutation reconciles.
  const [optimisticSaved, setOptimisticSaved] = useState<boolean | null>(null);
  const saved = optimisticSaved ?? isSavedResult?.saved ?? false;
  const saveCount = saveCountResult?.count;

  const [remixNotice, setRemixNotice] = useState("");
  const [remixPending, setRemixPending] = useState(false);

  const handleToggleSave = useCallback(async () => {
    if (!agentId) return;
    const next = !saved;
    // Optimistic label update (Req 15.1, 15.2).
    setOptimisticSaved(next);
    try {
      if (next) {
        const res = await saveAgent({ agentId, token });
        if (!res.saved) {
          // Denied (e.g. private agent without a valid token, Req 15.4) — revert.
          setOptimisticSaved(false);
          return;
        }
      } else {
        await unsaveAgent({ agentId });
      }
      // Reconcile to the authoritative server value.
      setOptimisticSaved(null);
    } catch {
      // Reconcile to the last known server value on failure.
      setOptimisticSaved(null);
    }
  }, [agentId, saved, token, saveAgent, unsaveAgent]);

  const handleRemix = useCallback(async () => {
    if (!agentId || remixPending) return;
    setRemixNotice("");
    setRemixPending(true);
    try {
      const res = await remixAgent({ sourceAgentId: agentId, token });
      if (res.success) {
        // The remix created an owned draft; continue editing it in the flow.
        router.push(
          `/campus/create?agentId=${encodeURIComponent(res.draftAgentId)}`
        );
        return;
      }
      setRemixNotice(
        res.denial === "remix_disabled"
          ? "This creator hasn't enabled remixing for this agent."
          : "You need a valid link from the creator to remix this agent."
      );
    } catch {
      setRemixNotice("Something went wrong starting your remix. Try again.");
    } finally {
      setRemixPending(false);
    }
  }, [agentId, remixPending, token, remixAgent, router]);

  const handleSubmitReport = useCallback(async () => {
    if (!agentId) return;
    setReportSubmitting(true);
    setReportError("");
    try {
      const res = await submitReport({ agentId, reason: reportReason });
      if (res.ok) {
        setReportDone(true);
        setReportOpen(false);
        setReportReason("");
      } else {
        setReportError(
          "Please add a reason (up to 1,000 characters) before submitting."
        );
      }
    } catch {
      setReportError("Something went wrong submitting your report. Try again.");
    } finally {
      setReportSubmitting(false);
    }
  }, [agentId, reportReason, submitReport]);

  const callHref = useMemo(() => {
    const base = `/campus/a/${encodeURIComponent(slug)}/call`;
    return token ? `${base}?token=${encodeURIComponent(token)}` : base;
  }, [slug, token]);

  // --- Loading ------------------------------------------------------------

  if (result === undefined) {
    return (
      <ProfileShell>
        <div className="mt-16 flex items-center justify-center gap-3 text-white/70">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          <span className="text-sm">Loading agent…</span>
        </div>
      </ProfileShell>
    );
  }

  // --- Denial states (withhold all content) — Req 6.6, 6.7, 6.11, 7.7, 7.8 -

  if (!result.granted) {
    const { title, body } = denialCopy(result.denial);
    return (
      <ProfileShell>
        <div className="mt-16 text-center" data-testid={`profile-denied-${result.denial}`}>
          <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
          <p className="mx-auto mt-3 max-w-sm text-sm text-white/60">{body}</p>
          <Link
            href="/campus"
            className="btn btn-outline btn-md mt-6 min-h-[44px]"
          >
            Explore Dinee Campus
          </Link>
        </div>
      </ProfileShell>
    );
  }

  // --- Granted profile ----------------------------------------------------

  const { profile } = result;
  const agentTypeLabel = AGENT_TYPE_LABELS[profile.agentType] ?? profile.agentType;

  return (
    <ProfileShell>
      <article className="mt-4" data-testid="agent-profile">
        {/* Identity */}
        <header className="flex flex-col items-center text-center">
          <div
            className="flex h-24 w-24 items-center justify-center rounded-full text-4xl font-bold text-white shadow-lg"
            style={avatarStyle(profile.visualIdentity.colorSeed)}
            aria-hidden="true"
          >
            {profile.visualIdentity.initial}
          </div>

          {/* The visible "AI voice agent" label (Req 6.3). */}
          <span className="badge badge-accent mt-4" data-testid="ai-voice-agent-label">
            AI voice agent
          </span>

          <h1 className="mt-3 text-2xl font-bold sm:text-3xl">{profile.name}</h1>
          <p className="mt-1 text-sm text-white/60">
            by {profile.creatorDisplayName}
          </p>

          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            {profile.campusTag && (
              <span className="badge badge-primary">{profile.campusTag}</span>
            )}
            <span className="badge badge-neutral">{agentTypeLabel}</span>
          </div>

          {profile.description && (
            <p className="mt-4 max-w-md text-pretty text-sm leading-relaxed text-white/80">
              {profile.description}
            </p>
          )}
        </header>

        {/* Primary actions (Req 6.2) */}
        <div className="mt-6 flex flex-col gap-3">
          <Link
            href={callHref}
            className="btn btn-primary btn-lg min-h-[44px] w-full"
            data-testid="profile-call"
          >
            Call this agent
          </Link>

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              className="btn btn-outline btn-md min-h-[44px]"
              data-testid="profile-share"
            >
              Share
            </button>
            <button
              type="button"
              onClick={handleToggleSave}
              aria-pressed={saved}
              className="btn btn-outline btn-md min-h-[44px]"
              data-testid="profile-save"
            >
              {saved ? "Saved" : "Save"}
              {typeof saveCount === "number" && saveCount > 0 && (
                <span className="ml-1 text-white/50">· {saveCount}</span>
              )}
            </button>
          </div>

          {/* Remix control is present only when the option is enabled (Req 6.5). */}
          {profile.hasRemixControl && (
            <button
              type="button"
              onClick={handleRemix}
              disabled={remixPending}
              className="btn btn-secondary btn-md min-h-[44px] w-full disabled:opacity-50"
              data-testid="profile-remix"
            >
              {remixPending ? "Starting remix…" : "Remix this agent"}
            </button>
          )}
          {remixNotice && (
            <p
              className="text-center text-xs text-white/50"
              role="status"
              data-testid="remix-notice"
            >
              {remixNotice}
            </p>
          )}

          <button
            type="button"
            onClick={() => {
              setReportOpen(true);
              setReportDone(false);
            }}
            className="btn btn-ghost btn-sm mx-auto min-h-[44px] text-white/60"
            data-testid="profile-report"
          >
            Report
          </button>
          {reportDone && (
            <p
              className="text-center text-xs text-emerald-400"
              role="status"
              data-testid="report-confirmation"
            >
              Thanks — your report was submitted.
            </p>
          )}
        </div>

        {/* Preview prompts (1–5, already clamped by the projection) — Req 6.4 */}
        {profile.previewPrompts.length > 0 && (
          <section className="mt-8">
            <h2 className="text-sm font-medium text-white/70">Try asking</h2>
            <ul className="mt-3 space-y-2">
              {profile.previewPrompts.map((prompt, index) => (
                <li
                  key={index}
                  className="card card-content text-sm text-white/80"
                >
                  “{prompt}”
                </li>
              ))}
            </ul>
          </section>
        )}
      </article>

      {/* Report form */}
      {reportOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label={`Report ${profile.name}`}
        >
          <button
            type="button"
            aria-label="Close report form"
            onClick={() => setReportOpen(false)}
            className="absolute inset-0 bg-black/70"
          />
          <div className="relative z-10 w-full max-w-md overflow-x-hidden rounded-t-2xl border border-[var(--color-border-default)] bg-[var(--color-background-surface)] p-5 sm:rounded-2xl">
            <h2 className="text-lg font-bold text-white">Report this agent</h2>
            <p className="mt-1 text-sm text-white/60">
              Tell us what&apos;s wrong. Your report is confidential.
            </p>
            <textarea
              value={reportReason}
              maxLength={REPORT_REASON_MAX}
              onChange={(e) => setReportReason(e.target.value)}
              placeholder="What's the problem?"
              className="mt-4 w-full min-h-[96px] rounded-md border border-[var(--color-border-default)] bg-[var(--color-background-muted)] px-3 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
              data-testid="report-reason"
            />
            <p className="mt-1 text-right text-[11px] text-white/40">
              {reportReason.length}/{REPORT_REASON_MAX}
            </p>
            {reportError && (
              <p className="text-xs text-red-400" role="alert">
                {reportError}
              </p>
            )}
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={() => setReportOpen(false)}
                className="btn btn-ghost btn-md min-h-[44px] flex-1"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmitReport}
                disabled={reportSubmitting || reportReason.trim().length === 0}
                className="btn btn-destructive btn-md min-h-[44px] flex-1 disabled:opacity-50"
                data-testid="report-submit"
              >
                {reportSubmitting ? "Submitting…" : "Submit report"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Share sheet */}
      {shareOpen && (
        <ShareSheet
          slug={slug}
          token={token}
          agentId={agentId}
          agentName={profile.name}
          onClose={() => setShareOpen(false)}
        />
      )}
    </ProfileShell>
  );
}

/** Page chrome shared by the loading, denial, and granted states. */
function ProfileShell({ children }: { children: React.ReactNode }) {
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

/** Student-facing copy for each access-gate denial code (Req 6.6, 6.7, 7.8). */
function denialCopy(denial: "access_denied" | "unavailable" | "invalid"): {
  title: string;
  body: string;
} {
  switch (denial) {
    case "access_denied":
      return {
        title: "This agent is private",
        body: "You need a valid link from the creator to view and call this agent.",
      };
    case "unavailable":
      return {
        title: "This agent isn't available",
        body: "It may have been unpublished or removed by its creator.",
      };
    case "invalid":
    default:
      return {
        title: "We couldn't find that agent",
        body: "This link doesn't match any agent. Check the link and try again.",
      };
  }
}

export default AgentProfile;
