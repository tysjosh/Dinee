"use client";

/**
 * Feature: platform-control-plane (Task 7.1)
 *
 * Shared, presentational credential-test card. Triggers an authenticated probe
 * through the supplied `onTest` handler and displays the resulting
 * Connection_Status via the reused `connectionBadge` helper. Optionally renders
 * the current status and the most-recent credential-test history (outcomes +
 * whole-second UTC timestamps) supplied by the console — the card never
 * displays any credential value (Req 8).
 *
 * Pure presentational: it holds only transient test-in-flight state and fetches
 * no data. The Admin_Console / Partner_Console pass the scoped test handler and
 * the authorized history/status reads.
 *
 * Requirements: 6.10, 7.4 (masking); composes credential-test + history (Req 8)
 */

import React, { useState } from "react";
import {
  type ConnectionStatus,
  connectionBadge,
} from "../platformIntegrationAdmin.logic";

/** A single credential-test outcome record (secret-free). */
export interface CredentialTestHistoryEntry {
  outcome: "success" | "failure";
  /** Epoch ms; the console truncates to whole seconds for display (Req 8.2). */
  completedAt: number;
}

export interface CredentialTestCardProps {
  platformId: string;
  tenantId: string;
  /** Scoped credential-test entry point (delegates to the base action). */
  onTest: (args: {
    platformId: string;
    tenantId: string;
  }) => Promise<{ status: ConnectionStatus; error?: string }>;
  /** Current connection status, when known (Req 8.1). */
  currentStatus?: ConnectionStatus;
  /** Most-recent-first outcome history (≤100), when provided (Req 8.3). */
  history?: CredentialTestHistoryEntry[];
  /** When true, the test button is disabled (e.g. out-of-scope). */
  disabled?: boolean;
}

function formatTimestamp(completedAt: number): string {
  // Truncate to whole seconds (UTC) for a stable, secret-free display (Req 8.2).
  const seconds = Math.floor(completedAt / 1000) * 1000;
  return new Date(seconds).toISOString().replace(".000Z", "Z");
}

export default function CredentialTestCard({
  platformId,
  tenantId,
  onTest,
  currentStatus,
  history,
  disabled = false,
}: CredentialTestCardProps) {
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "testing" }
    | { kind: "result"; status: ConnectionStatus; error?: string }
  >({ kind: "idle" });

  const handleTest = async () => {
    if (disabled) return;
    setState({ kind: "testing" });
    try {
      const result = await onTest({ platformId, tenantId });
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
      <div className="card-header flex items-start justify-between gap-4">
        <div>
          <h2 id="test-heading" className="text-base font-semibold text-white">
            Credential test
          </h2>
          <p className="text-sm text-gray-400">
            Runs an authenticated probe against the configured backend and
            records the resulting connection status.
          </p>
        </div>
        {currentStatus && (
          <span className={connectionBadge(currentStatus).cls}>
            {connectionBadge(currentStatus).label}
          </span>
        )}
      </div>
      <div className="card-content space-y-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="btn btn-outline btn-md"
            onClick={handleTest}
            disabled={state.kind === "testing" || !tenantId || disabled}
          >
            {state.kind === "testing" ? "Testing…" : "Test credential"}
          </button>
          <div aria-live="polite" className="text-sm">
            {state.kind === "result" && (
              <>
                <span className={connectionBadge(state.status).cls}>
                  {connectionBadge(state.status).label}
                </span>
                {state.status !== "connected" && state.error && (
                  <span className="ml-2 text-red-400" role="alert">
                    {state.error}
                  </span>
                )}
              </>
            )}
          </div>
        </div>

        {history && history.length > 0 && (
          <div>
            <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-2">
              Recent tests
            </h3>
            <ul className="space-y-1.5">
              {history.map((entry, index) => {
                const badge = connectionBadge(
                  entry.outcome === "success" ? "connected" : "error"
                );
                return (
                  <li
                    key={`${entry.completedAt}-${index}`}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className={badge.cls}>
                      {entry.outcome === "success" ? "Success" : "Failure"}
                    </span>
                    <time
                      className="text-gray-500 font-mono text-xs"
                      dateTime={new Date(entry.completedAt).toISOString()}
                    >
                      {formatTimestamp(entry.completedAt)}
                    </time>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
