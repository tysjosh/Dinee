"use client";

/**
 * Partner_Console — platform-control-plane (Task 7.3).
 *
 * The partner self-service view. It composes the SAME shared Control-Plane
 * cards as the Admin_Console, but reads exclusively through the partner-scoped
 * `listForPartner` surface, so every displayed integration, phone-route
 * assignment, and credential field is limited to the partner's
 * Authorization_Scope (Req 7.1, 7.2). Unlike the Admin_Console it exposes NO
 * cross-tenant filters — the scope already narrows the list.
 *
 * Scope safety is enforced on both sides:
 *   - Client-side: the console only ever surfaces integrations returned by
 *     `listForPartner` (in-scope by construction) and only offers management
 *     actions for the selected in-scope pair, so an out-of-scope submission is
 *     never composable in the UI (Req 7.6, client-side block).
 *   - Server-side: the scoped management wrappers re-verify scope and reject an
 *     out-of-scope pair with `{ ok: false, code: "unauthorized",
 *     reason: "out_of_scope" }`, leaving the integration byte-for-byte
 *     unchanged. These handlers surface that denial as an inline error
 *     indication (Req 7.6, server-side rejection).
 *
 * Empty scope (`listForPartner` returns `[]`) renders an empty integration view
 * with no error (Req 7.5). Every credential is shown only as its last-4 preview
 * — never plaintext or ciphertext (Req 7.4, Req 11).
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6
 */

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAction, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import type { PlatformCatalog } from "@/lib/integrations/platform/catalog";
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
import CredentialTestCard, {
  type CredentialTestHistoryEntry,
} from "@/components/dashboard/controlPlane/CredentialTestCard";
import PhoneRouteCard from "@/components/dashboard/controlPlane/PhoneRouteCard";
import {
  type ConnectionStatus,
  type PlatformCredentialField,
} from "@/components/dashboard/platformIntegrationAdmin.logic";

export interface PartnerConsoleProps {
  /** Serializable, secret-free catalog projected on the server (Req 1). */
  catalog: PlatformCatalog;
}

/** Human-readable message for a scoped-wrapper authorization denial (Req 7.6). */
function scopedDenialMessage(
  reason:
    | "unauthenticated"
    | "unrecognized_role"
    | "scope_undeterminable"
    | "out_of_scope"
): string {
  return reason === "out_of_scope"
    ? "This integration is outside your authorization scope; nothing was changed."
    : "You are not authorized to perform this action.";
}

export default function PartnerConsole({ catalog }: PartnerConsoleProps) {
  const router = useRouter();
  const { isLoading: userLoading, isAuthenticated } = useCurrentUser();

  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // --- Partner-scoped reads --------------------------------------------------
  // The ONLY list read: returns exactly the integrations within the partner's
  // Authorization_Scope, masked (Req 7.1, 7.2).
  const integrations = useQuery(
    api.integrations.controlPlane.listForPartner,
    isAuthenticated ? {} : "skip"
  ) as IntegrationSummary[] | undefined;

  // Default-select the first in-scope integration once the list loads so a
  // single-integration partner lands directly on their configuration.
  useEffect(() => {
    if (!selectedKey && integrations && integrations.length > 0) {
      setSelectedKey(integrationKey(integrations[0]));
    }
  }, [integrations, selectedKey]);

  const selected = useMemo<IntegrationSummary | null>(() => {
    if (!integrations || !selectedKey) return null;
    return integrations.find((row) => integrationKey(row) === selectedKey) ?? null;
  }, [integrations, selectedKey]);

  // Resolve the selected integration's catalog entry to drive the dynamic
  // credential fields and labels (Req 7.4).
  const catalogEntry = useMemo(() => {
    if (!selected) return null;
    return catalog.find((entry) => entry.platformId === selected.platformId) ?? null;
  }, [catalog, selected]);

  const credentialFields: PlatformCredentialField[] = useMemo(
    () => catalogEntry?.credentialFields ?? [],
    [catalogEntry]
  );

  // Live connection status + credential-test history for the selected pair.
  // Both are authorized + scope-checked server-side (Req 8.7).
  const connectionStatus = useQuery(
    api.integrations.credentialTestHistory.getConnectionStatus,
    selected
      ? { platformId: selected.platformId, tenantId: selected.tenantId }
      : "skip"
  );
  const history = useQuery(
    api.integrations.credentialTestHistory.getCredentialTestHistory,
    selected
      ? { platformId: selected.platformId, tenantId: selected.tenantId }
      : "skip"
  );

  // --- Scoped management wrappers (delegate + server-side scope re-check) -----
  const saveIntegrationConfigScoped = useAction(
    api.integrations.controlPlaneManagement.saveIntegrationConfigScoped
  );
  const savePhoneRouteScoped = useAction(
    api.integrations.controlPlaneManagement.savePhoneRouteScoped
  );
  const testIntegrationCredentialScoped = useAction(
    api.integrations.controlPlaneManagement.testIntegrationCredentialScoped
  );

  const handleSave: SaveConfigHandler = async (args) => {
    const result = await saveIntegrationConfigScoped(args);
    // A scope/role denial leaves the integration unchanged; surface it as an
    // error so the form retains the entered values (Req 7.6).
    if (!result.ok && result.code === "unauthorized") {
      throw new Error(scopedDenialMessage(result.reason));
    }
    return result as SaveConfigResult;
  };

  const handleSavePhoneRoute = async (args: {
    phoneNumber: string;
    platformId: string;
    tenantId: string;
    conversationType: string;
  }) => {
    const result = await savePhoneRouteScoped(args);
    if (!result.ok) {
      throw new Error(scopedDenialMessage(result.reason));
    }
    return { routeId: result.routeId, updated: result.updated };
  };

  const handleTest = async (args: {
    platformId: string;
    tenantId: string;
  }): Promise<{ status: ConnectionStatus; error?: string }> => {
    const result = await testIntegrationCredentialScoped(args);
    if (!result.ok) {
      // Render the denial as a non-connected status with an explanatory error.
      return { status: "error", error: scopedDenialMessage(result.reason) };
    }
    return { status: result.status, error: result.error };
  };

  const historyEntries: CredentialTestHistoryEntry[] = useMemo(
    () =>
      (history ?? []).map((record) => ({
        outcome: record.outcome,
        completedAt: record.completedAt,
      })),
    [history]
  );

  const currentStatus: ConnectionStatus | undefined =
    connectionStatus && connectionStatus.recorded
      ? connectionStatus.status
      : undefined;

  const configFormPlatform: ConfigFormPlatform | null = useMemo(() => {
    if (!catalogEntry) return null;
    return {
      platformId: catalogEntry.platformId,
      displayName: catalogEntry.displayName,
      credentialFields: catalogEntry.credentialFields,
    };
  }, [catalogEntry]);

  // --- Render ----------------------------------------------------------------

  if (userLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-700 border-t-emerald-500 mx-auto" />
          <p className="text-gray-400 text-sm">Loading your integrations…</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center px-4">
        <div className="card max-w-md text-center">
          <div className="card-content space-y-2">
            <h1 className="text-lg font-semibold text-white">Sign in required</h1>
            <p className="text-sm text-gray-400">
              You must be signed in to view your platform integrations.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const isLoadingList = integrations === undefined;

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-black border-b border-gray-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
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
                  Partner console
                </h1>
                <p className="text-sm text-gray-400">
                  Manage the platform integrations assigned to your account
                </p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {isLoadingList ? (
          <div className="flex items-center justify-center py-16">
            <div className="text-center space-y-4">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-700 border-t-emerald-500 mx-auto" />
              <p className="text-gray-400 text-sm">Loading your integrations…</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
            {/* Scoped integration list (Req 7.1, 7.2). Empty scope → empty
                view with no error (Req 7.5). */}
            <div className="lg:col-span-2 space-y-6">
              <IntegrationListTable
                integrations={integrations}
                selectedKey={selectedKey}
                onSelect={(summary) => setSelectedKey(integrationKey(summary))}
                emptyMessage="No integrations are assigned to your account yet."
              />
            </div>

            {/* Detail + scoped management for the selected in-scope pair. */}
            <div className="lg:col-span-3 space-y-6">
              <IntegrationDetailPanel
                detail={selected}
                credentialFields={credentialFields}
                emptyMessage="Select an integration to view and manage it."
              />

              {selected && configFormPlatform && (
                <>
                  <IntegrationConfigForm
                    platform={configFormPlatform}
                    tenantId={selected.tenantId}
                    storedLast4={selected.credentialsLast4}
                    initialValues={{
                      baseUrl: selected.baseUrl,
                      platformTenantId: selected.platformTenantId,
                      allowedConversationTypes: selected.allowedConversationTypes,
                      config: selected.config,
                    }}
                    onSave={handleSave}
                  />

                  <CredentialTestCard
                    platformId={selected.platformId}
                    tenantId={selected.tenantId}
                    onTest={handleTest}
                    currentStatus={currentStatus}
                    history={historyEntries}
                  />

                  <PhoneRouteCard
                    platformId={selected.platformId}
                    tenantId={selected.tenantId}
                    allowedConversationTypes={selected.allowedConversationTypes}
                    savePhoneRoute={handleSavePhoneRoute}
                  />
                </>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
