"use client";

/**
 * Feature: platform-control-plane (Task 7.1)
 *
 * Shared, presentational phone-route assignment card. Routes a Dinee-managed
 * phone number to a `(platformId, tenantId, conversationType)` through the
 * supplied `savePhoneRoute` handler. Validation and argument building are
 * delegated verbatim to the reused pure helper `preparePhoneRoute`; the
 * selectable conversation types are limited to those passed in (the console
 * scopes them to the tenant's allowed types, Req 7.3).
 *
 * Pure presentational: no data fetching. The Admin_Console / Partner_Console
 * pass the scoped save handler and the allowed conversation types.
 *
 * Requirements: 7.3, 7.4
 */

import React, { useMemo, useState } from "react";
import {
  humanizeConversationType,
  preparePhoneRoute,
} from "../platformIntegrationAdmin.logic";

export interface PhoneRouteCardProps {
  platformId: string;
  tenantId: string;
  allowedConversationTypes: string[];
  /** Scoped phone-route save entry point. */
  savePhoneRoute: (args: {
    phoneNumber: string;
    platformId: string;
    tenantId: string;
    conversationType: string;
  }) => Promise<{ routeId: unknown; updated: boolean }>;
  /** When true, the form is read-only (e.g. out-of-scope for a partner). */
  disabled?: boolean;
}

export default function PhoneRouteCard({
  platformId,
  tenantId,
  allowedConversationTypes,
  savePhoneRoute,
  disabled = false,
}: PhoneRouteCardProps) {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [conversationType, setConversationType] = useState("");
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "saving" }
    | { kind: "success"; message: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  const selectable = useMemo(
    () => allowedConversationTypes,
    [allowedConversationTypes]
  );

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled) return;
    const prepared = preparePhoneRoute({
      phoneNumber,
      platformId,
      tenantId,
      conversationType,
    });
    if (!prepared.ok) {
      setState({ kind: "error", message: prepared.error });
      return;
    }
    setState({ kind: "saving" });
    try {
      const result = await savePhoneRoute(prepared.args);
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
        <div className="space-y-1.5">
          <label
            htmlFor="phoneNumber"
            className="block text-sm font-medium text-gray-200"
          >
            Dinee-managed phone number
            <span className="text-red-400 ml-0.5" aria-label="required">
              *
            </span>
          </label>
          <input
            id="phoneNumber"
            type="tel"
            className="input"
            placeholder="+15551234567"
            value={phoneNumber}
            disabled={disabled}
            onChange={(e) => setPhoneNumber(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="conversationType"
            className="block text-sm font-medium text-gray-200"
          >
            Conversation type
            <span className="text-red-400 ml-0.5" aria-label="required">
              *
            </span>
          </label>
          <select
            id="conversationType"
            className="input"
            value={conversationType}
            onChange={(e) => setConversationType(e.target.value)}
            disabled={disabled || selectable.length === 0}
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
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="btn btn-primary btn-md"
            disabled={
              state.kind === "saving" ||
              selectable.length === 0 ||
              !tenantId ||
              disabled
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
