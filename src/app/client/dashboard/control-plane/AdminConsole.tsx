"use client";

/**
 * Feature: platform-control-plane (Task 7.2)
 *
 * Admin_Console — the Platform_Admin's cross-tenant, cross-platform management
 * surface. It composes the shared Control-Plane cards (Task 7.1) around the
 * authorized Control-Plane read/management surfaces:
 *
 *   - Reads  : `listIntegrations` (cross-platform, filtered), `getIntegrationDetail`,
 *              `getConnectionStatus`, `getCredentialTestHistory`.
 *   - Manages: `saveIntegrationConfigScoped`, `savePhoneRouteScoped`,
 *              `testIntegrationCredentialScoped` (all delegate to the preserved
 *              base entry points after a scope check).
 *
 * The serializable, secret-free {@link PlatformCatalog} is built on the server
 * (see `page.tsx`) and handed in as a prop; the dynamic credential fields for
 * the selected integration are driven entirely by its catalog entry. Every
 * displayed credential is at most a last-4 preview — never plaintext or
 * ciphertext (Req 6.10, 11). An empty list or a filtered-empty result renders
 * an empty state, never an error (Req 6.2, 6.4).
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10
 */

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAction, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import type { PlatformCatalog } from "@/lib/integrations/platform/catalog";
import type {
  ConnectionStatus,
  PlatformCredentialField,
  SaveConfigArgs,
} from "@/components/dashboard/platformIntegrationAdmin.logic";
import IntegrationFilters, {
  type IntegrationFilterValue,
} from "@/components/dashboard/controlPlane/IntegrationFilters";
import IntegrationListTable, {
  type IntegrationSummary,
  integrationKey,
} from "@/components/dashboard/controlPlane/IntegrationListTable";
import IntegrationDetailPanel from "@/components/dashboard/controlPlane/IntegrationDetailPanel";
import IntegrationConfigForm, {
  type ConfigFormPlatform,
  type SaveConfigHandler,
  type SaveConfigResult,
} from "@/components/dashboard/controlPlane/IntegrationConfigForm";
import CredentialTestCard from "@/components/dashboard/controlPlane/CredentialTestCard";
import PhoneRouteCard from "@/components/dashboard/controlPlane/PhoneRouteCard";

interface AdminConsoleProps {
  /** Serializable, secret-free platform catalog built on the server (Req 1). */
  catalog: PlatformCatalog;
}

/** A selected `(platformId, tenantId)` pair. */
interface SelectedPair {
  platformId: string;
  tenantId: string;
}

const EMPTY_FILTERS: IntegrationFilterValue = {
  platform: "",
  tenant: "",
  status: "",
};

/**
 * Human-readable message for a scoped-wrapper authorization denial. On the
 * Admin_Console (unrestricted scope) these should never occur in practice, but
 * they are handled so the type contract is honored and any misconfiguration
 * surfaces clearly rather than silently.
 */
function scopedAuthzMessage(
  reason:
    | "unauthenticated"
    | "unrecognized_role"
    | "scope_undeterminable"
    | "out_of_scope"
): string {
  switch (reason) {
    case "unauthenticated":
      return "You are not signed in. Please sign in and try again.";
    case "unrecognized_role":
      return "Your account does not have a recognized Control-Plane role.";
    case "scope_undeterminable":
      return "Your authorization scope could not be determined.";
    case "out_of_scope":
      return "This integration is outside your authorization scope.";
  }
}

export default function AdminConsole({ catalog }: AdminConsoleProps) {
  const router = useRouter();
  const { user, isLoading: userLoading } = useCurrentUser();

  const [filters, setFilters] = useState<IntegrationFilterValue>(EMPTY_FILTERS);
  const [selected, setSelected] = useState<SelectedPair | null>(null);

  // --- Read surfaces ---------------------------------------------------------

  // Only non-empty filter values are sent; the list surface rejects empty
  // filter strings, so a blank field means "no filter" (Req 6.3, 6.4).
  const listArgs = useMemo(() => {
    const args: {
      platform?: string;
      tenant?: string;
      status?: ConnectionStatus;
    } = {};
    if (filters.platform.trim().length > 0) args.platform = filters.platform;
    if (filters.tenant.trim().length > 0) args.tenant = filters.tenant;
    if (filters.status) args.status = filters.status;
    return args;
  }, [filters]);

  const integrations = useQuery(
    api.integrations.controlPlane.listIntegrations,
    listArgs
  );

  const detailResult = useQuery(
    api.integrations.controlPlane.getIntegrationDetail,
    selected
      ? { platformId: selected.platformId, tenantId: selected.tenantId }
      : "skip"
  );

  const connectionStatus = useQuery(
    api.integrations.credentialTestHistory.getConnectionStatus,
    selected
      ? { platformId: selected.platformId, tenantId: selected.tenantId }
      : "skip"
  );

  const testHistory = useQuery(
    api.integrations.credentialTestHistory.getCredentialTestHistory,
    selected
      ? { platformId: selected.platformId, tenantId: selected.tenantId }
      : "skip"
  );

  // --- Management surfaces (delegate to preserved base entry points) ---------

  const saveIntegrationConfigScoped = useAction(
    api.integrations.controlPlaneManagement.saveIntegrationConfigScoped
  );
  const savePhoneRouteScoped = useAction(
    api.integrations.controlPlaneManagement.savePhoneRouteScoped
  );
  const testIntegrationCredentialScoped = useAction(
    api.integrations.controlPlaneManagement.testIntegrationCredentialScoped
  );

  // --- Derived values --------------------------------------------------------

  const selectedKey = selected ? integrationKey(selected) : null;

  const catalogEntry = useMemo(
    () =>
      selected
        ? catalog.find((entry) => entry.platformId === selected.platformId)
        : undefined,
    [catalog, selected]
  );

  const credentialFields: PlatformCredentialField[] =
    catalogEntry?.credentialFields ?? [];

  const detail: IntegrationSummary | null =
    detailResult && detailResult.found ? detailResult.config : null;
  const detailNotFound = detailResult?.found === false;
  // Detail has resolved (found or absent) once the query is no longer undefined.
  const detailLoaded = selected ? detailResult !== undefined : false;

  const currentStatus: ConnectionStatus | undefined =
    connectionStatus && connectionStatus.recorded
      ? connectionStatus.status
      : undefined;

  // --- Handlers --------------------------------------------------------------

  const handleSelect = (summary: IntegrationSummary) => {
    setSelected({
      platformId: summary.platformId,
      tenantId: summary.tenantId,
    });
  };

  const handleSave: SaveConfigHandler = async (
    args: SaveConfigArgs
  ): Promise<SaveConfigResult> => {
    const result = await saveIntegrationConfigScoped(args);
    if (result.ok) {
      return { ok: true };
    }
    if (result.code === "unauthorized") {
      // Surface as a thrown error so the form retains entered values (Req 6.9).
      throw new Error(scopedAuthzMessage(result.reason));
    }
    return { ok: false, code: result.code, field: result.field };
  };

  const handleTest = async (args: {
    platformId: string;
    tenantId: string;
  }): Promise<{ status: ConnectionStatus; error?: string }> => {
    const result = await testIntegrationCredentialScoped(args);
    if (result.ok) {
      return { status: result.status, error: result.error };
    }
    throw new Error(scopedAuthzMessage(result.reason));
  };

  const handleAssignRoute = async (args: {
    phoneNumber: string;
    platformId: string;
    tenantId: string;
    conversationType: string;
  }): Promise<{ routeId: unknown; updated: boolean }> => {
    const result = await savePhoneRouteScoped(args);
    if (result.ok) {
      return { routeId: result.routeId, updated: result.updated };
    }
    throw new Error(scopedAuthzMessage(result.reason));
  };

  // --- Render ----------------------------------------------------------------

  if (userLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-700 border-t-emerald-500 mx-auto" />
          <p className="text-gray-400 text-sm">Loading control plane…</p>
        </div>
      </div>
    );
  }

  const configFormPlatform: ConfigFormPlatform | null =
    catalogEntry
      ? {
          platformId: catalogEntry.platformId,
          displayName: catalogEntry.displayName,
          credentialFields: catalogEntry.credentialFields,
        }
      : null;

  return (
    <div className="min-h-screen bg-black text-white">
      <header className="sticky top-0 z-50 bg-black border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-4">
              <button
                type="button"
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
                  Platform Control Plane
                </h1>
                <p className="text-sm text-gray-400">
                  Manage every platform integration across all tenants
                </p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left: filters + list */}
          <div className="space-y-6">
            <IntegrationFilters
              value={filters}
              onChange={setFilters}
              onClear={() => setFilters(EMPTY_FILTERS)}
            />

            {integrations === undefined ? (
              <section className="card" aria-busy="true">
                <div className="card-content flex items-center gap-3">
                  <div className="animate-spin rounded-full h-5 w-5 border-2 border-gray-700 border-t-emerald-500" />
                  <p className="text-sm text-gray-400">Loading integrations…</p>
                </div>
              </section>
            ) : (
              <IntegrationListTable
                integrations={integrations}
                selectedKey={selectedKey}
                onSelect={handleSelect}
                emptyMessage={
                  filters.platform || filters.tenant || filters.status
                    ? "No integrations match the current filters."
                    : "No integrations have been configured yet."
                }
              />
            )}
          </div>

          {/* Right: detail + management */}
          <div className="space-y-6">
            <IntegrationDetailPanel
              detail={detail}
              notFound={detailNotFound}
              credentialFields={credentialFields}
            />

            {selected && detailLoaded && configFormPlatform && (
              <>
                <IntegrationConfigForm
                  key={`${selected.platformId}::${selected.tenantId}`}
                  platform={configFormPlatform}
                  tenantId={selected.tenantId}
                  storedLast4={detail?.credentialsLast4}
                  initialValues={
                    detail
                      ? {
                          baseUrl: detail.baseUrl,
                          platformTenantId: detail.platformTenantId,
                          allowedConversationTypes:
                            detail.allowedConversationTypes,
                          config: detail.config,
                        }
                      : undefined
                  }
                  actorUserId={user?.userId}
                  actorRole={user?.role}
                  onSave={handleSave}
                />

                <CredentialTestCard
                  platformId={selected.platformId}
                  tenantId={selected.tenantId}
                  onTest={handleTest}
                  currentStatus={currentStatus}
                  history={testHistory ?? undefined}
                />

                <PhoneRouteCard
                  platformId={selected.platformId}
                  tenantId={selected.tenantId}
                  allowedConversationTypes={
                    detail?.allowedConversationTypes ?? []
                  }
                  savePhoneRoute={handleAssignRoute}
                />
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
