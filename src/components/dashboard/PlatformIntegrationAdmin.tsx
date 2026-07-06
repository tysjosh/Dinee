"use client";

/**
 * Generic, platform-driven Integration Admin UI (Dinee-owned, configuration only).
 *
 * This component is NOT hardcoded to any single platform. It renders its
 * credential inputs DYNAMICALLY from the resolved `PlatformDefinition`'s
 * `credentialFields` (label + required), passed in as a serializable descriptor
 * by the server component that resolves the platform from the
 * Integration_Registry. Runsheet is simply the first platform to drive it.
 *
 * Capabilities (Requirement 9):
 *   - Register / update the integration config via the generic config store
 *     save entry point (`integrations.adminConfig.saveIntegrationConfig`), which
 *     encrypts credentials before persisting (Req 9.1). A missing required field
 *     blocks the save and names the offending field (Req 9.5).
 *   - Assign an inbound phone number to `(platformId, tenantId, conversationType)`
 *     through the phone-route store (`integrations.phoneRoutes.savePhoneRoute`)
 *     (Req 9.2).
 *   - Trigger a credential test (`integrations.adminConfig.testIntegrationCredential`)
 *     and display the resulting Connection_Status (Req 9.3).
 *   - Display a masked view of stored credentials showing at most the last 4
 *     characters of each, read from `getMaskedConfig` — never plaintext or
 *     ciphertext (Req 9.4).
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5 (multi-platform-voice-integrations)
 */

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  type ConnectionStatus,
  type PlatformCredentialField,
  connectionBadge,
  describeSaveError,
  formatMaskedCredential,
  humanizeConversationType,
  preparePhoneRoute,
  prepareSaveConfig,
} from "./platformIntegrationAdmin.logic";

export type {
  PlatformCredentialField,
  PlatformConfigField,
} from "./platformIntegrationAdmin.logic";

import type { PlatformConfigField } from "./platformIntegrationAdmin.logic";
import { flattenTypedConfig } from "./platformIntegrationAdmin.logic";

/** Serializable platform descriptor driving the form (Req 9.1). */
export interface PlatformUiDescriptor {
  platformId: string;
  displayName: string;
  credentialFields: PlatformCredentialField[];
  /** Typed non-secret settings schema; when present, replaces the JSON editor. */
  configFields?: PlatformConfigField[];
}

interface PlatformIntegrationAdminProps {
  /** The resolved platform descriptor, or null when no platform resolved. */
  platform: PlatformUiDescriptor | null;
}

export default function PlatformIntegrationAdmin({
  platform,
}: PlatformIntegrationAdminProps) {
  const router = useRouter();
  const { user, isLoading: userLoading } = useCurrentUser();
  const tenantId = user?.tenantId ?? "";
  const platformId = platform?.platformId ?? "";

  // --- Convex bindings -------------------------------------------------------
  const masked = useQuery(
    api.integrations.configStore.getMaskedConfig,
    platformId && tenantId ? { platformId, tenantId } : "skip"
  );
  const saveIntegrationConfig = useAction(
    api.integrations.adminConfig.saveIntegrationConfig
  );
  const testIntegrationCredential = useAction(
    api.integrations.adminConfig.testIntegrationCredential
  );
  const savePhoneRoute = useMutation(api.integrations.phoneRoutes.savePhoneRoute);

  // --- Config form state -----------------------------------------------------
  const [baseUrl, setBaseUrl] = useState("");
  const [platformTenantId, setPlatformTenantId] = useState("");
  // Credential inputs keyed by credential name — rendered dynamically (Req 9.1).
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [allowedTypesRaw, setAllowedTypesRaw] = useState("");
  const [configRaw, setConfigRaw] = useState("");
  // Typed config form values keyed by field name (when the platform declares a
  // config schema). The stored config object is retained for hydration + to
  // preserve unowned keys on save.
  const configFields = platform?.configFields ?? [];
  const hasConfigSchema = configFields.length > 0;
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [storedConfig, setStoredConfig] = useState<
    Record<string, unknown> | undefined
  >(undefined);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<
    | { kind: "idle" }
    | { kind: "saving" }
    | { kind: "saved" }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  // Hydrate the non-secret fields from the masked config once it loads. Secrets
  // are never returned (only last-4), so credential inputs stay empty.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (masked && !hydrated) {
      setBaseUrl(masked.baseUrl ?? "");
      setPlatformTenantId(masked.platformTenantId ?? "");
      setAllowedTypesRaw((masked.allowedConversationTypes ?? []).join(", "));
      const cfg =
        masked.config && typeof masked.config === "object"
          ? (masked.config as Record<string, unknown>)
          : undefined;
      setStoredConfig(cfg);
      if (hasConfigSchema) {
        // Typed schema: hydrate structured inputs from the stored config.
        setConfigValues(flattenTypedConfig(configFields, cfg));
      } else if (cfg) {
        // Fallback: raw JSON editor.
        try {
          setConfigRaw(JSON.stringify(cfg, null, 2));
        } catch {
          setConfigRaw("");
        }
      }
      setHydrated(true);
    }
  }, [masked, hydrated]);

  const clearFieldError = (field: string) =>
    setFieldErrors((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });

  const setCredential = (name: string, value: string) => {
    setCredentials((prev) => ({ ...prev, [name]: value }));
    clearFieldError(name);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!platform) return;
    setSaveState({ kind: "saving" });

    // Required-field validation + argument building (Req 9.1, 9.5). A missing
    // required field blocks the save and names the offending field; only
    // credential fields with an entered value are sent so a blank field never
    // overwrites a stored secret.
    const prepared = prepareSaveConfig(
      {
        platformId: platform.platformId,
        tenantId,
        baseUrl,
        platformTenantId,
        credentials,
        allowedTypesRaw,
        configRaw,
        configFields: hasConfigSchema ? configFields : undefined,
        configValues: hasConfigSchema ? configValues : undefined,
        existingConfig: storedConfig,
        actorUserId: user?.userId,
        actorRole: user?.role,
      },
      platform.credentialFields,
      masked?.credentialsLast4
    );

    if (!prepared.ok) {
      setFieldErrors(prepared.errors);
      setSaveState({ kind: "idle" });
      return;
    }

    try {
      const result = await saveIntegrationConfig(prepared.args);

      if (!result.ok) {
        // Map the offending field back to an inline error (Req 9.5).
        setFieldErrors({ [result.field]: describeSaveError(result) });
        setSaveState({ kind: "error", message: describeSaveError(result) });
        return;
      }

      setFieldErrors({});
      // Clear the secret inputs after a successful save — they are never
      // displayed again (only the last-4 is).
      setCredentials({});
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

  if (!platform) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center px-4">
        <div className="card max-w-md text-center">
          <div className="card-content space-y-2">
            <h1 className="text-lg font-semibold text-white">
              Platform not available
            </h1>
            <p className="text-sm text-gray-400">
              No integration platform could be resolved. Ensure the platform is
              registered before configuring it.
            </p>
          </div>
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
                  {platform.displayName} Integration
                </h1>
                <p className="text-sm text-gray-400">
                  Configure the {platform.displayName} voice connection for your
                  tenant
                </p>
              </div>
            </div>
            <ConnectionBadge status={masked?.status} />
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Masked view of stored credentials (Req 9.4) */}
        {masked && (
          <MaskedCredentialsCard
            credentialsLast4={masked.credentialsLast4}
            credentialFields={platform.credentialFields}
          />
        )}

        {/* Integration configuration */}
        <section className="card" aria-labelledby="config-heading">
          <div className="card-header">
            <h2
              id="config-heading"
              className="text-base font-semibold text-white"
            >
              Connection configuration
            </h2>
            <p className="text-sm text-gray-400">
              Credentials are encrypted at rest; secret values are never
              displayed after saving.
            </p>
          </div>
          <form onSubmit={handleSave} className="card-content space-y-5" noValidate>
            {/* Base URL */}
            <Field
              id="baseUrl"
              label="Base URL"
              error={fieldErrors.baseUrl}
              required
            >
              <input
                id="baseUrl"
                type="url"
                inputMode="url"
                className={`input ${fieldErrors.baseUrl ? "input-error" : ""}`}
                placeholder="https://api.example.com"
                value={baseUrl}
                onChange={(e) => {
                  setBaseUrl(e.target.value);
                  clearFieldError("baseUrl");
                }}
                aria-invalid={Boolean(fieldErrors.baseUrl)}
                aria-describedby={
                  fieldErrors.baseUrl ? "baseUrl-error" : undefined
                }
              />
            </Field>

            {/* Platform tenant id */}
            <Field
              id="platformTenantId"
              label="Platform tenant ID"
              error={fieldErrors.platformTenantId}
              required
            >
              <input
                id="platformTenantId"
                type="text"
                className={`input ${
                  fieldErrors.platformTenantId ? "input-error" : ""
                }`}
                placeholder="tenant_abc123"
                value={platformTenantId}
                onChange={(e) => {
                  setPlatformTenantId(e.target.value);
                  clearFieldError("platformTenantId");
                }}
                aria-invalid={Boolean(fieldErrors.platformTenantId)}
                aria-describedby={
                  fieldErrors.platformTenantId
                    ? "platformTenantId-error"
                    : undefined
                }
              />
            </Field>

            {/* Dynamic credential fields (Req 9.1) */}
            {platform.credentialFields.map((field) => {
              const last4 = masked?.credentialsLast4?.[field.name];
              return (
                <Field
                  key={field.name}
                  id={`cred-${field.name}`}
                  label={field.label}
                  error={fieldErrors[field.name]}
                  required={field.required && !last4}
                  hint={
                    last4
                      ? `A value ending in ${last4} is stored. Leave blank to keep it.`
                      : undefined
                  }
                >
                  <input
                    id={`cred-${field.name}`}
                    type="password"
                    autoComplete="off"
                    className={`input ${
                      fieldErrors[field.name] ? "input-error" : ""
                    }`}
                    placeholder={last4 ? "••••••••" : `Enter ${field.label}`}
                    value={credentials[field.name] ?? ""}
                    onChange={(e) => setCredential(field.name, e.target.value)}
                    aria-invalid={Boolean(fieldErrors[field.name])}
                    aria-describedby={
                      fieldErrors[field.name]
                        ? `cred-${field.name}-error`
                        : undefined
                    }
                  />
                </Field>
              );
            })}

            {/* Allowed conversation types */}
            <Field
              id="allowedTypes"
              label="Allowed conversation types"
              hint="Comma-separated. Only these types can be routed to a phone number."
            >
              <input
                id="allowedTypes"
                type="text"
                className="input"
                placeholder="runsheet_fuel_order_intake, runsheet_driver_exception"
                value={allowedTypesRaw}
                onChange={(e) => setAllowedTypesRaw(e.target.value)}
              />
            </Field>

            {/* Platform settings — typed inputs when the platform declares a
                config schema, else a raw JSON fallback. */}
            {hasConfigSchema ? (
              <fieldset className="space-y-4 rounded-lg border border-gray-800 bg-gray-900/40 p-4">
                <legend className="px-1 text-sm font-medium text-gray-200">
                  {platform.displayName} settings
                </legend>
                {configFields.map((field) => (
                  <ConfigFieldInput
                    key={field.name}
                    field={field}
                    value={configValues[field.name] ?? ""}
                    error={fieldErrors[field.name]}
                    onChange={(v) => {
                      setConfigValues((prev) => ({ ...prev, [field.name]: v }));
                      clearFieldError(field.name);
                    }}
                  />
                ))}
              </fieldset>
            ) : (
              <Field
                id="config"
                label="Platform config (JSON)"
                error={fieldErrors.config}
                hint="Optional. A JSON object of platform-specific settings."
              >
                <textarea
                  id="config"
                  rows={4}
                  className={`input font-mono text-xs ${
                    fieldErrors.config ? "input-error" : ""
                  }`}
                  placeholder='{ "autoSubmitEnabled": false }'
                  value={configRaw}
                  onChange={(e) => {
                    setConfigRaw(e.target.value);
                    clearFieldError("config");
                  }}
                  aria-invalid={Boolean(fieldErrors.config)}
                  aria-describedby={
                    fieldErrors.config ? "config-error" : undefined
                  }
                />
              </Field>
            )}

            {/* Save + status */}
            <div className="flex items-center gap-3 pt-2">
              <button
                type="submit"
                className="btn btn-primary btn-md"
                disabled={saveState.kind === "saving" || !tenantId}
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

        {/* Credential test (Req 9.3) */}
        <CredentialTestCard
          platformId={platform.platformId}
          tenantId={tenantId}
          testIntegrationCredential={testIntegrationCredential}
        />

        {/* Phone number assignment (Req 9.2) */}
        <PhoneRouteCard
          platformId={platform.platformId}
          tenantId={tenantId}
          allowedConversationTypes={masked?.allowedConversationTypes ?? []}
          savePhoneRoute={savePhoneRoute}
        />
      </main>
    </div>
  );
}

// ============================================================================
// Connection status badge
// ============================================================================

function ConnectionBadge({ status }: { status?: ConnectionStatus }) {
  const entry = connectionBadge(status);
  return <span className={entry.cls}>{entry.label}</span>;
}

// ============================================================================
// Masked credentials card (Req 9.4)
// ============================================================================

interface MaskedCredentialsCardProps {
  credentialsLast4: Record<string, string>;
  credentialFields: PlatformCredentialField[];
}

function MaskedCredentialsCard({
  credentialsLast4,
  credentialFields,
}: MaskedCredentialsCardProps) {
  const labelFor = (name: string) =>
    credentialFields.find((f) => f.name === name)?.label ?? name;

  const names = Object.keys(credentialsLast4);
  if (names.length === 0) return null;

  return (
    <section className="card" aria-labelledby="stored-heading">
      <div className="card-header">
        <h2 id="stored-heading" className="text-base font-semibold text-white">
          Stored credentials
        </h2>
        <p className="text-sm text-gray-400">
          Only the last 4 characters of each stored credential are shown.
        </p>
      </div>
      <div className="card-content grid grid-cols-1 sm:grid-cols-2 gap-4">
        {names.map((name) => (
          <div key={name}>
            <p className="text-xs text-gray-500 uppercase tracking-wider">
              {labelFor(name)}
            </p>
            <p className="text-sm text-white mt-1 font-mono">
              {formatMaskedCredential(credentialsLast4[name])}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ============================================================================
// Credential test card (Req 9.3)
// ============================================================================

interface CredentialTestCardProps {
  platformId: string;
  tenantId: string;
  testIntegrationCredential: (args: {
    platformId: string;
    tenantId: string;
  }) => Promise<{ status: ConnectionStatus; error?: string }>;
}

function CredentialTestCard(props: CredentialTestCardProps) {
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "testing" }
    | { kind: "result"; status: ConnectionStatus; error?: string }
  >({ kind: "idle" });

  const handleTest = async () => {
    setState({ kind: "testing" });
    try {
      const result = await props.testIntegrationCredential({
        platformId: props.platformId,
        tenantId: props.tenantId,
      });
      setState({ kind: "result", status: result.status, error: result.error });
    } catch (err) {
      setState({
        kind: "result",
        status: "error",
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
          Runs an authenticated probe against the configured backend and records
          the resulting connection status.
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
          {state.kind === "result" && (
            <>
              <ConnectionBadge status={state.status} />
              {state.status !== "connected" && state.error && (
                <span className="ml-2 text-red-400" role="alert">
                  {state.error}
                </span>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

// ============================================================================
// Phone route assignment card (Req 9.2)
// ============================================================================

interface PhoneRouteCardProps {
  platformId: string;
  tenantId: string;
  allowedConversationTypes: string[];
  savePhoneRoute: (args: {
    phoneNumber: string;
    platformId: string;
    tenantId: string;
    conversationType: string;
  }) => Promise<{ routeId: unknown; updated: boolean }>;
}

function PhoneRouteCard(props: PhoneRouteCardProps) {
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
    const prepared = preparePhoneRoute({
      phoneNumber,
      platformId: props.platformId,
      tenantId: props.tenantId,
      conversationType,
    });
    if (!prepared.ok) {
      setState({ kind: "error", message: prepared.error });
      return;
    }
    setState({ kind: "saving" });
    try {
      const result = await props.savePhoneRoute(prepared.args);
      setState({
        kind: "success",
        message: `${phoneNumber.trim()} → ${humanizeConversationType(
          conversationType
        )} ${result.updated ? "(updated)" : "(assigned)"}`,
      });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Failed to assign number",
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
          Route a Dinee-managed phone number to a conversation type for this
          platform.
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
            disabled={
              state.kind === "saving" ||
              selectable.length === 0 ||
              !props.tenantId
            }
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
// Typed platform config input
// ============================================================================

function ConfigFieldInput({
  field,
  value,
  error,
  onChange,
}: {
  field: PlatformConfigField;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  const id = `cfg-${field.name}`;

  if (field.type === "boolean") {
    return (
      <div className="flex items-start gap-3">
        <input
          id={id}
          type="checkbox"
          role="switch"
          className="mt-0.5 h-4 w-4 rounded border-gray-700 bg-gray-800 text-emerald-500 focus:ring-emerald-500"
          checked={value === "true"}
          onChange={(e) => onChange(e.target.checked ? "true" : "false")}
          aria-describedby={field.hint ? `${id}-hint` : undefined}
        />
        <div className="space-y-0.5">
          <label
            htmlFor={id}
            className="block text-sm font-medium text-gray-200 cursor-pointer"
          >
            {field.label}
          </label>
          {field.hint && (
            <p id={`${id}-hint`} className="text-xs text-gray-500">
              {field.hint}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <Field id={id} label={field.label} hint={field.hint} error={error}>
      {field.type === "select" ? (
        <select
          id={id}
          className={`input ${error ? "input-error" : ""}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {(field.options ?? []).map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          type={field.type === "number" ? "number" : "text"}
          inputMode={field.type === "number" ? "decimal" : undefined}
          min={field.min}
          max={field.max}
          step={field.step}
          className={`input ${error ? "input-error" : ""}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={Boolean(error)}
        />
      )}
    </Field>
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
        {required && (
          <span className="text-red-400 ml-0.5" aria-label="required">
            *
          </span>
        )}
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
