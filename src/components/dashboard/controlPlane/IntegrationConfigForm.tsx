"use client";

/**
 * Feature: platform-control-plane (Task 7.1)
 *
 * Shared, presentational connection-configuration form whose credential inputs
 * are rendered DYNAMICALLY from the selected platform's catalog
 * `credentialFields` (label + required) (Req 6.6–6.9, 7.3, 7.4). Required-field
 * validation, argument building, and error mapping are delegated verbatim to
 * the reused pure helpers `prepareSaveConfig` / `describeSaveError` from
 * `platformIntegrationAdmin.logic.ts` — so a missing required field blocks the
 * save and names the offending field, and a blank credential field never
 * overwrites a stored secret.
 *
 * This component fetches no data: it accepts the platform descriptor (from the
 * Platform_Catalog), the stored last-4 previews, and an `onSave` handler that
 * performs the actual (scoped) mutation. The Admin_Console and Partner_Console
 * wire the appropriate save entry point.
 *
 * Requirements: 6.6, 6.7, 6.8, 6.9, 7.4
 */

import React, { useState } from "react";
import {
  type PlatformCredentialField,
  type SaveConfigArgs,
  describeSaveError,
  prepareSaveConfig,
} from "../platformIntegrationAdmin.logic";

/** The subset of a Platform_Catalog entry needed to drive the form. */
export interface ConfigFormPlatform {
  platformId: string;
  displayName: string;
  credentialFields: PlatformCredentialField[];
}

/** The result shape returned by a config-store save entry point. */
export type SaveConfigResult =
  | { ok: true }
  | { ok: false; code: "missing_field" | "unknown_platform"; field: string };

export type SaveConfigHandler = (
  args: SaveConfigArgs
) => Promise<SaveConfigResult>;

export interface IntegrationConfigFormProps {
  /** Platform descriptor from the catalog (drives the dynamic fields). */
  platform: ConfigFormPlatform;
  /** The tenant this configuration is scoped to. */
  tenantId: string;
  /** Stored last-4 previews per credential name (never full values). */
  storedLast4?: Record<string, string>;
  /** Non-secret values to seed the form from the masked config. */
  initialValues?: {
    baseUrl?: string;
    platformTenantId?: string;
    allowedConversationTypes?: string[];
    config?: unknown;
  };
  /** Actor identity forwarded to the save entry point for auditing. */
  actorUserId?: string;
  actorRole?: string;
  /** The (scoped) save handler that performs the mutation. */
  onSave: SaveConfigHandler;
  /** When true, the form is read-only (e.g. out-of-scope for a partner). */
  disabled?: boolean;
}

export default function IntegrationConfigForm({
  platform,
  tenantId,
  storedLast4,
  initialValues,
  actorUserId,
  actorRole,
  onSave,
  disabled = false,
}: IntegrationConfigFormProps) {
  const [baseUrl, setBaseUrl] = useState(initialValues?.baseUrl ?? "");
  const [platformTenantId, setPlatformTenantId] = useState(
    initialValues?.platformTenantId ?? ""
  );
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [allowedTypesRaw, setAllowedTypesRaw] = useState(
    (initialValues?.allowedConversationTypes ?? []).join(", ")
  );
  const [configRaw, setConfigRaw] = useState(() => {
    const config = initialValues?.config;
    if (config && typeof config === "object") {
      try {
        return JSON.stringify(config, null, 2);
      } catch {
        return "";
      }
    }
    return "";
  });

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<
    | { kind: "idle" }
    | { kind: "saving" }
    | { kind: "saved" }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

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
    if (disabled) return;
    setSaveState({ kind: "saving" });

    // Required-field validation + argument building (Req 6.8, 6.9) — reused
    // verbatim from the pure helper. A missing required field blocks the save
    // and names the offending field; only credential fields with an entered
    // value are sent so a blank field never overwrites a stored secret.
    const prepared = prepareSaveConfig(
      {
        platformId: platform.platformId,
        tenantId,
        baseUrl,
        platformTenantId,
        credentials,
        allowedTypesRaw,
        configRaw,
        actorUserId,
        actorRole,
      },
      platform.credentialFields,
      storedLast4
    );

    if (!prepared.ok) {
      setFieldErrors(prepared.errors);
      setSaveState({ kind: "idle" });
      return;
    }

    try {
      const result = await onSave(prepared.args);

      if (!result.ok) {
        // Map the offending field back to an inline error (Req 6.9).
        setFieldErrors({ [result.field]: describeSaveError(result) });
        setSaveState({ kind: "error", message: describeSaveError(result) });
        return;
      }

      setFieldErrors({});
      // Clear secret inputs after a successful save — never displayed again.
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

  return (
    <section className="card" aria-labelledby="config-heading">
      <div className="card-header">
        <h2 id="config-heading" className="text-base font-semibold text-white">
          Connection configuration
        </h2>
        <p className="text-sm text-gray-400">
          Credentials are encrypted at rest; secret values are never displayed
          after saving.
        </p>
      </div>
      <form onSubmit={handleSave} className="card-content space-y-5" noValidate>
        <Field id="baseUrl" label="Base URL" error={fieldErrors.baseUrl} required>
          <input
            id="baseUrl"
            type="url"
            inputMode="url"
            className={`input ${fieldErrors.baseUrl ? "input-error" : ""}`}
            placeholder="https://api.example.com"
            value={baseUrl}
            disabled={disabled}
            onChange={(e) => {
              setBaseUrl(e.target.value);
              clearFieldError("baseUrl");
            }}
            aria-invalid={Boolean(fieldErrors.baseUrl)}
            aria-describedby={fieldErrors.baseUrl ? "baseUrl-error" : undefined}
          />
        </Field>

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
            disabled={disabled}
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

        {/* Dynamic credential fields driven by the catalog (Req 6.6, 6.7) */}
        {platform.credentialFields.map((field) => {
          const last4 = storedLast4?.[field.name];
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
                disabled={disabled}
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

        <Field
          id="allowedTypes"
          label="Allowed conversation types"
          hint="Comma-separated. Only these types can be routed to a phone number."
        >
          <input
            id="allowedTypes"
            type="text"
            className="input"
            placeholder="runsheet_inbound_order, runsheet_driver_exception"
            value={allowedTypesRaw}
            disabled={disabled}
            onChange={(e) => setAllowedTypesRaw(e.target.value)}
          />
        </Field>

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
            disabled={disabled}
            onChange={(e) => {
              setConfigRaw(e.target.value);
              clearFieldError("config");
            }}
            aria-invalid={Boolean(fieldErrors.config)}
            aria-describedby={fieldErrors.config ? "config-error" : undefined}
          />
        </Field>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            className="btn btn-primary btn-md"
            disabled={saveState.kind === "saving" || !tenantId || disabled}
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
// Reusable field wrapper (mirrors the field wrapper in PlatformIntegrationAdmin)
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
