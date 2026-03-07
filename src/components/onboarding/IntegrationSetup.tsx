"use client";

import React, { useCallback, useState } from "react";
import { motion } from "motion/react";
import type { Vertical } from "@/lib/modules/types";

/**
 * Configuration collected during onboarding for Runsheet Connect.
 * The webhookUrl is auto-generated later; this captures user-provided fields.
 */
export interface RunsheetConfig {
  apiKey: string;
  tenantMapping: Record<string, string>; // locationId → hubId
}

export interface IntegrationSetupProps {
  vertical: Vertical;
  enabledModules: string[];
  onConfigChange: (config: RunsheetConfig) => void;
  config?: RunsheetConfig;
}

/**
 * Integration Setup step (conditional) for the onboarding wizard.
 * Shows Runsheet Connect configuration when logistics vertical is selected
 * and runsheet_connect module is enabled.
 *
 * Requirements: 12.3, 12.7
 */
const IntegrationSetup: React.FC<IntegrationSetupProps> = ({
  vertical,
  enabledModules,
  onConfigChange,
  config,
}) => {
  const [apiKey, setApiKey] = useState(config?.apiKey ?? "");
  const [showApiKey, setShowApiKey] = useState(false);
  const [mappings, setMappings] = useState<Array<{ locationId: string; hubId: string }>>(
    config?.tenantMapping
      ? Object.entries(config.tenantMapping).map(([locationId, hubId]) => ({ locationId, hubId }))
      : [{ locationId: "", hubId: "" }]
  );
  const [skipped, setSkipped] = useState(false);

  const showRunsheet = vertical === "logistics" && enabledModules.includes("runsheet_connect");

  const emitConfig = useCallback(
    (key: string, pairs: Array<{ locationId: string; hubId: string }>) => {
      const tenantMapping: Record<string, string> = {};
      for (const pair of pairs) {
        if (pair.locationId.trim() && pair.hubId.trim()) {
          tenantMapping[pair.locationId.trim()] = pair.hubId.trim();
        }
      }
      onConfigChange({ apiKey: key, tenantMapping });
    },
    [onConfigChange]
  );

  const handleApiKeyChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setApiKey(val);
      setSkipped(false);
      emitConfig(val, mappings);
    },
    [mappings, emitConfig]
  );

  const handleMappingChange = useCallback(
    (index: number, field: "locationId" | "hubId", value: string) => {
      const next = mappings.map((m, i) => (i === index ? { ...m, [field]: value } : m));
      setMappings(next);
      setSkipped(false);
      emitConfig(apiKey, next);
    },
    [mappings, apiKey, emitConfig]
  );

  const addMapping = useCallback(() => {
    setMappings((prev) => [...prev, { locationId: "", hubId: "" }]);
  }, []);

  const removeMapping = useCallback(
    (index: number) => {
      const next = mappings.filter((_, i) => i !== index);
      const updated = next.length === 0 ? [{ locationId: "", hubId: "" }] : next;
      setMappings(updated);
      emitConfig(apiKey, updated);
    },
    [mappings, apiKey, emitConfig]
  );

  const handleSkip = useCallback(() => {
    setSkipped(true);
    onConfigChange({ apiKey: "", tenantMapping: {} });
  }, [onConfigChange]);

  // Don't render if conditions aren't met
  if (!showRunsheet) {
    return null;
  }

  return (
    <div className="flex items-center justify-center min-h-screen px-6 py-20">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="max-w-2xl w-full space-y-8"
      >
        {/* Title */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="text-center"
        >
          <h1 className="text-3xl text-white mb-3 text-minimal">
            Connect Integrations
          </h1>
          <p className="text-white/70 text-minimal">
            Link your Runsheet account for automated dispatch
          </p>
        </motion.div>

        {skipped ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="card-minimal rounded-xl p-6 text-center space-y-4"
          >
            <p className="text-white/60 text-sm">
              Integration setup skipped. You can configure this later in Settings.
            </p>
            <button
              type="button"
              onClick={() => setSkipped(false)}
              className="text-emerald-400 hover:text-emerald-300 text-sm font-medium transition-colors"
            >
              Set up now instead
            </button>
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="space-y-6"
          >
            {/* Runsheet Connect Card */}
            <div className="card-minimal rounded-xl p-6 space-y-6">
              <div className="flex items-center gap-3">
                <span className="text-2xl" role="img" aria-hidden="true">🔗</span>
                <div>
                  <h2 className="text-white font-medium text-lg">Runsheet Connect</h2>
                  <p className="text-white/60 text-sm">
                    Automate dispatch with your Runsheet logistics platform
                  </p>
                </div>
              </div>

              {/* API Key */}
              <div className="space-y-2">
                <label
                  htmlFor="runsheet-api-key"
                  className="block text-white/80 text-sm font-medium"
                >
                  API Key
                </label>
                <div className="relative">
                  <input
                    id="runsheet-api-key"
                    type={showApiKey ? "text" : "password"}
                    value={apiKey}
                    onChange={handleApiKeyChange}
                    placeholder="Enter your Runsheet API key"
                    autoComplete="off"
                    aria-describedby="api-key-hint"
                    className="w-full rounded-lg bg-white/5 border border-white/10 px-4 py-3 pr-12 text-white placeholder-white/30 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500/50 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey((v) => !v)}
                    aria-label={showApiKey ? "Hide API key" : "Show API key"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition-colors p-1"
                  >
                    {showApiKey ? (
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12c1.292 4.338 5.31 7.5 10.066 7.5.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                      </svg>
                    )}
                  </button>
                </div>
                <p id="api-key-hint" className="text-white/40 text-xs">
                  Find this in your Runsheet dashboard under API Settings
                </p>
              </div>

              {/* Tenant Mapping */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="block text-white/80 text-sm font-medium">
                    Location Mapping
                  </label>
                  <span className="text-white/40 text-xs">Map locations to Runsheet hub IDs</span>
                </div>

                <div className="space-y-3" role="list" aria-label="Location to hub ID mappings">
                  {mappings.map((mapping, index) => (
                    <div key={index} role="listitem" className="flex items-center gap-3">
                      <div className="flex-1">
                        <label htmlFor={`location-${index}`} className="sr-only">
                          Location ID {index + 1}
                        </label>
                        <input
                          id={`location-${index}`}
                          type="text"
                          value={mapping.locationId}
                          onChange={(e) => handleMappingChange(index, "locationId", e.target.value)}
                          placeholder="Location ID"
                          className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-white placeholder-white/30 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500/50 transition-colors"
                        />
                      </div>
                      <span className="text-white/30 text-sm" aria-hidden="true">→</span>
                      <div className="flex-1">
                        <label htmlFor={`hub-${index}`} className="sr-only">
                          Hub ID {index + 1}
                        </label>
                        <input
                          id={`hub-${index}`}
                          type="text"
                          value={mapping.hubId}
                          onChange={(e) => handleMappingChange(index, "hubId", e.target.value)}
                          placeholder="Runsheet Hub ID"
                          className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-white placeholder-white/30 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500/50 transition-colors"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeMapping(index)}
                        aria-label={`Remove mapping ${index + 1}`}
                        disabled={mappings.length === 1 && !mapping.locationId && !mapping.hubId}
                        className="p-2 text-white/30 hover:text-red-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18 18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={addMapping}
                  className="flex items-center gap-2 text-emerald-400 hover:text-emerald-300 text-sm font-medium transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  Add mapping
                </button>
              </div>
            </div>

            {/* Skip option */}
            <div className="text-center">
              <button
                type="button"
                onClick={handleSkip}
                className="text-white/50 hover:text-white/70 text-sm transition-colors"
              >
                Skip for now — you can set this up later
              </button>
            </div>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
};

export default IntegrationSetup;
