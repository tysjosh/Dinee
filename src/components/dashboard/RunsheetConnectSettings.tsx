"use client";

import React, { useState } from "react";
import Button from "@/components/ui/Button";

/**
 * Runsheet Connect integration configuration UI.
 * Displayed under Business Settings > Integrations when logistics_pack is active.
 *
 * Features:
 * - API key input with masked display (last 4 chars only) (Req 18.2)
 * - Tenant mapping editor (Location → Runsheet hub ID) (Req 7.2)
 * - Health status panel: connection status, last sync, failure count (Req 7.5)
 * - RBAC: restrict connect/disconnect to business_owner and platform_admin (Req 18.6)
 *
 * Requirements: 7.1, 7.2, 7.5, 7.6, 18.2, 18.6
 */

interface RunsheetIntegration {
  apiKeyLast4: string;
  status: "connected" | "disconnected" | "error";
  lastSyncAt?: number;
  failureCount?: number;
  credentialExpiresAt?: number;
  tenantMapping: Record<string, string>;
}

interface RunsheetConnectSettingsProps {
  integration?: RunsheetIntegration | null;
  userRole?: string;
  onConnect: (apiKey: string, tenantMapping: Record<string, string>) => Promise<void>;
  onDisconnect: () => Promise<void>;
  onRotateKey: (newApiKey: string) => Promise<void>;
}

const ALLOWED_ROLES = ["business_owner", "platform_admin"];

const RunsheetConnectSettings: React.FC<RunsheetConnectSettingsProps> = ({
  integration,
  userRole = "branch_manager",
  onConnect,
  onDisconnect,
  onRotateKey,
}) => {
  const [apiKey, setApiKey] = useState("");
  const [mappingEntries, setMappingEntries] = useState<Array<{ locationId: string; hubId: string }>>([
    { locationId: "", hubId: "" },
  ]);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  const [showRotateForm, setShowRotateForm] = useState(false);
  const [newApiKey, setNewApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const canManage = ALLOWED_ROLES.includes(userRole);
  const isConnected = integration?.status === "connected";
  const hasError = integration?.status === "error";

  const clearMessages = () => {
    setError(null);
    setSuccess(null);
  };

  const handleConnect = async () => {
    clearMessages();
    if (!apiKey.trim()) {
      setError("API key is required");
      return;
    }

    const mapping: Record<string, string> = {};
    for (const entry of mappingEntries) {
      if (entry.locationId.trim() && entry.hubId.trim()) {
        mapping[entry.locationId.trim()] = entry.hubId.trim();
      }
    }

    setIsConnecting(true);
    try {
      await onConnect(apiKey, mapping);
      setSuccess("Runsheet Connect configured successfully");
      setApiKey("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect");
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    clearMessages();
    setIsDisconnecting(true);
    try {
      await onDisconnect();
      setSuccess("Runsheet Connect disconnected");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect");
    } finally {
      setIsDisconnecting(false);
    }
  };

  const handleRotateKey = async () => {
    clearMessages();
    if (!newApiKey.trim()) {
      setError("New API key is required");
      return;
    }
    setIsRotating(true);
    try {
      await onRotateKey(newApiKey);
      setSuccess("API key rotated successfully");
      setNewApiKey("");
      setShowRotateForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Key rotation failed. Old key retained.");
    } finally {
      setIsRotating(false);
    }
  };

  const addMappingEntry = () => {
    setMappingEntries((prev) => [...prev, { locationId: "", hubId: "" }]);
  };

  const updateMappingEntry = (index: number, field: "locationId" | "hubId", value: string) => {
    setMappingEntries((prev) =>
      prev.map((entry, i) => (i === index ? { ...entry, [field]: value } : entry))
    );
  };

  const removeMappingEntry = (index: number) => {
    setMappingEntries((prev) => prev.filter((_, i) => i !== index));
  };

  // Credential expiry warnings (Req 18.4)
  const getExpiryWarning = (): { level: "danger" | "warning" | "info"; message: string } | null => {
    if (!integration?.credentialExpiresAt) return null;
    const now = Date.now();
    const daysUntilExpiry = Math.ceil((integration.credentialExpiresAt - now) / (1000 * 60 * 60 * 24));

    if (daysUntilExpiry <= 0) {
      return { level: "danger", message: "Credentials have expired. Outbound calls are paused. Please renew your API key." };
    }
    if (daysUntilExpiry <= 1) {
      return { level: "danger", message: "Credentials expire tomorrow. Renew now to avoid service interruption." };
    }
    if (daysUntilExpiry <= 7) {
      return { level: "warning", message: `Credentials expire in ${daysUntilExpiry} days. Consider rotating your API key.` };
    }
    if (daysUntilExpiry <= 30) {
      return { level: "info", message: `Credentials expire in ${daysUntilExpiry} days.` };
    }
    return null;
  };

  const expiryWarning = getExpiryWarning();

  if (!canManage) {
    return (
      <div className="card-minimal rounded-xl">
        <div className="bg-white/5 border-b border-white/10 px-4 sm:px-6 py-4">
          <h2 className="text-base font-semibold text-white">Runsheet Connect</h2>
        </div>
        <div className="px-4 sm:px-6 py-6 text-center">
          <p className="text-sm text-white/60">
            You don&apos;t have permission to manage integrations. Contact your business owner.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Status & Health Panel */}
      <div className="card-minimal rounded-xl">
        <div className="bg-white/5 border-b border-white/10 px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-white">Runsheet Connect</h2>
              <p className="text-sm text-white/70 mt-1">Logistics dispatch integration</p>
            </div>
            <div className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-sm font-medium ${
              isConnected
                ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
                : hasError
                  ? "bg-red-500/10 border border-red-500/20 text-red-400"
                  : "bg-gray-500/10 border border-gray-500/20 text-gray-400"
            }`}>
              <div className={`w-2 h-2 rounded-full ${
                isConnected ? "bg-emerald-500" : hasError ? "bg-red-500" : "bg-gray-500"
              }`} />
              <span>{isConnected ? "Connected" : hasError ? "Error" : "Disconnected"}</span>
            </div>
          </div>
        </div>

        {integration && (
          <div className="px-4 sm:px-6 py-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-white/50 uppercase tracking-wider">API Key</p>
                <p className="text-sm text-white mt-1 font-mono">
                  ••••••••{integration.apiKeyLast4}
                </p>
              </div>
              <div>
                <p className="text-xs text-white/50 uppercase tracking-wider">Last Sync</p>
                <p className="text-sm text-white mt-1">
                  {integration.lastSyncAt
                    ? new Date(integration.lastSyncAt).toLocaleString()
                    : "Never"}
                </p>
              </div>
              <div>
                <p className="text-xs text-white/50 uppercase tracking-wider">Failure Count</p>
                <p className={`text-sm mt-1 ${
                  (integration.failureCount ?? 0) > 0 ? "text-red-400" : "text-white"
                }`}>
                  {integration.failureCount ?? 0}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Expiry Warning (Req 18.4, 18.5) */}
      {expiryWarning && (
        <div className={`rounded-xl border px-4 sm:px-6 py-4 ${
          expiryWarning.level === "danger"
            ? "bg-red-500/10 border-red-500/20"
            : expiryWarning.level === "warning"
              ? "bg-amber-500/10 border-amber-500/20"
              : "bg-blue-500/10 border-blue-500/20"
        }`}>
          <div className="flex items-start space-x-3">
            <svg className={`w-5 h-5 flex-shrink-0 mt-0.5 ${
              expiryWarning.level === "danger" ? "text-red-400"
                : expiryWarning.level === "warning" ? "text-amber-400" : "text-blue-400"
            }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <p className={`text-sm ${
              expiryWarning.level === "danger" ? "text-red-300"
                : expiryWarning.level === "warning" ? "text-amber-300" : "text-blue-300"
            }`}>
              {expiryWarning.message}
            </p>
          </div>
        </div>
      )}

      {/* Feedback Messages */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}
      {success && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3">
          <p className="text-sm text-emerald-400">{success}</p>
        </div>
      )}

      {/* Connect Form (when disconnected) */}
      {!integration || integration.status === "disconnected" ? (
        <div className="card-minimal rounded-xl">
          <div className="bg-white/5 border-b border-white/10 px-4 sm:px-6 py-4">
            <h3 className="text-sm font-semibold text-white">Connect to Runsheet</h3>
          </div>
          <div className="px-4 sm:px-6 py-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-white mb-2">
                API Key <span className="text-red-400" aria-label="required">*</span>
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => { setApiKey(e.target.value); clearMessages(); }}
                placeholder="Enter your Runsheet API key"
                className="w-full px-3 py-2.5 bg-white/5 border border-white/20 rounded-lg text-white text-sm placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                autoComplete="off"
              />
            </div>

            {/* Tenant Mapping */}
            <div>
              <label className="block text-sm font-medium text-white mb-2">
                Location → Hub Mapping
              </label>
              <div className="space-y-2">
                {mappingEntries.map((entry, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={entry.locationId}
                      onChange={(e) => updateMappingEntry(index, "locationId", e.target.value)}
                      placeholder="Location ID"
                      className="flex-1 px-3 py-2 bg-white/5 border border-white/20 rounded-lg text-white text-sm placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                    />
                    <span className="text-white/40 text-sm">→</span>
                    <input
                      type="text"
                      value={entry.hubId}
                      onChange={(e) => updateMappingEntry(index, "hubId", e.target.value)}
                      placeholder="Runsheet Hub ID"
                      className="flex-1 px-3 py-2 bg-white/5 border border-white/20 rounded-lg text-white text-sm placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                    />
                    {mappingEntries.length > 1 && (
                      <button
                        onClick={() => removeMappingEntry(index)}
                        className="p-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors"
                        aria-label="Remove mapping"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button
                onClick={addMappingEntry}
                className="mt-2 text-sm text-emerald-400 hover:text-emerald-300 transition-colors"
              >
                + Add mapping
              </button>
            </div>

            <Button onClick={handleConnect} loading={isConnecting} disabled={isConnecting}>
              {isConnecting ? "Connecting..." : "Connect"}
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* Key Rotation (Req 18.3) */}
          <div className="card-minimal rounded-xl">
            <div className="bg-white/5 border-b border-white/10 px-4 sm:px-6 py-4">
              <h3 className="text-sm font-semibold text-white">API Key Management</h3>
            </div>
            <div className="px-4 sm:px-6 py-4 space-y-4">
              {showRotateForm ? (
                <div className="space-y-3">
                  <label className="block text-sm font-medium text-white">
                    New API Key <span className="text-red-400" aria-label="required">*</span>
                  </label>
                  <input
                    type="password"
                    value={newApiKey}
                    onChange={(e) => { setNewApiKey(e.target.value); clearMessages(); }}
                    placeholder="Enter new Runsheet API key"
                    className="w-full px-3 py-2.5 bg-white/5 border border-white/20 rounded-lg text-white text-sm placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                    autoComplete="off"
                  />
                  <div className="flex gap-2">
                    <Button onClick={handleRotateKey} loading={isRotating} disabled={isRotating}>
                      {isRotating ? "Rotating..." : "Rotate Key"}
                    </Button>
                    <Button variant="outline" onClick={() => { setShowRotateForm(false); setNewApiKey(""); clearMessages(); }}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <p className="text-sm text-white/70">
                    Current key ending in <span className="font-mono text-white">{integration?.apiKeyLast4}</span>
                  </p>
                  <Button variant="outline" onClick={() => setShowRotateForm(true)}>
                    Rotate Key
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Disconnect */}
          <div className="bg-black border border-red-500/20 rounded-xl">
            <div className="px-4 sm:px-6 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium text-red-400">Disconnect Integration</h3>
                  <p className="text-sm text-white/60 mt-1">
                    This will stop syncing with Runsheet and disable logistics dispatch features.
                  </p>
                </div>
                <Button variant="destructive" onClick={handleDisconnect} loading={isDisconnecting} disabled={isDisconnecting}>
                  {isDisconnecting ? "Disconnecting..." : "Disconnect"}
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default RunsheetConnectSettings;
