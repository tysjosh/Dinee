"use client";

/**
 * Feature: platform-control-plane (Task 7.1)
 *
 * Shared, presentational table that renders masked integration rows in the
 * order they are supplied (the Control-Plane read surfaces already return a
 * deterministic `(platformId, tenantId)` order — this component preserves that
 * order and never re-sorts) (Req 6.1, 6.2). Each row shows only the last-4
 * previews of stored credentials via `MaskedCredentialsCard` semantics and the
 * connection status via the reused `connectionBadge` helper — never plaintext
 * or ciphertext.
 *
 * Pure presentational: no data fetching, no internal state. Row selection is
 * delegated to the consuming console through `onSelect`.
 *
 * Requirements: 6.1, 6.2, 6.10, 7.4
 */

import React from "react";
import { connectionBadge } from "../platformIntegrationAdmin.logic";

/**
 * A serializable, masked integration summary. Mirrors the shape returned by the
 * Control-Plane read surfaces (`MaskedIntegrationConfig`) — it carries only the
 * last-4 preview per credential name and never ciphertext/plaintext.
 */
export interface IntegrationSummary {
  platformId: string;
  tenantId: string;
  baseUrl: string;
  platformTenantId: string;
  /** Last-4 preview per credential name — never a full value (Req 6.10, 7.4). */
  credentialsLast4: Record<string, string>;
  allowedConversationTypes: string[];
  config: unknown;
  status: "connected" | "disconnected" | "error";
  createdAt: number;
  updatedAt: number;
}

/** Stable key for a masked integration row. */
export function integrationKey(summary: {
  platformId: string;
  tenantId: string;
}): string {
  return `${summary.platformId}::${summary.tenantId}`;
}

export interface IntegrationListTableProps {
  integrations: IntegrationSummary[];
  /** The currently selected row key, if any. */
  selectedKey?: string | null;
  /** Invoked when a row is chosen. */
  onSelect?: (summary: IntegrationSummary) => void;
  /** Message rendered when there are no rows (Req 6.2 empty state). */
  emptyMessage?: string;
}

export default function IntegrationListTable({
  integrations,
  selectedKey,
  onSelect,
  emptyMessage = "No integrations match the current filters.",
}: IntegrationListTableProps) {
  if (integrations.length === 0) {
    return (
      <section className="card" aria-labelledby="list-heading">
        <div className="card-header">
          <h2 id="list-heading" className="text-base font-semibold text-white">
            Integrations
          </h2>
        </div>
        <div className="card-content">
          <p className="text-sm text-gray-400">{emptyMessage}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="card" aria-labelledby="list-heading">
      <div className="card-header">
        <h2 id="list-heading" className="text-base font-semibold text-white">
          Integrations
        </h2>
        <p className="text-sm text-gray-400">
          {integrations.length}{" "}
          {integrations.length === 1 ? "integration" : "integrations"}
        </p>
      </div>
      <div className="card-content overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-xs uppercase tracking-wider text-gray-500">
              <th scope="col" className="py-2 pr-4 font-medium">
                Platform
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Tenant
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Status
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Credentials
              </th>
              {onSelect && <th scope="col" className="py-2" />}
            </tr>
          </thead>
          <tbody>
            {integrations.map((summary) => {
              const key = integrationKey(summary);
              const badge = connectionBadge(summary.status);
              const credentialCount = Object.keys(
                summary.credentialsLast4
              ).length;
              const isSelected = selectedKey === key;
              return (
                <tr
                  key={key}
                  className={`border-b border-gray-900 ${
                    isSelected ? "bg-gray-900" : ""
                  }`}
                >
                  <td className="py-3 pr-4 font-mono text-white">
                    {summary.platformId}
                  </td>
                  <td className="py-3 pr-4 font-mono text-gray-300">
                    {summary.tenantId}
                  </td>
                  <td className="py-3 pr-4">
                    <span className={badge.cls}>{badge.label}</span>
                  </td>
                  <td className="py-3 pr-4 text-gray-400">
                    {credentialCount}{" "}
                    {credentialCount === 1 ? "credential" : "credentials"}
                  </td>
                  {onSelect && (
                    <td className="py-3 text-right">
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={() => onSelect(summary)}
                        aria-pressed={isSelected}
                        aria-label={`View details for ${summary.platformId} / ${summary.tenantId}`}
                      >
                        {isSelected ? "Selected" : "View"}
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
