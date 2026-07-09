"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useConvexAuth, useMutation } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../../../convex/_generated/api";

import { campusCopy, type FieldCopy } from "@/lib/campus/copy";
import { CAMPUS_VOICES, CAMPUS_TONES } from "@/lib/campus/options";
import {
  applyTemplate,
  getTemplate,
  type AgentType,
  type CampusTemplate,
} from "@/lib/campus/templates";
import {
  validateRequiredFields,
  validateOptionalValues,
  type RequiredFieldName,
  type OptionalValueFieldName,
} from "@/lib/campus/validation";

/**
 * Feature: dinee-campus (Task 28.2) — `OnboardingWizard`.
 *
 * The student Onboarding_Flow at `/campus/create`. It begins with the question
 * "What do you want to create?" and its seven options (Req 2.1); selecting one
 * loads the corresponding Template_Library entry and prefills the configurable
 * fields (Req 2.2). It then collects the required and optional fields with the
 * defined per-field labels (Req 2.3, 2.4, 2.6), driving inline errors from the
 * shared pure validators so an empty required field or a malformed contact
 * email / monetization link blocks completion and is identified (Req 2.5, 2.7).
 *
 * If the template entry fails to load, the flow shows an error, preserves the
 * entered values, and offers a retry (Req 2.8). Completion is auth-gated: an
 * unauthenticated creator must sign up / sign in before the flow completes, and
 * the flow resumes automatically once authentication completes (Req 1.4, 1.5,
 * 2.8). On success it creates the Campus_Agent and shows a confirmation
 * (Req 2.9).
 *
 * All strings come from the shared `campusCopy` corpus (no business
 * terminology), the layout renders without horizontal scroll at 360px, and
 * every control meets the 44×44 touch-target minimum (Req 1.6, 2.6, 14.1,
 * 14.2).
 */

type Step = "type" | "details" | "auth" | "done";

/** The full set of onboarding field values held in component state. */
interface FormState {
  name: string;
  agentType: AgentType | "";
  campus: string;
  voiceId: string;
  personalityTone: string;
  knowledge: string;
  visibility: "public" | "private" | "";
  description: string;
  creatorDisplayName: string;
  previewPrompts: string[];
  // Optional fields (Req 2.4)
  socialLink: string;
  clubName: string;
  courseCode: string;
  eventDate: string;
  contactEmail: string;
  monetizationLink: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  agentType: "",
  campus: "",
  voiceId: "",
  personalityTone: "",
  knowledge: "",
  visibility: "public",
  description: "",
  creatorDisplayName: "",
  previewPrompts: [],
  socialLink: "",
  clubName: "",
  courseCode: "",
  eventDate: "",
  contactEmail: "",
  monetizationLink: "",
};

/** sessionStorage key used to survive an accidental remount during auth. */
const DRAFT_STORAGE_KEY = "campus.onboarding.draft.v1";

/** Maps a required-validator field name to the copy key that labels it. */
const REQUIRED_FIELD_TO_COPY_KEY: Record<RequiredFieldName, string> = {
  name: "name",
  agentType: "agentType",
  campus: "campus",
  voice: "voice",
  tone: "personalityTone",
  knowledgeSources: "knowledge",
  visibility: "visibility",
  description: "description",
  displayName: "creatorDisplayName",
};

/** Maps an optional-validator field name to the copy key that labels it. */
const OPTIONAL_FIELD_TO_COPY_KEY: Record<OptionalValueFieldName, string> = {
  contactEmail: "contactEmail",
  monetizationLink: "monetizationLink",
};

/**
 * The shared wizard chrome (background, width constraint, header). Defined at
 * module scope — NOT inside `OnboardingWizard` — so its component identity is
 * stable across renders; a nested component would be a new type every render
 * and remount the form on each keystroke, dropping input focus.
 */
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

/** Flat lookup of every field's copy (label + instruction) by its stable key. */
const FIELD_COPY_BY_KEY: ReadonlyMap<string, FieldCopy> = new Map(
  [...campusCopy.requiredFields, ...campusCopy.optionalFields].map((field) => [
    field.key,
    field,
  ])
);

/** Resolves the student-facing label for a copy key (falls back to the key). */
function labelFor(copyKey: string): string {
  return FIELD_COPY_BY_KEY.get(copyKey)?.label ?? copyKey;
}

/** Parses a `yyyy-mm-dd` date input into a UTC timestamp, or `undefined`. */
function parseEventDate(value: string): number | undefined {
  if (!value) return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : ms;
}

export function OnboardingWizard() {
  const { isAuthenticated } = useConvexAuth();
  const { signIn } = useAuthActions();
  const saveDraft = useMutation(api.campus.agents.saveDraft);
  const addSource = useMutation(api.campus.knowledge.addSource);

  const [step, setStep] = useState<Step>("type");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  // Template loading state (Req 2.2, 2.8).
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateLoadError, setTemplateLoadError] = useState(false);
  const [pendingType, setPendingType] = useState<AgentType | null>(null);

  // Validation + submission state.
  const [requiredErrors, setRequiredErrors] = useState<Set<RequiredFieldName>>(
    new Set()
  );
  const [optionalErrors, setOptionalErrors] = useState<
    Set<OptionalValueFieldName>
  >(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [createdAgentId, setCreatedAgentId] = useState<string | null>(null);

  // Inline auth (Req 1.4, 1.5) state.
  const [authFlow, setAuthFlow] = useState<"signIn" | "signUp">("signUp");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const resumeAfterAuth = useRef(false);

  // Restore an in-progress draft (safety net if the component remounts).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.sessionStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as Partial<FormState>;
      setForm((prev) => ({ ...prev, ...saved }));
      if (saved.agentType) setStep("details");
    } catch {
      window.sessionStorage.removeItem(DRAFT_STORAGE_KEY);
    }
  }, []);

  const patch = useCallback((changes: Partial<FormState>) => {
    setForm((prev) => ({ ...prev, ...changes }));
  }, []);

  // --- Template selection + load (Req 2.1, 2.2, 2.8) ---------------------

  const loadTemplate = useCallback((agentType: AgentType) => {
    setPendingType(agentType);
    setTemplateLoadError(false);
    setTemplateLoading(true);
    // The Template_Library is bundled, so resolution is local; we still model it
    // as an async load with a failure/retry path so a future networked source
    // fits without changing the flow (Req 2.8).
    Promise.resolve()
      .then(() => {
        const template: CampusTemplate | undefined = getTemplate(agentType);
        if (!template) throw new Error("template_not_found");
        // Prefill configurable fields from the template while preserving any
        // values the creator already entered (Req 2.2, 3.3, 3.5).
        setForm((prev) => {
          const prefilled = applyTemplate(
            {
              name: prev.name || undefined,
              campusTag: prev.campus || undefined,
              creatorDisplayName: prev.creatorDisplayName || undefined,
              visibility: prev.visibility || undefined,
            },
            template
          );
          return {
            ...prev,
            agentType,
            personalityTone: prev.personalityTone || prefilled.personalityTone || "",
            description: prev.description || prefilled.description || "",
            voiceId: prev.voiceId || prefilled.voiceId || "",
            previewPrompts:
              prev.previewPrompts.length > 0
                ? prev.previewPrompts
                : prefilled.previewPrompts ?? [],
          };
        });
        setTemplateLoading(false);
        setStep("details");
      })
      .catch(() => {
        setTemplateLoading(false);
        setTemplateLoadError(true);
      });
  }, []);

  const retryTemplateLoad = useCallback(() => {
    if (pendingType) loadTemplate(pendingType);
  }, [pendingType, loadTemplate]);

  // --- Create the Campus_Agent (Req 2.9) --------------------------------

  const persistAgent = useCallback(async (): Promise<void> => {
    setSubmitting(true);
    setSubmitError("");
    try {
      const draftResult = await saveDraft({
        name: form.name,
        agentType: form.agentType === "" ? undefined : form.agentType,
        campusTag: form.campus,
        voiceId: form.voiceId,
        personalityTone: form.personalityTone,
        description: form.description,
        creatorDisplayName: form.creatorDisplayName,
        previewPrompts: form.previewPrompts,
        visibility: form.visibility === "" ? undefined : form.visibility,
        monetizationLink: form.monetizationLink || undefined,
        optional: {
          socialLink: form.socialLink || undefined,
          clubName: form.clubName || undefined,
          courseCode: form.courseCode || undefined,
          eventDate: parseEventDate(form.eventDate),
          contactEmail: form.contactEmail || undefined,
        },
      });

      const agentId = draftResult.agentId;

      // Attach the entered knowledge as the agent's first Knowledge_Source so
      // the created agent satisfies the "at least one Knowledge_Source"
      // requirement it was validated against (Req 2.3, 5.1, 5.2).
      const knowledge = form.knowledge.trim();
      if (knowledge.length > 0) {
        await addSource({
          agentId,
          kind: "instructions",
          textContent: knowledge,
        });
      }

      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(DRAFT_STORAGE_KEY);
      }
      setCreatedAgentId(agentId);
      resumeAfterAuth.current = false;
      setStep("done");
    } catch {
      setSubmitError(
        "Something went wrong creating your agent. Your details are saved — please try again."
      );
    } finally {
      setSubmitting(false);
    }
  }, [form, saveDraft, addSource]);

  // Validates required + optional fields; returns true when the flow may
  // complete. Populates the inline error sets otherwise (Req 2.5, 2.7).
  const validateAll = useCallback((): boolean => {
    const requiredFailing = validateRequiredFields({
      name: form.name,
      agentType: form.agentType || null,
      campus: form.campus,
      voice: form.voiceId,
      tone: form.personalityTone,
      knowledgeSourceCount: form.knowledge.trim().length > 0 ? 1 : 0,
      visibility: form.visibility || null,
      description: form.description,
      displayName: form.creatorDisplayName,
    });
    const optionalFailing = validateOptionalValues({
      contactEmail: form.contactEmail || null,
      monetizationLink: form.monetizationLink || null,
    });
    setRequiredErrors(new Set(requiredFailing));
    setOptionalErrors(new Set(optionalFailing));
    return requiredFailing.length === 0 && optionalFailing.length === 0;
  }, [form]);

  const handleComplete = useCallback(() => {
    if (!validateAll()) return;

    if (!isAuthenticated) {
      // Stash the entered values and gate on auth before completing (Req 1.4).
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(form));
      }
      resumeAfterAuth.current = true;
      setStep("auth");
      return;
    }
    void persistAgent();
  }, [validateAll, isAuthenticated, form, persistAgent]);

  // Resume completion automatically once authentication completes (Req 1.5).
  useEffect(() => {
    if (
      step === "auth" &&
      isAuthenticated &&
      resumeAfterAuth.current &&
      !submitting
    ) {
      void persistAgent();
    }
  }, [step, isAuthenticated, submitting, persistAgent]);

  const handleAuthSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setAuthError("");
      if (!email.trim() || !password) {
        setAuthError("Please enter your email and password.");
        return;
      }
      setAuthSubmitting(true);
      try {
        await signIn("password", { email, password, flow: authFlow });
        // The resume effect completes the flow once `isAuthenticated` flips.
      } catch {
        setAuthError(
          authFlow === "signUp"
            ? "Could not create your account. Try a different email or sign in."
            : "Invalid email or password."
        );
      } finally {
        setAuthSubmitting(false);
      }
    },
    [email, password, authFlow, signIn]
  );

  const requiredErrorList = useMemo(
    () => Array.from(requiredErrors).map((f) => labelFor(REQUIRED_FIELD_TO_COPY_KEY[f])),
    [requiredErrors]
  );

  // --- Shared presentational helpers ------------------------------------

  const inputClass = "input w-full min-h-[44px]";
  const labelClass = "text-sm font-medium text-white/80";
  const instrClass = "text-xs text-white/50";
  const errorTextClass = "text-xs text-red-400";
  const textareaClass =
    "w-full min-h-[88px] rounded-md border border-[var(--color-border-default)] bg-[var(--color-background-surface)] px-3 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]";

  const instructionFor = (key: string): string =>
    FIELD_COPY_BY_KEY.get(key)?.instruction ?? "";

  const reqErr = (field: RequiredFieldName): boolean => requiredErrors.has(field);
  const optErr = (field: OptionalValueFieldName): boolean =>
    optionalErrors.has(field);

  // --- Step: choose what to create (Req 2.1, 2.2, 2.8) ------------------

  if (step === "type") {
    return (
      <WizardShell>
        <h1 className="text-2xl font-bold sm:text-3xl">
          {campusCopy.onboarding.firstQuestion}
        </h1>
        <p className="mt-2 text-sm text-white/60">
          Pick what you want to build. We&apos;ll set up a starting template you
          can change.
        </p>

        {templateLoadError && (
          <div
            className="mt-5 rounded-lg border border-red-500/30 bg-red-500/10 p-4"
            role="alert"
          >
            <p className="text-sm text-red-300">
              We couldn&apos;t load that template. Your details are safe.
            </p>
            <button
              type="button"
              onClick={retryTemplateLoad}
              className="btn btn-outline btn-sm mt-3 min-h-[44px]"
            >
              Try again
            </button>
          </div>
        )}

        <div className="mt-6 grid grid-cols-1 gap-3">
          {campusCopy.onboarding.options.map((option) => {
            const isLoadingThis =
              templateLoading && pendingType === option.agentType;
            return (
              <button
                key={option.agentType}
                type="button"
                onClick={() => loadTemplate(option.agentType)}
                disabled={templateLoading}
                aria-busy={isLoadingThis}
                className="card card-content flex min-h-[44px] items-center justify-between gap-3 text-left transition-colors hover:bg-white/5 disabled:opacity-60"
                data-testid={`onboarding-option-${option.agentType}`}
              >
                <span className="text-base font-medium text-white">
                  {option.label}
                </span>
                <span className="text-white/40" aria-hidden="true">
                  {isLoadingThis ? "…" : "→"}
                </span>
              </button>
            );
          })}
        </div>
      </WizardShell>
    );
  }

  // --- Step: collect the required + optional fields (Req 2.3–2.7) -------

  if (step === "details") {
    const selectedOption = campusCopy.onboarding.options.find(
      (o) => o.agentType === form.agentType
    );
    return (
      <WizardShell>
        <h1 className="text-2xl font-bold sm:text-3xl">Set up your agent</h1>

        {/* Chosen type + change affordance */}
        <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border-default)] bg-white/5 px-4 py-3">
          <div>
            <p className="text-xs text-white/50">Creating</p>
            <p className="text-sm font-medium text-white">
              {selectedOption?.label ?? "Agent"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setStep("type")}
            className="btn btn-ghost btn-sm min-h-[44px]"
          >
            Change
          </button>
        </div>

        {/* Error summary identifying each empty/invalid field (Req 2.5, 2.7) */}
        {(requiredErrorList.length > 0 || optionalErrors.size > 0) && (
          <div
            className="mt-5 rounded-lg border border-red-500/30 bg-red-500/10 p-4"
            role="alert"
          >
            <p className="text-sm font-medium text-red-300">
              Please fix these before creating your agent:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-red-300">
              {requiredErrorList.map((label) => (
                <li key={label}>{label} is required</li>
              ))}
              {optErr("contactEmail") && (
                <li>{labelFor("contactEmail")} is not a valid email</li>
              )}
              {optErr("monetizationLink") && (
                <li>{labelFor("monetizationLink")} is not a valid link</li>
              )}
            </ul>
          </div>
        )}

        <form
          className="mt-6 space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            handleComplete();
          }}
          noValidate
        >
          {/* Name */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="name" className={labelClass}>
              {labelFor("name")}
            </label>
            <input
              id="name"
              value={form.name}
              maxLength={50}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder={instructionFor("name")}
              className={`${inputClass}${reqErr("name") ? " input-error" : ""}`}
            />
            <span className={instrClass}>{form.name.length}/50</span>
          </div>

          {/* Campus / school */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="campus" className={labelClass}>
              {labelFor("campus")}
            </label>
            <input
              id="campus"
              value={form.campus}
              maxLength={100}
              onChange={(e) => patch({ campus: e.target.value })}
              placeholder={instructionFor("campus")}
              className={`${inputClass}${reqErr("campus") ? " input-error" : ""}`}
            />
          </div>

          {/* Voice */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="voice" className={labelClass}>
              {labelFor("voice")}
            </label>
            <select
              id="voice"
              value={form.voiceId}
              onChange={(e) => patch({ voiceId: e.target.value })}
              className={`${inputClass}${reqErr("voice") ? " input-error" : ""}`}
            >
              <option value="">Choose a voice…</option>
              {CAMPUS_VOICES.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voice.label} — {voice.description}
                </option>
              ))}
            </select>
          </div>

          {/* Personality / tone */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="tone" className={labelClass}>
              {labelFor("personalityTone")}
            </label>
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
            <textarea
              id="tone"
              value={form.personalityTone}
              onChange={(e) => patch({ personalityTone: e.target.value })}
              placeholder={instructionFor("personalityTone")}
              className={`${textareaClass}${
                reqErr("tone") ? " input-error" : ""
              }`}
            />
          </div>

          {/* Knowledge */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="knowledge" className={labelClass}>
              {labelFor("knowledge")}
            </label>
            <textarea
              id="knowledge"
              value={form.knowledge}
              onChange={(e) => patch({ knowledge: e.target.value })}
              placeholder={instructionFor("knowledge")}
              className={`${textareaClass}${
                reqErr("knowledgeSources") ? " input-error" : ""
              }`}
            />
            {reqErr("knowledgeSources") && (
              <span className={errorTextClass}>
                Add at least one thing your agent should know.
              </span>
            )}
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="description" className={labelClass}>
              {labelFor("description")}
            </label>
            <textarea
              id="description"
              value={form.description}
              maxLength={280}
              onChange={(e) => patch({ description: e.target.value })}
              placeholder={instructionFor("description")}
              className={`${textareaClass}${
                reqErr("description") ? " input-error" : ""
              }`}
            />
            <span className={instrClass}>{form.description.length}/280</span>
          </div>

          {/* Creator display name */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="displayName" className={labelClass}>
              {labelFor("creatorDisplayName")}
            </label>
            <input
              id="displayName"
              value={form.creatorDisplayName}
              maxLength={50}
              onChange={(e) => patch({ creatorDisplayName: e.target.value })}
              placeholder={instructionFor("creatorDisplayName")}
              className={`${inputClass}${
                reqErr("displayName") ? " input-error" : ""
              }`}
            />
          </div>

          {/* Visibility */}
          <fieldset className="flex flex-col gap-1.5">
            <legend className={labelClass}>{labelFor("visibility")}</legend>
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

          {/* Optional fields (Req 2.4) */}
          <details className="rounded-lg border border-[var(--color-border-default)] bg-white/5 p-4">
            <summary className="cursor-pointer text-sm font-medium text-white/80">
              Optional details
            </summary>
            <div className="mt-4 space-y-5">
              {(
                [
                  ["socialLink", "socialLink", "text"],
                  ["clubName", "clubName", "text"],
                  ["courseCode", "courseCode", "text"],
                  ["eventDate", "eventDate", "date"],
                  ["contactEmail", "contactEmail", "email"],
                  ["monetizationLink", "monetizationLink", "url"],
                ] as const
              ).map(([field, copyKey, type]) => {
                const showError =
                  (copyKey === "contactEmail" && optErr("contactEmail")) ||
                  (copyKey === "monetizationLink" && optErr("monetizationLink"));
                return (
                  <div key={field} className="flex flex-col gap-1.5">
                    <label htmlFor={field} className={labelClass}>
                      {labelFor(copyKey)}
                    </label>
                    <input
                      id={field}
                      type={type}
                      value={form[field]}
                      onChange={(e) =>
                        patch({ [field]: e.target.value } as Partial<FormState>)
                      }
                      placeholder={instructionFor(copyKey)}
                      className={`${inputClass}${showError ? " input-error" : ""}`}
                    />
                    {showError && (
                      <span className={errorTextClass}>
                        Enter a valid {labelFor(copyKey).toLowerCase()}.
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </details>

          {submitError && (
            <p className={errorTextClass} role="alert">
              {submitError}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="btn btn-primary btn-lg min-h-[44px] w-full"
            data-testid="onboarding-complete"
          >
            {submitting ? "Creating…" : "Create my agent"}
          </button>
        </form>
      </WizardShell>
    );
  }

  // --- Step: inline auth gate before completion (Req 1.4, 1.5, 2.8) -----

  if (step === "auth") {
    // While authenticated, the resume effect is finishing creation.
    const resuming = isAuthenticated || submitting;
    return (
      <WizardShell>
        <h1 className="text-2xl font-bold sm:text-3xl">
          {authFlow === "signUp" ? "Create your account" : "Welcome back"}
        </h1>
        <p className="mt-2 text-sm text-white/60">
          {resuming
            ? "Finishing up — creating your agent…"
            : "Sign in to finish creating your agent. Your details are saved."}
        </p>

        {resuming ? (
          <div className="mt-8 flex items-center gap-3 text-white/70">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            <span className="text-sm">Creating your agent…</span>
          </div>
        ) : (
          <>
            {authError && (
              <div
                className="mt-5 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300"
                role="alert"
              >
                {authError}
              </div>
            )}

            <form onSubmit={handleAuthSubmit} className="mt-6 space-y-5" noValidate>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="auth-email" className={labelClass}>
                  Email
                </label>
                <input
                  id="auth-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@school.edu"
                  autoComplete="email"
                  className={inputClass}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="auth-password" className={labelClass}>
                  Password
                </label>
                <input
                  id="auth-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter a password"
                  autoComplete={
                    authFlow === "signUp" ? "new-password" : "current-password"
                  }
                  className={inputClass}
                />
              </div>
              <button
                type="submit"
                disabled={authSubmitting}
                className="btn btn-primary btn-lg min-h-[44px] w-full"
              >
                {authSubmitting
                  ? "Please wait…"
                  : authFlow === "signUp"
                    ? "Create account & finish"
                    : "Sign in & finish"}
              </button>
            </form>

            <button
              type="button"
              onClick={() => {
                setAuthError("");
                setAuthFlow((f) => (f === "signUp" ? "signIn" : "signUp"));
              }}
              className="btn btn-ghost btn-sm mt-4 min-h-[44px] w-full"
            >
              {authFlow === "signUp"
                ? "Already have an account? Sign in"
                : "Need an account? Create one"}
            </button>
          </>
        )}
      </WizardShell>
    );
  }

  // --- Step: creation confirmation (Req 2.9) ----------------------------

  return (
    <WizardShell>
      <div className="mt-8 text-center">
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
          Your AI voice agent is created!
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm text-white/60">
          {form.name ? `“${form.name}” ` : "Your agent "}
          is saved. Keep building to add more knowledge, test a call, and publish
          a call link to share with your campus.
        </p>

        <div className="mt-8 flex flex-col gap-3">
          <Link
            href={
              createdAgentId
                ? `/campus/create?agentId=${encodeURIComponent(createdAgentId)}`
                : "/campus/create"
            }
            className="btn btn-primary btn-lg min-h-[44px] w-full"
            data-testid="onboarding-done-continue"
          >
            Keep building
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

export default OnboardingWizard;
