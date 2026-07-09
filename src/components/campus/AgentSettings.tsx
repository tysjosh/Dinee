"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

/**
 * Feature: dinee-campus (Task 33.2) — `AgentSettings`.
 *
 * The owner-gated settings / privacy surface at
 * `/campus/dashboard/[agentId]/settings` (Req 12.1–12.6, 12.9). It lets a
 * Student_Creator govern an owned Campus_Agent's privacy and delete its data,
 * all through the `campus.privacy` and `campus.knowledge`/`campus.agents`
 * Convex services:
 *
 *   - Visibility toggle — public/private, reflected in Discovery_Service
 *     listings within 5s (Req 12.1) via `privacy.setVisibility`.
 *   - Recording toggle — applies to future calls only (Req 12.5) via
 *     `privacy.setRecordingEnabled`.
 *   - Summaries toggle — applies to future calls only (Req 12.6) via
 *     `privacy.setSummariesEnabled`.
 *   - Delete uploaded knowledge — per-source deletion (Req 12.2) via
 *     `knowledge.listSources` + `knowledge.deleteSource`.
 *   - Delete call history — removes recorded events/ratings/clips/rollups
 *     (Req 12.2); a failed deletion retains the data and surfaces an error
 *     indication (Req 12.4) via `privacy.deleteCallHistory`.
 *   - Delete agent — takes the agent out of circulation and shows a completion
 *     confirmation (Req 12.2, 12.3) via `agents.deleteAgent`.
 *   - Data-usage disclosure — a static description of what Caller and
 *     Knowledge_Source data is stored and how it is used (Req 12.9).
 *
 * Access is owner-gated: `privacy.getAgentSettings` returns
 * `{ authorized: false }` for anonymous requesters, non-owners, or an unknown /
 * deleted agent, in which case an unauthorized indication is shown and nothing
 * is disclosed.
 *
 * Destructive actions use an inline two-step confirmation (rather than a native
 * dialog) so they are keyboard-accessible and testable. Mobile-first: the shell
 * hides horizontal overflow and is width-constrained so the page renders
 * without horizontal scrolling at 360px, and every control meets the 44×44
 * CSS-pixel minimum touch-target size (Req 14.1, 14.2).
 */

type Visibility = "public" | "private";

interface KnowledgeSource {
  readonly sourceId: string;
  readonly kind: string;
  readonly textContent?: string;
  readonly faqEntries?: readonly { question: string; answer: string }[];
  readonly fileMeta?: { fileName: string; sizeBytes: number; mimeType: string };
  readonly moderationStatus: string;
  readonly createdAt: number;
}

/** A human-readable label for a Knowledge_Source row. */
function sourceLabel(source: KnowledgeSource): string {
  switch (source.kind) {
    case "document":
      return source.fileMeta?.fileName ?? "Uploaded document";
    case "faq":
      return `FAQ (${source.faqEntries?.length ?? 0} entries)`;
    case "instructions":
      return "Instructions";
    case "link":
      return "Link";
    case "event":
      return "Event details";
    case "club":
      return "Club details";
    case "course":
      return "Course details";
    default:
      return source.kind;
  }
}

export function AgentSettings({ agentId }: { agentId: string }) {
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();

  const settingsResult = useQuery(
    api.campus.privacy.getAgentSettings,
    isAuthenticated ? { agentId } : "skip"
  );
  const sources = useQuery(
    api.campus.knowledge.listSources,
    isAuthenticated ? { agentId } : "skip"
  );

  const setVisibility = useMutation(api.campus.privacy.setVisibility);
  const setRecordingEnabled = useMutation(api.campus.privacy.setRecordingEnabled);
  const setSummariesEnabled = useMutation(api.campus.privacy.setSummariesEnabled);
  const deleteCallHistory = useMutation(api.campus.privacy.deleteCallHistory);
  const deleteSource = useMutation(api.campus.knowledge.deleteSource);
  const deleteAgent = useMutation(api.campus.agents.deleteAgent);

  // Local, optimistic mirror of the toggle state, seeded once settings load.
  const [visibility, setVisibilityState] = useState<Visibility | null>(null);
  const [recording, setRecording] = useState<boolean | null>(null);
  const [summaries, setSummaries] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [agentDeleted, setAgentDeleted] = useState(false);

  const authorized = settingsResult?.authorized === true;
  const settings = authorized ? settingsResult.settings : null;

  useEffect(() => {
    if (settings) {
      setVisibilityState((v) => (v === null ? settings.visibility : v));
      setRecording((r) => (r === null ? settings.recordingEnabled : r));
      setSummaries((s) => (s === null ? settings.summariesEnabled : s));
    }
  }, [settings]);

  const handleVisibility = useCallback(
    async (next: Visibility) => {
      const prev = visibility;
      setVisibilityState(next);
      setError(null);
      try {
        await setVisibility({ agentId, visibility: next });
        setNotice(
          next === "public"
            ? "Your agent is now public and can appear in discovery."
            : "Your agent is now private. Only you and people with a private link can reach it."
        );
      } catch {
        setVisibilityState(prev);
        setError("Couldn't update visibility. Please try again.");
      }
    },
    [agentId, setVisibility, visibility]
  );

  const handleRecording = useCallback(
    async (next: boolean) => {
      const prev = recording;
      setRecording(next);
      setError(null);
      try {
        await setRecordingEnabled({ agentId, enabled: next });
        setNotice(
          "Saved. This applies to calls started from now on — calls already in progress are unchanged."
        );
      } catch {
        setRecording(prev);
        setError("Couldn't update the recording setting. Please try again.");
      }
    },
    [agentId, setRecordingEnabled, recording]
  );

  const handleSummaries = useCallback(
    async (next: boolean) => {
      const prev = summaries;
      setSummaries(next);
      setError(null);
      try {
        await setSummariesEnabled({ agentId, enabled: next });
        setNotice(
          "Saved. This applies to calls started from now on — calls already in progress are unchanged."
        );
      } catch {
        setSummaries(prev);
        setError("Couldn't update the summary setting. Please try again.");
      }
    },
    [agentId, setSummariesEnabled, summaries]
  );

  // --- Auth / load guards ------------------------------------------------

  if (authLoading || (isAuthenticated && settingsResult === undefined)) {
    return (
      <SettingsShell>
        <LoadingRow label="Loading settings…" />
      </SettingsShell>
    );
  }

  if (agentDeleted) {
    return (
      <SettingsShell>
        <div
          className="mt-8 rounded-xl border border-white/10 bg-white/5 px-5 py-10 text-center"
          data-testid="settings-agent-deleted"
        >
          <h2 className="text-lg font-semibold text-white">Agent deleted</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-white/60">
            Your AI voice agent and its call link have been removed. It no longer
            appears in discovery.
          </p>
          <Link
            href="/campus"
            className="btn btn-primary btn-lg mt-6 min-h-[44px] w-full"
          >
            Back to Dinee Campus
          </Link>
        </div>
      </SettingsShell>
    );
  }

  if (!isAuthenticated || !authorized || !settings) {
    return (
      <SettingsShell>
        <div
          className="mt-8 rounded-xl border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 px-5 py-10 text-center"
          data-testid="settings-unauthorized"
        >
          <h2 className="text-lg font-semibold text-white">
            You can&apos;t manage this agent
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-white/60">
            Settings are private to the student who created the agent. Sign in
            with the owning account to manage it.
          </p>
        </div>
      </SettingsShell>
    );
  }

  const knowledgeSources = (sources ?? []) as KnowledgeSource[];

  return (
    <SettingsShell agentName={settings.name}>
      {(error || notice) && (
        <div className="mt-4" role="status" aria-live="polite">
          {error && (
            <p
              className="rounded-lg border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 px-4 py-3 text-sm text-[var(--color-danger-400)]"
              data-testid="settings-error"
            >
              {error}
            </p>
          )}
          {notice && !error && (
            <p
              className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70"
              data-testid="settings-notice"
            >
              {notice}
            </p>
          )}
        </div>
      )}

      {/* Visibility (Req 12.1) */}
      <SettingSection
        title="Visibility"
        description="Public agents can appear in discovery and be called by anyone. Private agents are reachable only by you and people with a private link."
      >
        <div
          className="grid grid-cols-2 gap-2"
          role="group"
          aria-label="Agent visibility"
          data-testid="settings-visibility"
        >
          <SegmentButton
            active={visibility === "public"}
            onClick={() => void handleVisibility("public")}
            testId="settings-visibility-public"
          >
            Public
          </SegmentButton>
          <SegmentButton
            active={visibility === "private"}
            onClick={() => void handleVisibility("private")}
            testId="settings-visibility-private"
          >
            Private
          </SegmentButton>
        </div>
      </SettingSection>

      {/* Recording (Req 12.5) */}
      <SettingSection
        title="Call recording"
        description="When on, voice conversations may be recorded. Changes apply only to calls started after you save."
      >
        <ToggleRow
          label="Record calls"
          checked={recording === true}
          onChange={(next) => void handleRecording(next)}
          testId="settings-recording"
        />
      </SettingSection>

      {/* Summaries (Req 12.6) */}
      <SettingSection
        title="Call summaries"
        description="When on, a short summary is generated for each call. Changes apply only to calls started after you save."
      >
        <ToggleRow
          label="Generate call summaries"
          checked={summaries === true}
          onChange={(next) => void handleSummaries(next)}
          testId="settings-summaries"
        />
      </SettingSection>

      {/* Delete uploaded knowledge (Req 12.2) */}
      <SettingSection
        title="Uploaded knowledge"
        description="Delete knowledge sources you've added. Deleting a source removes it from what your agent can answer from."
      >
        {sources === undefined ? (
          <LoadingRow label="Loading knowledge…" />
        ) : knowledgeSources.length === 0 ? (
          <p className="text-sm text-white/50" data-testid="settings-knowledge-empty">
            You haven&apos;t added any knowledge sources.
          </p>
        ) : (
          <ul className="space-y-2" data-testid="settings-knowledge-list">
            {knowledgeSources.map((source) => (
              <KnowledgeRow
                key={source.sourceId}
                label={sourceLabel(source)}
                onDelete={async () => {
                  setError(null);
                  try {
                    const res = await deleteSource({ sourceId: source.sourceId });
                    if (!res.ok) {
                      setError("That knowledge source could not be found.");
                    } else {
                      setNotice("Knowledge source deleted.");
                    }
                  } catch {
                    setError("Couldn't delete that knowledge source. Please try again.");
                  }
                }}
              />
            ))}
          </ul>
        )}
      </SettingSection>

      {/* Delete call history (Req 12.2, 12.4) */}
      <SettingSection
        title="Call history"
        description="Delete recorded call activity for this agent — its events, ratings, clips, and analytics rollups. This cannot be undone."
      >
        <ConfirmButton
          idleLabel="Delete call history"
          confirmLabel="Confirm delete call history"
          testId="settings-delete-history"
          onConfirm={async () => {
            setError(null);
            try {
              const res = await deleteCallHistory({ agentId });
              if (!res.ok) {
                // Deletion did not complete; data is retained (Req 12.4).
                setError(
                  "Call history could not be deleted. Your data was left unchanged — please try again."
                );
              } else {
                setNotice("Call history deleted.");
              }
            } catch {
              setError(
                "Call history could not be deleted. Your data was left unchanged — please try again."
              );
            }
          }}
        />
      </SettingSection>

      {/* Delete agent (Req 12.2, 12.3) */}
      <SettingSection
        title="Delete this agent"
        description="Permanently remove this AI voice agent. It will disappear from discovery and its call link will stop working. This cannot be undone."
        danger
      >
        <ConfirmButton
          idleLabel="Delete agent"
          confirmLabel="Confirm delete agent"
          testId="settings-delete-agent"
          onConfirm={async () => {
            setError(null);
            try {
              await deleteAgent({ agentId });
              setAgentDeleted(true);
            } catch {
              setError("Couldn't delete the agent. Please try again.");
            }
          }}
        />
      </SettingSection>

      {/* Data-usage disclosure (Req 12.9) */}
      <section
        className="mt-8 rounded-xl border border-white/10 bg-white/5 p-5"
        data-testid="settings-data-usage"
      >
        <h3 className="text-sm font-semibold text-white">How your data is used</h3>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-white/60">
          <li>
            Knowledge you add (instructions, FAQs, documents, event/club/course
            details) is stored so your AI voice agent can answer from it. It is
            used only to ground this agent&apos;s replies.
          </li>
          <li>
            When call recording or summaries are on, call audio and generated
            summaries are stored so you can review activity in your analytics.
            Callers are shown a notice and must acknowledge it before a call is
            recorded or summarized; declining proceeds without recording.
          </li>
          <li>
            Caller interactions (call counts, questions asked, ratings, shares,
            and saves) are stored in aggregate to power your analytics. Caller
            identities are stored as hashed keys, not personal profiles.
          </li>
          <li>
            You can delete uploaded knowledge, call history, or the entire agent
            at any time from this page.
          </li>
        </ul>
      </section>
    </SettingsShell>
  );
}

// ---------------------------------------------------------------------------
// Presentational pieces
// ---------------------------------------------------------------------------

function SettingSection({
  title,
  description,
  children,
  danger,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <section
      className={`mt-4 rounded-xl border p-5 ${
        danger
          ? "border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5"
          : "border-white/10 bg-white/5"
      }`}
    >
      <h3 className="text-base font-semibold text-white">{title}</h3>
      <p className="mt-1 text-sm text-white/55">{description}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function SegmentButton({
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
      aria-pressed={active}
      onClick={onClick}
      data-testid={testId}
      className={`min-h-[44px] rounded-lg px-4 text-sm font-medium transition-colors ${
        active
          ? "bg-[var(--color-primary)] text-white"
          : "border border-white/10 bg-white/5 text-white/70 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
  testId,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  testId: string;
}) {
  return (
    <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-4">
      <span className="text-sm text-white/80">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        data-testid={testId}
        className={`relative inline-flex h-7 w-12 flex-none items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${
          checked ? "bg-[var(--color-primary)]" : "bg-white/15"
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </label>
  );
}

function KnowledgeRow({
  label,
  onDelete,
}: {
  label: string;
  onDelete: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <li className="card card-content flex items-center gap-3">
      <span className="min-w-0 flex-1 truncate text-sm text-white/80">
        {label}
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onDelete();
          } finally {
            setBusy(false);
          }
        }}
        className="btn btn-ghost btn-sm min-h-[44px] text-[var(--color-danger-400)] disabled:opacity-40"
        data-testid="settings-knowledge-delete"
      >
        {busy ? "Deleting…" : "Delete"}
      </button>
    </li>
  );
}

/**
 * A destructive action that requires a second click to confirm. The first click
 * arms the confirmation; a follow-up click within the armed state runs it, and
 * a "Cancel" affordance disarms it. Keyboard-accessible and testable.
 */
function ConfirmButton({
  idleLabel,
  confirmLabel,
  onConfirm,
  testId,
}: {
  idleLabel: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  testId: string;
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!armed) {
    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        className="btn btn-destructive btn-md min-h-[44px] w-full"
        data-testid={testId}
      >
        {idleLabel}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onConfirm();
          } finally {
            setBusy(false);
            setArmed(false);
          }
        }}
        className="btn btn-destructive btn-md min-h-[44px] flex-1 disabled:opacity-40"
        data-testid={`${testId}-confirm`}
      >
        {busy ? "Working…" : confirmLabel}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => setArmed(false)}
        className="btn btn-outline btn-md min-h-[44px] flex-1 disabled:opacity-40"
        data-testid={`${testId}-cancel`}
      >
        Cancel
      </button>
    </div>
  );
}

function LoadingRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 text-white/70">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

/** Page chrome shared across the settings states. */
function SettingsShell({
  children,
  agentName,
}: {
  children: React.ReactNode;
  agentName?: string;
}) {
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
        <h1 className="text-2xl font-bold sm:text-3xl">Settings &amp; privacy</h1>
        <p className="mt-1 text-sm text-white/60">
          {agentName
            ? `Manage ${agentName} — visibility, recording, and your data.`
            : "Manage your AI voice agent's visibility, recording, and data."}
        </p>
        {children}
      </div>
    </main>
  );
}

export default AgentSettings;
