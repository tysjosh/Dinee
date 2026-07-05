"use client";

/**
 * Feature: platform-control-plane (Task 7.1)
 *
 * Shared, presentational filter controls for the cross-platform integration
 * list. Exposes platform / tenant text filters and a status control that offers
 * EXACTLY the three connection statuses `connected` / `disconnected` / `error`
 * (Req 6.3, 6.4). The component is fully controlled: it holds no state and
 * fetches no data — the consuming console owns the filter value and receives
 * changes through `onChange`.
 *
 * Requirements: 6.3, 6.4
 */

import React from "react";
import type { ConnectionStatus } from "../platformIntegrationAdmin.logic";

/** The exact set of selectable statuses (Req 6.4). */
export const STATUS_OPTIONS: ReadonlyArray<ConnectionStatus> = [
  "connected",
  "disconnected",
  "error",
] as const;

const STATUS_LABELS: Record<ConnectionStatus, string> = {
  connected: "Connected",
  disconnected: "Disconnected",
  error: "Error",
};

export interface IntegrationFilterValue {
  /** Exact, case-sensitive platform id filter (empty → no platform filter). */
  platform: string;
  /** Exact, case-sensitive tenant id filter (empty → no tenant filter). */
  tenant: string;
  /** Status filter, or "" for no status filter. */
  status: ConnectionStatus | "";
}

export interface IntegrationFiltersProps {
  value: IntegrationFilterValue;
  onChange: (next: IntegrationFilterValue) => void;
  /** Optional clear handler; when omitted the reset button is hidden. */
  onClear?: () => void;
}

export default function IntegrationFilters({
  value,
  onChange,
  onClear,
}: IntegrationFiltersProps) {
  const update = (patch: Partial<IntegrationFilterValue>) =>
    onChange({ ...value, ...patch });

  return (
    <section
      className="card"
      aria-labelledby="filters-heading"
      role="search"
    >
      <div className="card-header">
        <h2 id="filters-heading" className="text-base font-semibold text-white">
          Filters
        </h2>
        <p className="text-sm text-gray-400">
          Platform and tenant match exactly (case-sensitive). All active filters
          are combined.
        </p>
      </div>
      <div className="card-content grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="space-y-1.5">
          <label
            htmlFor="filter-platform"
            className="block text-sm font-medium text-gray-200"
          >
            Platform
          </label>
          <input
            id="filter-platform"
            type="text"
            className="input"
            placeholder="All platforms"
            value={value.platform}
            onChange={(e) => update({ platform: e.target.value })}
          />
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="filter-tenant"
            className="block text-sm font-medium text-gray-200"
          >
            Tenant
          </label>
          <input
            id="filter-tenant"
            type="text"
            className="input"
            placeholder="All tenants"
            value={value.tenant}
            onChange={(e) => update({ tenant: e.target.value })}
          />
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="filter-status"
            className="block text-sm font-medium text-gray-200"
          >
            Status
          </label>
          <select
            id="filter-status"
            className="input"
            value={value.status}
            onChange={(e) =>
              update({ status: e.target.value as ConnectionStatus | "" })
            }
          >
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </div>
      </div>
      {onClear && (
        <div className="card-content pt-0">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClear}
          >
            Clear filters
          </button>
        </div>
      )}
    </section>
  );
}
