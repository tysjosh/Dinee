"use client";

/**
 * Runsheet Admin configuration UI (Dinee-owned, configuration only).
 *
 * This page lets a Runsheet_Admin configure the Runsheet integration for their
 * tenant. It is strictly a configuration surface — it is NOT a dispatcher
 * review queue (the review queue is owned and rendered by the Runsheet backend,
 * per the ownership boundary in the design).
 *
 * Capabilities:
 *   - Configure the integration (base URL, tenant id, API key, webhook secret,
 *     default review mode, allowed conversation types) via the
 *     `saveIntegration` action + `getIntegration` query.
 *   - Run a credential test (`testCredential` action).
 *   - Assign a Dinee-managed phone number to a conversation type
 *     (`numberAssignments.assignNumber`).
 *   - Configure an Escalation_Target (phone / email / webhook).
 *
 * Auto_Submit (Req 9.3): now that the Auto_Submit feature (Requirement 13) is
 * delivered, this page surfaces an accessible Auto_Submit enable/disable toggle
 * bound to `autoSubmitEnabled`. When enabled, an optional Confidence_Score
 * threshold can be configured because `auto_submit_low_risk` gates on it.
 *
 * Requirements: 8.1, 8.2, 8.4, 8.5, 9.1, 9.3, 9.4
 */

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../../../../convex/_generated/api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { runsheetConversationTypes } from "@/lib/modules/packs/runsheet/conversationTypes";
import {
  validateEscalationTarget,
  ESCALATION_TARGET_KINDS,
  type EscalationTargetKind,
} from "@/lib/integrations/runsheet/configValidation";

// The four conversation types the Runsheet pack owns (Req 4.1). Sourced from
// the pack definition so the UI never drifts from the registered types.
const RUNSHEET_CONVERSATION_TYPES = runsheetConversationTypes.map((c) => c.type);

const REVIEW_MODES = [
  { value: "always_review", label: "Always review" },
  { value: "auto_submit_low_risk", label: "Auto-submit low risk" },
] as const;

type ReviewMode = (typeof REVIEW_MODES)[number]["value"];

function humanizeConversationType(type: string): string {
  return type
    .replace(/^runsheet_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function RunsheetIntegrationPage() {
  const router = useRouter();
  const { user, isLoading: userLoading } = useCurrentUser();
  const tenantId = user?.tenantId ?? "";

  // --- Convex bindings -------------------------------------------------------
  const integration = useQuery(
    api.runsheet.integrationsData.getIntegration,
    tenantId ? { tenantId } : "skip"
  );
  const saveIntegration = useAction(api.runsheet.integrations.saveIntegration);
  const testCredential = useAction(api.runsheet.integrations.testCredential);
  const assignNumber = useMutation(api.runsheet.numberAssignments.assignNumber);

  // --- Integration config form state ----------------------------------------
  const [baseUrl, setBaseUrl] = useState("");
  const [runsheetTenantId, setRunsheetTenantId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [defaultReviewMode, setDefaultReviewMode] =
    useState<ReviewMode>("always_review");
  const [allowedConversationTypes, setAllowedConversationTypes] = useState<
    string[]
  >([]);

  // Auto_Submit (Req 9.3): enable/disable toggle plus the optional
  // Confidence_Score threshold that `auto_submit_low_risk` gates on. The
  // threshold is held as a string so the input can be cleared; it is parsed and
  // validated on save.
  const [autoSubmitEnabled, setAutoSubmitEnabled] = useState(false);
  const [confidenceThreshold, setConfidenceThreshold] = useState("");

  // Per-tenant purchase-order requirement (Req 5.6). Feeds the fuel-intake slot
  // builder's RunsheetTenantConfig so the PO slot is required for this tenant.
  const [requiresPurchaseOrder, setRequiresPurchaseOrder] = useState(false);

  // Escalation target (part of the integration config, Req 9.4).
  const [escalationKind, setEscalationKind] = useState<EscalationTargetKind | "">(
    ""
  );
  const [escalationValue, setEscalationValue] = useState("");

  // Field-scoped validation errors (surfaced inline).
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<
    | { kind: "idle" }
    | { kind: "saving" }
    | { kind: "saved" }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  // Hydrate the form from the stored integration once it loads. The API key and
  // webhook secret are never returned (only apiKeyLast4), so those inputs stay
  // empty and are only sent when the admin enters a new value.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (integration && !hydrated) {
      setBaseUrl(integration.baseUrl ?? "");
      setRunsheetTenantId(integration.runsheetTenantId ?? "");
      setDefaultReviewMode(
        (integration.defaultReviewMode as ReviewMode) ?? "always_review"
      );
      setAllowedConversationTypes(integration.allowedConversationTypes ?? []);
      setAutoSubmitEnabled(integration.autoSubmitEnabled ?? false);
      setRequiresPurchaseOrder(integration.requiresPurchaseOrder ?? false);
      setConfidenceThreshold(
        integration.confidenceThreshold != null
          ? String(integration.confidenceThreshold)
          : ""
      );
      if (integration.escalationTarget) {
        setEscalationKind(
          integration.escalationTarget.kind as EscalationTargetKind
        );
        setEscalationValue(integration.escalationTarget.value ?? "");
      }
      setHydrated(true);
    }
  }, [integration, hydrated]);

  const toggleAllowedType = (type: string) => {
    setAllowedConversationTypes((prev) =>
      prev.includes(type)
        ? prev.filter((t) => t !== type)
        : [...prev, type]
    );
  };

  const clearFieldError = (field: string) =>
    setFieldErrors((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveState({ kind: "saving" });

    const errors: Record<string, string> = {};

    // Client-side required-field checks mirror the server contract so the admin
    // gets immediate inline feedback (server remains the source of truth).
    if (!baseUrl.trim()) errors.baseUrl = "Base URL is required";
    if (!runsheetTenantId.trim())
      errors.runsheetTenantId = "Tenant identifier is required";
    // API key is required on first configuration; when an integration already
    // exists it may be left blank to keep the stored key.
    if (!apiKey.trim() && !integration?.apiKeyLast4)
      errors.apiKey = "API key is required";

    // Auto_Submit confidence threshold (Req 9.3 / Req 13): optional, but when
    // provided it must be a number in the inclusive range 0.0–1.0 because it is
    // compared against the Confidence_Score.
    let parsedConfidenceThreshold: number | undefined;
    if (confidenceThreshold.trim()) {
      const parsed = Number(confidenceThreshold.trim());
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
        errors.confidenceThreshold =
          "Confidence threshold must be a number between 0 and 1";
      } else {
        parsedConfidenceThreshold = parsed;
      }
    }

    // Escalation target (Req 9.4): validate only when a value is supplied.
    let escalationTarget:
      | { kind: EscalationTargetKind; value: string }
      | undefined;
    if (escalationKind || escalationValue.trim()) {
      const result = validateEscalationTarget({
        kind: escalationKind,
        value: escalationValue.trim(),
      });
      if (!result.ok) {
        errors.escalationTarget = result.error.detail;
      } else {
        escalationTarget = result.target as {
          kind: EscalationTargetKind;
          value: string;
        };
      }
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setSaveState({ kind: "idle" });
      return;
    }

    try {
      const result = await saveIntegration({
        tenantId,
        baseUrl: baseUrl.trim(),
        runsheetTenantId: runsheetTenantId.trim(),
        // When editing an existing integration and the field is blank, resend
        // the current key is not possible (never returned), so an empty string
        // would fail server validation — guard requires a value on create only.
        apiKey: apiKey.trim(),
        webhookSecret: webhookSecret.trim(),
        defaultReviewMode,
        allowedConversationTypes,
        // Req 9.3: Auto_Submit is now admin-configurable. Send the toggle value
        // and, when a threshold was entered, the validated Confidence_Score
        // threshold; otherwise omit it so the backend clears/keeps its default.
        autoSubmitEnabled,
        confidenceThreshold: parsedConfidenceThreshold,
        // Req 5.6: per-tenant purchase-order requirement for the fuel-intake
        // slot builder.
        requiresPurchaseOrder,
        escalationTarget,
        actorUserId: user?.userId,
        actorRole: user?.role,
      });

      if (!result.success) {
        // Map the offending field back to an inline error (Req 8.6, 8.7).
        setFieldErrors({ [result.field]: result.error });
        setSaveState({
          kind: "error",
          message: result.error,
        });
        return;
      }

      setFieldErrors({});
      setApiKey("");
      setWebhookSecret("");
      setSaveState({ kind: "saved" });
    } catch (err) {
      setSaveState({
        kind: "error",
        message:
          err instanceof Error ? err.message : "Failed to save integration",
      });
    }
  };

  if (userLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-700 border-t-emerald-500 mx-auto" />
          <p className="text-gray-400 text-sm">Loading integration…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-black border-b border-gray-800">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => router.push("/client/dashboard")}
                className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
                aria-label="Back to dashboard"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 19l-7-7 7-7"
                  />
                </svg>
              </button>
              <div>
                <h1 className="text-lg font-semibold text-white">
                  Runsheet Integration
                </h1>
                <p className="text-sm text-gray-400">
                  Configure the Runsheet voice connection for your tenant
                </p>
              </div>
            </div>
            <ConnectionBadge status={integration?.status} />
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Integration configuration */}
        <IntegrationConfigCard
          baseUrl={baseUrl}
          runsheetTenantId={runsheetTenantId}
          apiKey={apiKey}
          webhookSecret={webhookSecret}
          defaultReviewMode={defaultReviewMode}
          allowedConversationTypes={allowedConversationTypes}
          autoSubmitEnabled={autoSubmitEnabled}
          confidenceThreshold={confidenceThreshold}
          requiresPurchaseOrder={requiresPurchaseOrder}
          escalationKind={escalationKind}
          escalationValue={escalationValue}
          apiKeyLast4={integration?.apiKeyLast4}
          fieldErrors={fieldErrors}
          saveState={saveState}
          onBaseUrl={(v) => {
            setBaseUrl(v);
            clearFieldError("baseUrl");
          }}
          onRunsheetTenantId={(v) => {
            setRunsheetTenantId(v);
            clearFieldError("runsheetTenantId");
          }}
          onApiKey={(v) => {
            setApiKey(v);
            clearFieldError("apiKey");
          }}
          onWebhookSecret={setWebhookSecret}
          onReviewMode={(v) => {
            setDefaultReviewMode(v);
            clearFieldError("defaultReviewMode");
          }}
          onToggleType={toggleAllowedType}
          onAutoSubmitEnabled={setAutoSubmitEnabled}
          onConfidenceThreshold={(v) => {
            setConfidenceThreshold(v);
            clearFieldError("confidenceThreshold");
          }}
          onRequiresPurchaseOrder={setRequiresPurchaseOrder}
          onEscalationKind={(v) => {
            setEscalationKind(v);
            clearFieldError("escalationTarget");
          }}
          onEscalationValue={(v) => {
            setEscalationValue(v);
            clearFieldError("escalationTarget");
          }}
          onSubmit={handleSave}
        />

        {/* Credential test */}
        <CredentialTestCard
          tenantId={tenantId}
          baseUrl={baseUrl}
          runsheetTenantId={runsheetTenantId}
          apiKey={apiKey}
          testCredential={testCredential}
        />

        {/* Number assignment */}
        <NumberAssignmentCard
          tenantId={tenantId}
          allowedConversationTypes={
            integration?.allowedConversationTypes ?? allowedConversationTypes
          }
          assignNumber={assignNumber}
        />
      </main>
    </div>
  );
}

// ============================================================================
// Connection status badge
// ============================================================================

function ConnectionBadge({ status }: { status?: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    connected: { cls: "badge badge-success", label: "Connected" },
    disconnected: { cls: "badge badge-neutral", label: "Disconnected" },
    error: { cls: "badge badge-danger", label: "Error" },
  };
  const entry = status ? map[status] : undefined;
  return (
    <span className={entry?.cls ?? "badge badge-neutral"}>
      {entry?.label ?? "Not configured"}
    </span>
  );
}

// ============================================================================
// Integration configuration card
// ============================================================================

interface IntegrationConfigCardProps {
  baseUrl: string;
  runsheetTenantId: string;
  apiKey: string;
  webhookSecret: string;
  defaultReviewMode: ReviewMode;
  allowedConversationTypes: string[];
  autoSubmitEnabled: boolean;
  confidenceThreshold: string;
  requiresPurchaseOrder: boolean;
  escalationKind: EscalationTargetKind | "";
  escalationValue: string;
  apiKeyLast4?: string;
  fieldErrors: Record<string, string>;
  saveState:
    | { kind: "idle" }
    | { kind: "saving" }
    | { kind: "saved" }
    | { kind: "error"; message: string };
  onBaseUrl: (v: string) => void;
  onRunsheetTenantId: (v: string) => void;
  onApiKey: (v: string) => void;
  onWebhookSecret: (v: string) => void;
  onReviewMode: (v: ReviewMode) => void;
  onToggleType: (type: string) => void;
  onAutoSubmitEnabled: (v: boolean) => void;
  onConfidenceThreshold: (v: string) => void;
  onRequiresPurchaseOrder: (v: boolean) => void;
  onEscalationKind: (v: EscalationTargetKind | "") => void;
  onEscalationValue: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
}

function IntegrationConfigCard(props: IntegrationConfigCardProps) {
  const {
    baseUrl,
    runsheetTenantId,
    apiKey,
    webhookSecret,
    defaultReviewMode,
    allowedConversationTypes,
    autoSubmitEnabled,
    confidenceThreshold,
    requiresPurchaseOrder,
    escalationKind,
    escalationValue,
    apiKeyLast4,
    fieldErrors,
    saveState,
  } = props;

  return (
    <section className="card" aria-labelledby="config-heading">
      <div className="card-header">
        <h2 id="config-heading" className="text-base font-semibold text-white">
          Connection configuration
        </h2>
        <p className="text-sm text-gray-400">
          Credentials are encrypted at rest; the API key and webhook secret are
          never displayed after saving.
        </p>
      </div>
      <form onSubmit={props.onSubmit} className="card-content space-y-5" noValidate>
        {/* Base URL */}
        <Field
          id="baseUrl"
          label="Runsheet base URL"
          error={fieldErrors.baseUrl}
          required
        >
          <input
            id="baseUrl"
            type="url"
            inputMode="url"
            className={`input ${fieldErrors.baseUrl ? "input-error" : ""}`}
            placeholder="https://api.runsheet.example.com"
            value={baseUrl}
            onChange={(e) => props.onBaseUrl(e.target.value)}
            aria-invalid={Boolean(fieldErrors.baseUrl)}
            aria-describedby={fieldErrors.baseUrl ? "baseUrl-error" : undefined}
          />
        </Field>

        {/* Tenant id */}
        <Field
          id="runsheetTenantId"
          label="Runsheet tenant identifier"
          error={fieldErrors.runsheetTenantId}
          required
        >
          <input
            id="runsheetTenantId"
            type="text"
            className={`input ${
              fieldErrors.runsheetTenantId ? "input-error" : ""
            }`}
            placeholder="tenant_abc123"
            value={runsheetTenantId}
            onChange={(e) => props.onRunsheetTenantId(e.target.value)}
            aria-invalid={Boolean(fieldErrors.runsheetTenantId)}
            aria-describedby={
              fieldErrors.runsheetTenantId
                ? "runsheetTenantId-error"
                : undefined
            }
          />
        </Field>

        {/* API key */}
        <Field
          id="apiKey"
          label="API key"
          error={fieldErrors.apiKey}
          required={!apiKeyLast4}
          hint={
            apiKeyLast4
              ? `A key ending in ${apiKeyLast4} is stored. Leave blank to keep it.`
              : undefined
          }
        >
          <input
            id="apiKey"
            type="password"
            autoComplete="off"
            className={`input ${fieldErrors.apiKey ? "input-error" : ""}`}
            placeholder={apiKeyLast4 ? "••••••••" : "Enter API key"}
            value={apiKey}
            onChange={(e) => props.onApiKey(e.target.value)}
            aria-invalid={Boolean(fieldErrors.apiKey)}
            aria-describedby={fieldErrors.apiKey ? "apiKey-error" : undefined}
          />
        </Field>

        {/* Webhook secret */}
        <Field
          id="webhookSecret"
          label="Webhook secret"
          error={fieldErrors.webhookSecret}
          hint="Used to sign the intake path. Leave blank to keep the stored secret."
        >
          <input
            id="webhookSecret"
            type="password"
            autoComplete="off"
            className="input"
            placeholder="Enter webhook secret"
            value={webhookSecret}
            onChange={(e) => props.onWebhookSecret(e.target.value)}
          />
        </Field>

        {/* Review mode */}
        <Field
          id="defaultReviewMode"
          label="Default review mode"
          error={fieldErrors.defaultReviewMode}
          required
        >
          <select
            id="defaultReviewMode"
            className={`input ${
              fieldErrors.defaultReviewMode ? "input-error" : ""
            }`}
            value={defaultReviewMode}
            onChange={(e) => props.onReviewMode(e.target.value as ReviewMode)}
          >
            {REVIEW_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>

        {/* Auto-submit (Req 9.3) */}
        <fieldset className="space-y-3 rounded-lg border border-gray-800 bg-gray-900/40 p-4">
          <legend className="px-1 text-sm font-medium text-gray-200">
            Auto-submit
          </legend>
          <div className="flex items-start gap-3">
            <input
              id="autoSubmitEnabled"
              type="checkbox"
              role="switch"
              className="mt-0.5 h-4 w-4 rounded border-gray-700 bg-gray-800 text-emerald-500 focus:ring-emerald-500"
              checked={autoSubmitEnabled}
              onChange={(e) => props.onAutoSubmitEnabled(e.target.checked)}
              aria-describedby="autoSubmitEnabled-hint"
            />
            <div className="space-y-0.5">
              <label
                htmlFor="autoSubmitEnabled"
                className="block text-sm font-medium text-gray-200 cursor-pointer"
              >
                Enable auto-submit for low-risk orders
              </label>
              <p id="autoSubmitEnabled-hint" className="text-xs text-gray-500">
                When enabled, eligible low-risk order drafts are submitted
                directly to Runsheet without dispatcher review. Applies only when
                the default review mode is “Auto-submit low risk”.
              </p>
            </div>
          </div>

          {autoSubmitEnabled && (
            <Field
              id="confidenceThreshold"
              label="Confidence threshold"
              error={fieldErrors.confidenceThreshold}
              hint="Optional. Minimum confidence score (0–1) an order must meet to auto-submit. Leave blank to use the platform default."
            >
              <input
                id="confidenceThreshold"
                type="number"
                inputMode="decimal"
                min={0}
                max={1}
                step={0.01}
                className={`input ${
                  fieldErrors.confidenceThreshold ? "input-error" : ""
                }`}
                placeholder="0.85"
                value={confidenceThreshold}
                onChange={(e) => props.onConfidenceThreshold(e.target.value)}
                aria-invalid={Boolean(fieldErrors.confidenceThreshold)}
                aria-describedby={
                  fieldErrors.confidenceThreshold
                    ? "confidenceThreshold-error"
                    : undefined
                }
              />
            </Field>
          )}
        </fieldset>

        {/* Purchase order requirement (Req 5.6) */}
        <fieldset className="space-y-3 rounded-lg border border-gray-800 bg-gray-900/40 p-4">
          <legend className="px-1 text-sm font-medium text-gray-200">
            Purchase order
          </legend>
          <div className="flex items-start gap-3">
            <input
              id="requiresPurchaseOrder"
              type="checkbox"
              role="switch"
              className="mt-0.5 h-4 w-4 rounded border-gray-700 bg-gray-800 text-emerald-500 focus:ring-emerald-500"
              checked={requiresPurchaseOrder}
              onChange={(e) => props.onRequiresPurchaseOrder(e.target.checked)}
              aria-describedby="requiresPurchaseOrder-hint"
            />
            <div className="space-y-0.5">
              <label
                htmlFor="requiresPurchaseOrder"
                className="block text-sm font-medium text-gray-200 cursor-pointer"
              >
                Require a purchase order number
              </label>
              <p id="requiresPurchaseOrder-hint" className="text-xs text-gray-500">
                When enabled, fuel-intake order drafts for this tenant must
                include a purchase order number before they can be finalized.
              </p>
            </div>
          </div>
        </fieldset>

        {/* Allowed conversation types */}
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-gray-200">
            Allowed conversation types
          </legend>
          <p className="text-xs text-gray-500">
            Only allowed types can be assigned to a phone number.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {RUNSHEET_CONVERSATION_TYPES.map((type) => {
              const checked = allowedConversationTypes.includes(type);
              return (
                <label
                  key={type}
                  className="flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900/40 px-3 py-2 cursor-pointer hover:bg-gray-800/60 transition-colors"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-gray-700 bg-gray-800 text-emerald-500 focus:ring-emerald-500"
                    checked={checked}
                    onChange={() => props.onToggleType(type)}
                  />
                  <span className="text-sm text-gray-200">
                    {humanizeConversationType(type)}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {/* Escalation target (Req 9.4) */}
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-gray-200">
            Escalation target
          </legend>
          <p className="text-xs text-gray-500">
            Where calls escalate when the agent cannot complete. Exactly one of a
            phone number, email address, or webhook URL.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <select
              className="input sm:w-48"
              value={escalationKind}
              onChange={(e) =>
                props.onEscalationKind(
                  e.target.value as EscalationTargetKind | ""
                )
              }
              aria-label="Escalation target kind"
            >
              <option value="">None</option>
              {ESCALATION_TARGET_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k.charAt(0).toUpperCase() + k.slice(1)}
                </option>
              ))}
            </select>
            <input
              type="text"
              className={`input flex-1 ${
                fieldErrors.escalationTarget ? "input-error" : ""
              }`}
              placeholder={
                escalationKind === "phone"
                  ? "+15551234567"
                  : escalationKind === "email"
                    ? "dispatch@example.com"
                    : escalationKind === "webhook"
                      ? "https://example.com/escalate"
                      : "Select a kind first"
              }
              value={escalationValue}
              onChange={(e) => props.onEscalationValue(e.target.value)}
              disabled={!escalationKind}
              aria-invalid={Boolean(fieldErrors.escalationTarget)}
              aria-describedby={
                fieldErrors.escalationTarget
                  ? "escalationTarget-error"
                  : undefined
              }
            />
          </div>
          {fieldErrors.escalationTarget && (
            <p
              id="escalationTarget-error"
              className="text-xs text-red-400"
              role="alert"
            >
              {fieldErrors.escalationTarget}
            </p>
          )}
        </fieldset>

        {/* Save + status */}
        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            className="btn btn-primary btn-md"
            disabled={saveState.kind === "saving"}
          >
            {saveState.kind === "saving" ? "Saving…" : "Save configuration"}
          </button>
          <div aria-live="polite" className="text-sm">
            {saveState.kind === "saved" && (
              <span className="text-emerald-400">Configuration saved.</span>
            )}
            {saveState.kind === "error" && (
              <span className="text-red-400" role="alert">
                {saveState.message}
              </span>
            )}
          </div>
        </div>
      </form>
    </section>
  );
}

// ============================================================================
// Credential test card
// ============================================================================

interface CredentialTestCardProps {
  tenantId: string;
  baseUrl: string;
  runsheetTenantId: string;
  apiKey: string;
  testCredential: (args: {
    tenantId?: string;
    baseUrl?: string;
    runsheetTenantId?: string;
    apiKey?: string;
  }) => Promise<{ valid: boolean; error?: string }>;
}

function CredentialTestCard(props: CredentialTestCardProps) {
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "testing" }
    | { kind: "result"; valid: boolean; error?: string }
  >({ kind: "idle" });

  const handleTest = async () => {
    setState({ kind: "testing" });
    try {
      // If the admin has entered ad-hoc credentials in the form, test those;
      // otherwise fall back to the stored integration keyed by tenant.
      const useAdHoc =
        props.baseUrl.trim() &&
        props.runsheetTenantId.trim() &&
        props.apiKey.trim();
      const result = await props.testCredential(
        useAdHoc
          ? {
              baseUrl: props.baseUrl.trim(),
              runsheetTenantId: props.runsheetTenantId.trim(),
              apiKey: props.apiKey.trim(),
            }
          : { tenantId: props.tenantId }
      );
      setState({ kind: "result", valid: result.valid, error: result.error });
    } catch (err) {
      setState({
        kind: "result",
        valid: false,
        error: err instanceof Error ? err.message : "Credential test failed",
      });
    }
  };

  return (
    <section className="card" aria-labelledby="test-heading">
      <div className="card-header">
        <h2 id="test-heading" className="text-base font-semibold text-white">
          Credential test
        </h2>
        <p className="text-sm text-gray-400">
          Runs an authenticated request against the configured Runsheet backend.
        </p>
      </div>
      <div className="card-content flex items-center gap-3">
        <button
          type="button"
          className="btn btn-outline btn-md"
          onClick={handleTest}
          disabled={state.kind === "testing" || !props.tenantId}
        >
          {state.kind === "testing" ? "Testing…" : "Test credential"}
        </button>
        <div aria-live="polite" className="text-sm">
          {state.kind === "result" &&
            (state.valid ? (
              <span className="badge badge-success">Credential valid</span>
            ) : (
              <span className="text-red-400" role="alert">
                {state.error ?? "Credential invalid"}
              </span>
            ))}
        </div>
      </div>
    </section>
  );
}

// ============================================================================
// Number assignment card
// ============================================================================

interface NumberAssignmentCardProps {
  tenantId: string;
  allowedConversationTypes: string[];
  assignNumber: (args: {
    tenantId: string;
    phoneNumber: string;
    conversationType: string;
  }) => Promise<{ assignmentId: string; updated: boolean }>;
}

function NumberAssignmentCard(props: NumberAssignmentCardProps) {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [conversationType, setConversationType] = useState("");
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "saving" }
    | { kind: "success"; message: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  const selectable = useMemo(
    () => props.allowedConversationTypes,
    [props.allowedConversationTypes]
  );

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneNumber.trim() || !conversationType) {
      setState({
        kind: "error",
        message: "Enter a phone number and choose a conversation type.",
      });
      return;
    }
    setState({ kind: "saving" });
    try {
      const result = await props.assignNumber({
        tenantId: props.tenantId,
        phoneNumber: phoneNumber.trim(),
        conversationType,
      });
      setState({
        kind: "success",
        message: `${phoneNumber.trim()} → ${humanizeConversationType(
          conversationType
        )} ${result.updated ? "(updated)" : "(assigned)"}`,
      });
    } catch (err) {
      setState({
        kind: "error",
        message:
          err instanceof Error ? err.message : "Failed to assign number",
      });
    }
  };

  return (
    <section className="card" aria-labelledby="assign-heading">
      <div className="card-header">
        <h2 id="assign-heading" className="text-base font-semibold text-white">
          Phone number assignment
        </h2>
        <p className="text-sm text-gray-400">
          Route a Dinee-managed phone number to a Runsheet conversation type.
        </p>
      </div>
      <form onSubmit={handleAssign} className="card-content space-y-4" noValidate>
        <Field id="phoneNumber" label="Dinee-managed phone number" required>
          <input
            id="phoneNumber"
            type="tel"
            className="input"
            placeholder="+15551234567"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
          />
        </Field>

        <Field id="conversationType" label="Conversation type" required>
          <select
            id="conversationType"
            className="input"
            value={conversationType}
            onChange={(e) => setConversationType(e.target.value)}
            disabled={selectable.length === 0}
          >
            <option value="">
              {selectable.length === 0
                ? "Save allowed conversation types first"
                : "Select a conversation type"}
            </option>
            {selectable.map((type) => (
              <option key={type} value={type}>
                {humanizeConversationType(type)}
              </option>
            ))}
          </select>
        </Field>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="btn btn-primary btn-md"
            disabled={state.kind === "saving" || selectable.length === 0}
          >
            {state.kind === "saving" ? "Assigning…" : "Assign number"}
          </button>
          <div aria-live="polite" className="text-sm">
            {state.kind === "success" && (
              <span className="text-emerald-400">{state.message}</span>
            )}
            {state.kind === "error" && (
              <span className="text-red-400" role="alert">
                {state.message}
              </span>
            )}
          </div>
        </div>
      </form>
    </section>
  );
}

// ============================================================================
// Reusable field wrapper
// ============================================================================

interface FieldProps {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}

function Field({ id, label, required, hint, error, children }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-gray-200">
        {label}
        {required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-gray-500">{hint}</p>}
      {error && (
        <p id={`${id}-error`} className="text-xs text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
