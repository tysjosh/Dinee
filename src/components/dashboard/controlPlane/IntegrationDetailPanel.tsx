"use client";

/**
 * Feature: platform-control-plane (Task 7.1)
 *
 * Shared, presentational detail panel for a single `(platformId, tenantId)`
 * integration. Renders the masked configuration — connection status, base URL,
 * platform tenant id, allowed conversation types, and the last-4 credential
 * previews (via `MaskedCredentialsCard`) — never plaintext or ciphertext
 * (Req 6.5, 3.2, 3.4, 11). Handles the "not found" case as an empty state
 * rather than an error (Req 3.3).
 *
 * Pure presentational: no data fetching, no internal state. The consuming
 * console resolves the detail (or absence) and passes it in.
 *
 * Requirements: 6.5, 7.4
 */

import React from "react";
import {
  type PlatformCredentialField,
  connectionBadge,
  humanizeConversationType,
} from "../platformIntegrationAdmin.logic";
import MaskedCredentialsCard from "./MaskedCredentialsCard";
import type { IntegrationSummary } from "./IntegrationListTable";

export interface IntegrationDetailPanelProps {
  /** The masked detail, or null/undefined when none is selected. */
  detail: IntegrationSummary | null | undefined;
  /** True when a pair was requested but no record exists (Req 3.3). */
  notFound?: boolean;
  /** Field descriptors used to label the masked credential previews. */
  credentialFields: PlatformCredentialField[];
  /** Message shown when no integration is selected. */
  emptyMessage?: string;
}

export default function IntegrationDetailPanel({
  detail,
  notFound,
  credentialFields,
  emptyMessage = "Select an integration to view its details.",
}: IntegrationDetailPanelProps) {
  if (notFound) {
    return (
      <section className="card" aria-labelledby="detail-heading">
        <div className="card-header">
          <h2
            id="detail-heading"
            className="text-base font-semibold text-white"
          >
            Integration detail
          </h2>
        </div>
        <div className="card-content">
          <p className="text-sm text-gray-400">
            No configuration exists for this platform and tenant yet.
          </p>
        </div>
      </section>
    );
  }

  if (!detail) {
    return (
      <section className="card" aria-labelledby="detail-heading">
        <div className="card-header">
          <h2
            id="detail-heading"
            className="text-base font-semibold text-white"
          >
            Integration detail
          </h2>
        </div>
        <div className="card-content">
          <p className="text-sm text-gray-400">{emptyMessage}</p>
        </div>
      </section>
    );
  }

  const badge = connectionBadge(detail.status);

  return (
    <div className="space-y-6">
      <section className="card" aria-labelledby="detail-heading">
        <div className="card-header flex items-start justify-between gap-4">
          <div>
            <h2
              id="detail-heading"
              className="text-base font-semibold text-white"
            >
              {detail.platformId} / {detail.tenantId}
            </h2>
            <p className="text-sm text-gray-400">
              Masked configuration detail — secret values are never displayed.
            </p>
          </div>
          <span className={badge.cls}>{badge.label}</span>
        </div>
        <dl className="card-content grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <dt className="text-xs text-gray-500 uppercase tracking-wider">
              Base URL
            </dt>
            <dd className="text-sm text-white mt-1 break-all">
              {detail.baseUrl || "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500 uppercase tracking-wider">
              Platform tenant ID
            </dt>
            <dd className="text-sm text-white mt-1 font-mono break-all">
              {detail.platformTenantId || "—"}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs text-gray-500 uppercase tracking-wider">
              Allowed conversation types
            </dt>
            <dd className="text-sm text-white mt-1">
              {detail.allowedConversationTypes.length === 0 ? (
                "—"
              ) : (
                <div className="flex flex-wrap gap-2">
                  {detail.allowedConversationTypes.map((type) => (
                    <span key={type} className="badge badge-neutral">
                      {humanizeConversationType(type)}
                    </span>
                  ))}
                </div>
              )}
            </dd>
          </div>
        </dl>
      </section>

      <MaskedCredentialsCard
        credentialsLast4={detail.credentialsLast4}
        credentialFields={credentialFields}
      />
    </div>
  );
}
