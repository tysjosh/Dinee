"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

import { CAMPUS_VOICES, CAMPUS_TONES } from "@/lib/campus/options";
import {
  getTemplate,
  listTemplates,
  type AgentType,
  type CampusTemplate,
} from "@/lib/campus/templates";
import { campusCopy } from "@/lib/campus/copy";
import { NAME_MAX, NAME_MIN } from "@/lib/campus/validation";
import { NearLimitBanner } from "@/components/campus/NearLimitBanner";

/**
 * Feature: dinee-campus (Task 29.1) — `CreationWizard`.
 *
 * The seven-step Creation_Flow a Student_Creator follows to turn a draft into a
 * published Campus_Agent (Req 4.1): choose template → name → pick voice →
 * define personality → add knowledge → test call → publish/share. It is the
 * "Keep building" destination the Onboarding_Flow links to
 * (`/campus/create?agentId=…`) and shares the SAME draft: it loads the draft via
 * `campus.agents.getDraft` and writes every change back through
 * `campus.agents.saveDraft`.
 *
 * Behaviors:
 *   - Ordered steps with a progress rail (Req 4.1).
 *   - Autosave: each entered value is persisted (debounced, well within the 5s
 *     bound) via `saveDraft`, and every step transition flushes a save, so a
 *     creator who leaves and returns resumes with values retained (Req 4.3).
 *   - Test call: the "test call" step starts a call to the agent using the
 *     values currently entered — it flushes the current values first, then
 *     resolves the live session (voice + grounded knowledge + system prompt) the
 *     Voice_Runtime would use, via `campus.session.getSessionConfig` (Req 4.4).
 *   - Publish: `publishAgent` runs the Publish_State machine and returns a
 *     discriminated result. The wizard surfaces field / usage-limit / consent /
 *     runtime-registration / call-link errors WITHOUT losing entered values, and
 *     on success shows the Agent_Profile_Page link + the Call_Link (Req 4.2,
 *     4.5, 4.6, 4.7).
 *
 * All strings avoid business terminology; the layout renders without horizontal
 * scroll at 360px and every control meets the 44×44 touch-target minimum
 * (Req 14.1, 14.2).
 *
 * Note: the fully-rendered browser audio call surface (mic capture / realtime
 * playback) is delivered by `CallExperience` (a later task, Req 8.9). This
 * step's responsibility per Req 4.4 is to *start* a test call to the agent using
 * the currently-entered values, which it does by persisting those values and
 * resolving the session the runtime opens for them.
 */

// ---------------------------------------------------------------------------
// Step model
// ---------------------------------------------------------------------------

type StepKey =
  | "template"
  | "name"
  | "voice"
  | "personality"
  | "knowledge"
  | "test"
  | "publish";

interface StepDef {
  readonly key: StepKey;
  readonly label: string;
}

/** The seven ordered creation steps (Req 4.1). */
const STEPS: readonly StepDef[] = [
  { key: "template", label: "Template" },
  { key: "name", label: "Name" },
  { key: "voice", label: "Voice" },
  { key: "personality", label: "Personality" },
  { key: "knowledge", label: "Knowledge" },
  { key: "test", label: "Test call" },
  { key: "publish", label: "Publish" },
] as const;

// ---------------------------------------------------------------------------
// Form state (the subset of the shared draft the seven steps edit)
// ---------------------------------------------------------------------------

interface CreationForm {
  name: string;
  agentType: AgentType | "";
  campus: string;
  voiceId: string;
  personalityTone: string;
  description: string;
  creatorDisplayName: string;
  visibility: "public" | "private";
  previewPrompts: string[];
  representsRealPerson: boolean;
}

const EMPTY_FORM: CreationForm = {
  name: "",
  agentType: "",
  campus: "",
  voiceId: "",
  personalityTone: "",
  description: "",
  creatorDisplayName: "",
  visibility: "public",
  previewPrompts: [],
  representsRealPerson: false,
};

/** The publish result discriminated union returned by `publishAgent`. */
type PublishResult =
  | {
      status: "published";
      agentId: string;
      slug: string;
      callLink: string;
      publishedAt: number;
    }
  | { status: "field_error"; fields: string[]; values: unknown }
  | {
      status: "usage_limit";
      dimension: string;
      limit: number;
      upgradeOption: boolean;
      values: unknown;
    }
  | { status: "consent_required"; values: unknown }
  | { status: "runtime_registration_failed"; values: unknown }
  | { status: "call_link_failed"; values: unknown };

/** Student-facing labels for the required fields a publish `field_error` names. */
const FIELD_ERROR_LABELS: Record<string, string> = {
  name: "Agent name",
  agentType: "Agent type",
  campus: "Campus or school",
  campusTag: "Campus or school",
  voice: "Voice",
  tone: "Personality and tone",
  knowledgeSources: "Knowledge",
  visibility: "Visibility",
  description: "Short description",
  displayName: "Your creator name",
  contactEmail: "Contact email",
  monetizationLink: "Monetization link",
};

// ---------------------------------------------------------------------------
// Presentational chrome (module scope so identity is stable across renders)
// ---------------------------------------------------------------------------

function WizardShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative min-h-screen w-full overflow-x-hidden bg-black text-white">
      <div className="mx-auto w-full max-w-xl px-5 py-8 sm:px-6">
        <header className="mb-6 flex items-center justify-between gap-3">
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

function StepProgress({
  activeIndex,
  savingLabel,
}: {
  activeIndex: number;
  savingLabel: string;
}) {
  return (
    <div className="mb-6">
      <ol className="flex items-center gap-1.5" aria-label="Creation steps">
        {STEPS.map((step, index) => {
          const state =
            index < activeIndex
              ? "done"
              : index === activeIndex
                ? "active"
                : "upcoming";
          return (
            <li key={step.key} className="flex flex-1 flex-col items-center gap-1">
              <span
                className={`h-1.5 w-full rounded-full ${
                  state === "upcoming" ? "bg-white/15" : "bg-[var(--color-primary)]"
                }`}
                aria-hidden="true"
              />
              <span
                className={`text-[10px] leading-tight ${
                  state === "active" ? "text-white" : "text-white/40"
                }`}
              >
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-2 h-4 text-right text-[11px] text-white/40" aria-live="polite">
        {savingLabel}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CreationWizard
// ---------------------------------------------------------------------------

export function CreationWizard({ agentId }: { agentId: string }) {
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();

  const saveDraft = useMutation(api.campus.agents.saveDraft);
  const publishAgent = useMutation(api.campus.agents.publishAgent);
  const addSource = useMutation(api.campus.knowledge.addSource);

  const draftQuery = useQuery(
    api.campus.agents.getDraft,
    isAuthenticated ? { agentId } : "skip"
  );
  const sourcesQuery = useQuery(
    api.campus.knowledge.listSources,
    isAuthenticated ? { agentId } : "skip"
  );

  const [stepIndex, setStepIndex] = useState(0);
  const [form, setForm] = useState<CreationForm>(EMPTY_FORM);
  const initializedRef = useRef(false);

  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const savedSnapshotRef = useRef<string>("");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Knowledge step local input.
  const [knowledgeInput, setKnowledgeInput] = useState("");
  const [addingKnowledge, setAddingKnowledge] = useState(false);
  const [knowledgeError, setKnowledgeError] = useState("");

  // Test-call step.
  const [testStarted, setTestStarted] = useState(false);
  const sessionQuery = useQuery(
    api.campus.session.getSessionConfig,
    testStarted && isAuthenticated ? { agentId } : "skip"
  );

  // Publish step.
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null);
  const [publishError, setPublishError] = useState("");

  const knowledgeSourceCount = sourcesQuery?.length ?? 0;

  // --- Initialize the form from the shared draft (once) ------------------

  useEffect(() => {
    if (initializedRef.current || draftQuery === undefined || draftQuery === null) {
      return;
    }
    const d = draftQuery.draft;
    const next: CreationForm = {
      name: d.name ?? "",
      agentType: d.agentType ?? "",
      campus: d.campusTag ?? "",
      voiceId: d.voiceId ?? "",
      personalityTone: d.personalityTone ?? "",
      description: d.description ?? "",
      creatorDisplayName: d.creatorDisplayName ?? "",
      visibility: d.visibility ?? "public",
      previewPrompts: d.previewPrompts ?? [],
      representsRealPerson: d.representsRealPerson ?? false,
    };
    setForm(next);
    savedSnapshotRef.current = JSON.stringify(next);
    // If the agent already carries a chosen type, skip past the template step.
    if (d.agentType) setStepIndex((prev) => (prev === 0 ? 1 : prev));
    initializedRef.current = true;
  }, [draftQuery]);

  // --- Persist helpers ---------------------------------------------------

  /** Builds the `saveDraft` args from the current form (only edited fields). */
  const buildDraftArgs = useCallback(
    (state: CreationForm) => ({
      agentId,
      name: state.name,
      agentType: state.agentType === "" ? undefined : state.agentType,
      campusTag: state.campus,
      voiceId: state.voiceId,
      personalityTone: state.personalityTone,
      description: state.description,
      creatorDisplayName: state.creatorDisplayName,
      visibility: state.visibility,
      previewPrompts: state.previewPrompts,
      representsRealPerson: state.representsRealPerson,
    }),
    [agentId]
  );

  /** Immediately persists the current form and records the saved snapshot. */
  const flushSave = useCallback(
    async (state: CreationForm): Promise<void> => {
      const snapshot = JSON.stringify(state);
      if (snapshot === savedSnapshotRef.current) return;
      setSaveState("saving");
      try {
        await saveDraft(buildDraftArgs(state));
        savedSnapshotRef.current = snapshot;
        setSaveState("saved");
      } catch {
        // Leave the value in state so nothing is lost; a later change retries.
        setSaveState("idle");
      }
    },
    [saveDraft, buildDraftArgs]
  );

  // Debounced autosave on every form change (Req 4.3). Persists well within the
  // 5-second bound; a pending timer is cleared on unmount.
  useEffect(() => {
    if (!initializedRef.current) return;
    const snapshot = JSON.stringify(form);
    if (snapshot === savedSnapshotRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void flushSave(form);
    }, 1200);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [form, flushSave]);

  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    },
    []
  );

  const patch = useCallback((changes: Partial<CreationForm>) => {
    setForm((prev) => ({ ...prev, ...changes }));
  }, []);

  // --- Template application ---------------------------------------------

  const applyTemplateChoice = useCallback((agentType: AgentType) => {
    const template: CampusTemplate = getTemplate(agentType);
    setForm((prev) => ({
      ...prev,
      agentType,
      // Prefill preset fields, preserving anything the creator already entered.
      personalityTone: prev.personalityTone || template.personalityTone,
      description:
        prev.description || template.presetFields.defaultDescription || "",
      voiceId: prev.voiceId || template.presetFields.defaultVoiceId || "",
      previewPrompts:
        prev.previewPrompts.length > 0
          ? prev.previewPrompts
          : [...template.previewPrompts],
      representsRealPerson:
        agentType === "ai_twin" ? true : prev.representsRealPerson,
    }));
  }, []);

  // --- Navigation --------------------------------------------------------

  const step = STEPS[stepIndex];

  const goNext = useCallback(() => {
    void flushSave(form);
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  }, [flushSave, form]);

  const goBack = useCallback(() => {
    void flushSave(form);
    setStepIndex((i) => Math.max(i - 1, 0));
  }, [flushSave, form]);

  // --- Knowledge step ----------------------------------------------------

  const handleAddKnowledge = useCallback(async () => {
    const text = knowledgeInput.trim();
    if (text.length === 0) return;
    setAddingKnowledge(true);
    setKnowledgeError("");
    try {
      const result = await addSource({
        agentId,
        kind: "instructions",
        textContent: text,
      });
      if (!result.ok) {
        setKnowledgeError(
          "That knowledge couldn't be added — it may be too long. Please shorten it."
        );
        return;
      }
      setKnowledgeInput("");
    } catch {
      setKnowledgeError("Something went wrong adding that. Please try again.");
    } finally {
      setAddingKnowledge(false);
    }
  }, [knowledgeInput, addSource, agentId]);

  // --- Test call step ----------------------------------------------------

  const handleStartTestCall = useCallback(async () => {
    // Start the test call using the values currently entered (Req 4.4): persist
    // them first so the resolved session reflects exactly what's on screen.
    await flushSave(form);
    setTestStarted(true);
  }, [flushSave, form]);

  // --- Publish step ------------------------------------------------------

  const handlePublish = useCallback(async () => {
    setPublishing(true);
    setPublishError("");
    setPublishResult(null);
    try {
      // Flush any pending edits so publish validates the on-screen values.
      await flushSave(form);
      const result = (await publishAgent({ agentId })) as PublishResult;
      setPublishResult(result);
    } catch {
      setPublishError(
        "Publishing didn't complete. Your details are saved — please try again."
      );
    } finally {
      setPublishing(false);
    }
  }, [flushSave, form, publishAgent, agentId]);

  // --- Derived UI helpers ------------------------------------------------

  const nameError = useMemo(() => {
    const len = form.name.trim().length;
    if (len < NAME_MIN || form.name.length > NAME_MAX) {
      return `Your agent's name must be between ${NAME_MIN} and ${NAME_MAX} characters.`;
    }
    return "";
  }, [form.name]);

  const savingLabel =
    saveState === "saving"
      ? "Saving…"
      : saveState === "saved"
        ? "Saved"
        : "";

  const inputClass = "input w-full min-h-[44px]";
  const labelClass = "text-sm font-medium text-white/80";
  const instrClass = "text-xs text-white/50";
  const errorTextClass = "text-xs text-red-400";
  const textareaClass =
    "w-full min-h-[88px] rounded-md border border-[var(--color-border-default)] bg-[var(--color-background-surface)] px-3 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]";

  // --- Auth / load guards ------------------------------------------------

  if (authLoading || (isAuthenticated && draftQuery === undefined)) {
    return (
      <WizardShell>
        <div className="mt-10 flex items-center gap-3 text-white/70">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          <span className="text-sm">Loading your agent…</span>
        </div>
      </WizardShell>
    );
  }

  if (!isAuthenticated) {
    return (
      <WizardShell>
        <h1 className="text-2xl font-bold sm:text-3xl">Sign in to keep building</h1>
        <p className="mt-2 text-sm text-white/60">
          You need to be signed in to edit and publish your agent.
        </p>
        <Link
          href="/campus/create"
          className="btn btn-primary btn-lg mt-6 min-h-[44px] w-full"
        >
          Start over
        </Link>
      </WizardShell>
    );
  }

  if (draftQuery === null) {
    return (
      <WizardShell>
        <h1 className="text-2xl font-bold sm:text-3xl">We couldn&apos;t find that agent</h1>
        <p className="mt-2 text-sm text-white/60">
          It may have been deleted, or it belongs to someone else.
        </p>
        <Link
          href="/campus/create"
          className="btn btn-primary btn-lg mt-6 min-h-[44px] w-full"
        >
          Create a new agent
        </Link>
      </WizardShell>
    );
  }

  // --- Published success view (Req 4.2) ----------------------------------

  if (publishResult?.status === "published") {
    const profileHref = `/campus/a/${publishResult.slug}`;
    return (
      <WizardShell>
        <div className="mt-6 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20">
            <svg
              className="h-8 w-8 text-emerald-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h1 className="mt-6 text-2xl font-bold sm:text-3xl">
            Your AI voice agent is live!
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm text-white/60">
            Share your call link so people on your campus can call{" "}
            {form.name ? `“${form.name}”` : "your agent"}.
          </p>

          <div className="mt-6 rounded-lg border border-[var(--color-border-default)] bg-white/5 p-4 text-left">
            <p className="text-xs text-white/50">Your call link</p>
            <p className="mt-1 break-all text-sm font-medium text-white">
              {publishResult.callLink}
            </p>
          </div>

          <div className="mt-6 flex flex-col gap-3">
            <Link
              href={profileHref}
              className="btn btn-primary btn-lg min-h-[44px] w-full"
              data-testid="creation-view-profile"
            >
              View agent page
            </Link>
            <Link
              href="/campus"
              className="btn btn-outline btn-md min-h-[44px] w-full"
            >
              Back to Dinee Campus
            </Link>
          </div>
        </div>
      </WizardShell>
    );
  }

  // --- Step body ---------------------------------------------------------

  return (
    <WizardShell>
      <StepProgress activeIndex={stepIndex} savingLabel={savingLabel} />

      {/* Near-limit warning + upgrade option from the shared Usage_Meter
          (Req 13.2, 13.3). Renders only when a dimension is near its limit. */}
      <NearLimitBanner />

      {step.key === "template" && (
        <section>
          <h1 className="text-2xl font-bold sm:text-3xl">Choose a template</h1>
          <p className="mt-2 text-sm text-white/60">
            Start from a template made for what you&apos;re building. You can
            change anything later.
          </p>
          <div className="mt-6 grid grid-cols-1 gap-3">
            {listTemplates().map((template) => {
              const option = campusCopy.onboarding.options.find(
                (o) => o.agentType === template.agentType
              );
              const selected = form.agentType === template.agentType;
              return (
                <button
                  key={template.agentType}
                  type="button"
                  onClick={() => applyTemplateChoice(template.agentType)}
                  aria-pressed={selected}
                  className={`card card-content flex min-h-[44px] flex-col gap-1 text-left transition-colors ${
                    selected
                      ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10"
                      : "hover:bg-white/5"
                  }`}
                  data-testid={`creation-template-${template.agentType}`}
                >
                  <span className="text-base font-medium text-white">
                    {option?.label ?? template.agentType}
                  </span>
                  <span className="text-xs text-white/50">
                    {template.presetFields.defaultDescription}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-8 flex justify-end">
            <button
              type="button"
              onClick={goNext}
              disabled={form.agentType === ""}
              className="btn btn-primary btn-md min-h-[44px] disabled:opacity-50"
              data-testid="creation-next"
            >
              Next
            </button>
          </div>
        </section>
      )}

      {step.key === "name" && (
        <section>
          <h1 className="text-2xl font-bold sm:text-3xl">Name your agent</h1>
          <p className="mt-2 text-sm text-white/60">
            Give it a name and tell callers who it is.
          </p>

          <div className="mt-6 space-y-5">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="cw-name" className={labelClass}>
                Agent name
              </label>
              <input
                id="cw-name"
                value={form.name}
                maxLength={NAME_MAX}
                onChange={(e) => patch({ name: e.target.value })}
                placeholder="e.g. Study Buddy"
                className={`${inputClass}${nameError ? " input-error" : ""}`}
              />
              <span className={instrClass}>{form.name.length}/{NAME_MAX}</span>
              {nameError && <span className={errorTextClass}>{nameError}</span>}
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="cw-campus" className={labelClass}>
                Campus or school
              </label>
              <input
                id="cw-campus"
                value={form.campus}
                maxLength={100}
                onChange={(e) => patch({ campus: e.target.value })}
                placeholder="Which campus is this for?"
                className={inputClass}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="cw-description" className={labelClass}>
                Short description
              </label>
              <textarea
                id="cw-description"
                value={form.description}
                maxLength={280}
                onChange={(e) => patch({ description: e.target.value })}
                placeholder="Describe your agent in a sentence or two."
                className={textareaClass}
              />
              <span className={instrClass}>{form.description.length}/280</span>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="cw-display" className={labelClass}>
                Your creator name
              </label>
              <input
                id="cw-display"
                value={form.creatorDisplayName}
                maxLength={50}
                onChange={(e) => patch({ creatorDisplayName: e.target.value })}
                placeholder="The name students see as the creator"
                className={inputClass}
              />
            </div>

            <fieldset className="flex flex-col gap-1.5">
              <legend className={labelClass}>Visibility</legend>
              <div className="grid grid-cols-2 gap-3">
                {(["public", "private"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => patch({ visibility: value })}
                    aria-pressed={form.visibility === value}
                    className={`card card-content min-h-[44px] text-center text-sm font-medium capitalize transition-colors ${
                      form.visibility === value
                        ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-white"
                        : "text-white/70 hover:bg-white/5"
                    }`}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>

          <StepNav
            onBack={goBack}
            onNext={goNext}
            nextDisabled={Boolean(nameError)}
          />
        </section>
      )}

      {step.key === "voice" && (
        <section>
          <h1 className="text-2xl font-bold sm:text-3xl">Pick a voice</h1>
          <p className="mt-2 text-sm text-white/60">
            Choose how your agent sounds when people call it.
          </p>
          <div className="mt-6 grid grid-cols-1 gap-3">
            {CAMPUS_VOICES.map((voice) => {
              const selected = form.voiceId === voice.id;
              return (
                <button
                  key={voice.id}
                  type="button"
                  onClick={() => patch({ voiceId: voice.id })}
                  aria-pressed={selected}
                  className={`card card-content flex min-h-[44px] flex-col gap-1 text-left transition-colors ${
                    selected
                      ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10"
                      : "hover:bg-white/5"
                  }`}
                  data-testid={`creation-voice-${voice.id}`}
                >
                  <span className="text-base font-medium text-white">
                    {voice.label}
                  </span>
                  <span className="text-xs text-white/50">{voice.description}</span>
                </button>
              );
            })}
          </div>
          <StepNav
            onBack={goBack}
            onNext={goNext}
            nextDisabled={form.voiceId === ""}
          />
        </section>
      )}

      {step.key === "personality" && (
        <section>
          <h1 className="text-2xl font-bold sm:text-3xl">Define its personality</h1>
          <p className="mt-2 text-sm text-white/60">
            Set the tone your agent uses, and the sample questions people see.
          </p>

          <div className="mt-6 space-y-5">
            <div className="flex flex-col gap-1.5">
              <span className={labelClass}>Tone presets</span>
              <div className="flex flex-wrap gap-2">
                {CAMPUS_TONES.map((tone) => (
                  <button
                    key={tone.label}
                    type="button"
                    onClick={() => patch({ personalityTone: tone.value })}
                    className={`badge min-h-[44px] px-3 ${
                      form.personalityTone === tone.value
                        ? "badge-primary"
                        : "badge-neutral"
                    }`}
                  >
                    {tone.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="cw-tone" className={labelClass}>
                Personality and tone
              </label>
              <textarea
                id="cw-tone"
                value={form.personalityTone}
                onChange={(e) => patch({ personalityTone: e.target.value })}
                placeholder="How should your agent sound and behave?"
                className={textareaClass}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <span className={labelClass}>Sample questions</span>
              <span className={instrClass}>
                These show on your agent&apos;s page so callers know what to ask.
              </span>
              {form.previewPrompts.map((prompt, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    value={prompt}
                    onChange={(e) => {
                      const next = [...form.previewPrompts];
                      next[index] = e.target.value;
                      patch({ previewPrompts: next });
                    }}
                    className={inputClass}
                    aria-label={`Sample question ${index + 1}`}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      patch({
                        previewPrompts: form.previewPrompts.filter(
                          (_, i) => i !== index
                        ),
                      })
                    }
                    className="btn btn-ghost btn-sm min-h-[44px] min-w-[44px]"
                    aria-label={`Remove sample question ${index + 1}`}
                  >
                    ✕
                  </button>
                </div>
              ))}
              {form.previewPrompts.length < 5 && (
                <button
                  type="button"
                  onClick={() =>
                    patch({ previewPrompts: [...form.previewPrompts, ""] })
                  }
                  className="btn btn-outline btn-sm mt-1 min-h-[44px] self-start"
                >
                  + Add a question
                </button>
              )}
            </div>
          </div>

          <StepNav onBack={goBack} onNext={goNext} />
        </section>
      )}

      {step.key === "knowledge" && (
        <section>
          <h1 className="text-2xl font-bold sm:text-3xl">Add knowledge</h1>
          <p className="mt-2 text-sm text-white/60">
            Tell your agent what it knows. It answers only from what you add here.
          </p>

          <div className="mt-6 space-y-4">
            {knowledgeSourceCount > 0 && (
              <ul className="space-y-2" data-testid="creation-knowledge-list">
                {sourcesQuery?.map((source) => (
                  <li
                    key={source.sourceId}
                    className="rounded-lg border border-[var(--color-border-default)] bg-white/5 p-3"
                  >
                    <p className="text-xs uppercase tracking-wide text-white/40">
                      {source.kind}
                    </p>
                    <p className="mt-1 line-clamp-3 text-sm text-white/80">
                      {source.textContent ??
                        source.fileMeta?.fileName ??
                        "Saved knowledge"}
                    </p>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex flex-col gap-1.5">
              <label htmlFor="cw-knowledge" className={labelClass}>
                What should your agent know?
              </label>
              <textarea
                id="cw-knowledge"
                value={knowledgeInput}
                onChange={(e) => setKnowledgeInput(e.target.value)}
                placeholder="Add facts, details, or instructions your agent should use."
                className={textareaClass}
              />
              {knowledgeError && (
                <span className={errorTextClass} role="alert">
                  {knowledgeError}
                </span>
              )}
              <button
                type="button"
                onClick={handleAddKnowledge}
                disabled={addingKnowledge || knowledgeInput.trim().length === 0}
                className="btn btn-outline btn-md mt-1 min-h-[44px] self-start disabled:opacity-50"
                data-testid="creation-add-knowledge"
              >
                {addingKnowledge ? "Adding…" : "Add knowledge"}
              </button>
            </div>

            {knowledgeSourceCount === 0 && (
              <p className={instrClass}>
                Add at least one thing your agent should know before publishing.
              </p>
            )}
          </div>

          <StepNav
            onBack={goBack}
            onNext={goNext}
            nextDisabled={knowledgeSourceCount === 0}
          />
        </section>
      )}

      {step.key === "test" && (
        <section>
          <h1 className="text-2xl font-bold sm:text-3xl">Test your agent</h1>
          <p className="mt-2 text-sm text-white/60">
            Start a test call using everything you&apos;ve entered so far.
          </p>

          <div className="mt-6">
            {!testStarted ? (
              <button
                type="button"
                onClick={handleStartTestCall}
                className="btn btn-primary btn-lg min-h-[44px] w-full"
                data-testid="creation-start-test-call"
              >
                Start test call
              </button>
            ) : sessionQuery === undefined ? (
              <div className="flex items-center gap-3 text-white/70">
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                <span className="text-sm">Starting your test call…</span>
              </div>
            ) : sessionQuery.available === false ? (
              <div
                className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200"
                role="alert"
              >
                We couldn&apos;t start a test call yet. Make sure you&apos;ve
                picked a voice and added some knowledge, then try again.
              </div>
            ) : (
              <div className="space-y-4" data-testid="creation-test-session">
                <div className="rounded-lg border border-[var(--color-border-default)] bg-white/5 p-4">
                  <p className="text-xs text-white/50">Test call is live with</p>
                  <dl className="mt-2 space-y-1 text-sm">
                    <div className="flex justify-between gap-3">
                      <dt className="text-white/50">Voice</dt>
                      <dd className="text-white">
                        {CAMPUS_VOICES.find((v) => v.id === sessionQuery.voiceId)
                          ?.label ?? sessionQuery.voiceId}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-white/50">Knowledge in use</dt>
                      <dd className="text-white">
                        {sessionQuery.knowledge.length} approved source
                        {sessionQuery.knowledge.length === 1 ? "" : "s"}
                      </dd>
                    </div>
                  </dl>
                </div>
                <details className="rounded-lg border border-[var(--color-border-default)] bg-white/5 p-4">
                  <summary className="cursor-pointer text-sm font-medium text-white/80">
                    What your agent was told
                  </summary>
                  <pre className="mt-3 whitespace-pre-wrap text-xs text-white/60">
                    {sessionQuery.systemPrompt}
                  </pre>
                </details>
                <button
                  type="button"
                  onClick={handleStartTestCall}
                  className="btn btn-outline btn-md min-h-[44px] w-full"
                >
                  Restart with latest changes
                </button>
              </div>
            )}
          </div>

          <StepNav onBack={goBack} onNext={goNext} />
        </section>
      )}

      {step.key === "publish" && (
        <section>
          <h1 className="text-2xl font-bold sm:text-3xl">Publish &amp; share</h1>
          <p className="mt-2 text-sm text-white/60">
            Publish your agent to get a call link you can share with your campus.
          </p>

          <label className="mt-6 flex items-start gap-3 rounded-lg border border-[var(--color-border-default)] bg-white/5 p-4">
            <input
              type="checkbox"
              checked={form.representsRealPerson}
              onChange={(e) => patch({ representsRealPerson: e.target.checked })}
              className="mt-1 h-5 w-5"
            />
            <span className="text-sm text-white/70">
              This agent represents a real person&apos;s voice or likeness.
            </span>
          </label>

          <PublishError result={publishResult} publishError={publishError} />

          <div className="mt-8 flex flex-col gap-3">
            <button
              type="button"
              onClick={handlePublish}
              disabled={publishing}
              className="btn btn-primary btn-lg min-h-[44px] w-full disabled:opacity-60"
              data-testid="creation-publish"
            >
              {publishing
                ? "Publishing…"
                : publishResult
                  ? "Try publishing again"
                  : "Publish my agent"}
            </button>
            <button
              type="button"
              onClick={goBack}
              className="btn btn-ghost btn-md min-h-[44px] w-full"
            >
              Back
            </button>
          </div>
        </section>
      )}
    </WizardShell>
  );
}

// ---------------------------------------------------------------------------
// Small step subcomponents
// ---------------------------------------------------------------------------

function StepNav({
  onBack,
  onNext,
  nextDisabled = false,
}: {
  onBack: () => void;
  onNext: () => void;
  nextDisabled?: boolean;
}) {
  return (
    <div className="mt-8 flex items-center justify-between gap-3">
      <button
        type="button"
        onClick={onBack}
        className="btn btn-ghost btn-md min-h-[44px]"
      >
        Back
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={nextDisabled}
        className="btn btn-primary btn-md min-h-[44px] disabled:opacity-50"
        data-testid="creation-next"
      >
        Next
      </button>
    </div>
  );
}

/**
 * Renders the publish blockers returned by `publishAgent` (Req 4.5, 4.6) — usage
 * limit with an upgrade option, missing voice-clone consent, runtime
 * registration failure, and Call_Link failure — plus any field errors. Entered
 * values are always retained; these are surfaced non-destructively so the
 * creator can fix the issue and retry.
 */
function PublishError({
  result,
  publishError,
}: {
  result: PublishResult | null;
  publishError: string;
}) {
  if (publishError) {
    return (
      <div
        className="mt-6 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300"
        role="alert"
      >
        {publishError}
      </div>
    );
  }
  if (!result || result.status === "published") return null;

  if (result.status === "field_error") {
    return (
      <div
        className="mt-6 rounded-lg border border-red-500/30 bg-red-500/10 p-4"
        role="alert"
      >
        <p className="text-sm font-medium text-red-300">
          A few things need fixing before you can publish:
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-red-300">
          {result.fields.map((field) => (
            <li key={field}>{FIELD_ERROR_LABELS[field] ?? field}</li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-red-300/80">
          Use the steps above to complete these, then publish again.
        </p>
      </div>
    );
  }

  if (result.status === "usage_limit") {
    return (
      <div
        className="mt-6 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4"
        role="alert"
      >
        <p className="text-sm font-medium text-amber-200">
          You&apos;ve reached your free plan limit of {result.limit} agent
          {result.limit === 1 ? "" : "s"}.
        </p>
        <p className="mt-1 text-sm text-amber-200/80">
          Your details are saved. Upgrade to publish more agents.
        </p>
        {result.upgradeOption && (
          <Link
            href="/campus/upgrade?reason=agents"
            className="btn btn-primary btn-sm mt-3 min-h-[44px]"
          >
            See upgrade options
          </Link>
        )}
      </div>
    );
  }

  if (result.status === "consent_required") {
    return (
      <div
        className="mt-6 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200"
        role="alert"
      >
        Because this agent represents a real person, we need consent to use that
        voice or likeness before publishing. Your details are saved.
      </div>
    );
  }

  if (result.status === "runtime_registration_failed") {
    return (
      <div
        className="mt-6 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300"
        role="alert"
      >
        We couldn&apos;t set up your agent for calls just now. Your details are
        saved — please try publishing again.
      </div>
    );
  }

  // call_link_failed
  return (
    <div
      className="mt-6 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300"
      role="alert"
    >
      We couldn&apos;t create your call link just now. Your details are saved —
      please try publishing again.
    </div>
  );
}

export default CreationWizard;
