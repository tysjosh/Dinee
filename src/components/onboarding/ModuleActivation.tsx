"use client";

import React, { useCallback } from "react";
import { motion } from "motion/react";
import type { Vertical } from "@/lib/modules/types";

export interface ModuleActivationProps {
  vertical: Vertical;
  enabledModules: string[];
  onModulesChange: (modules: string[]) => void;
}

interface ModuleOption {
  moduleId: string;
  label: string;
  description: string;
  icon: string;
  alwaysEnabled?: boolean;
}

const VERTICAL_PACK_MAP: Record<Vertical, string> = {
  restaurant: "restaurant_pack",
  logistics: "logistics_pack",
  healthcare: "healthcare_pack",
  legal: "legal_pack",
  hospitality: "hospitality_pack",
  general_services: "general_services_pack",
};

const VERTICAL_PACK_LABELS: Record<string, { label: string; description: string; icon: string }> = {
  restaurant_pack: {
    label: "Restaurant Pack",
    description: "Menu management, food ordering, and reservation handling",
    icon: "🍽️",
  },
  logistics_pack: {
    label: "Logistics Pack",
    description: "Shipment tracking, rider dispatch, and delivery management",
    icon: "🚚",
  },
  healthcare_pack: {
    label: "Healthcare Pack",
    description: "Patient appointments, medical inquiries, and clinic workflows",
    icon: "🏥",
  },
  legal_pack: {
    label: "Legal Pack",
    description: "Consultation booking, case inquiries, and client intake",
    icon: "⚖️",
  },
  hospitality_pack: {
    label: "Hospitality Pack",
    description: "Room reservations, guest services, and concierge support",
    icon: "🏨",
  },
  general_services_pack: {
    label: "General Services Pack",
    description: "Appointment scheduling, service inquiries, and callbacks",
    icon: "🏢",
  },
};

function getModuleOptions(vertical: Vertical): ModuleOption[] {
  const options: ModuleOption[] = [
    {
      moduleId: "core_platform",
      label: "Core Platform",
      description: "Calls, transcripts, contacts, appointments, and settings",
      icon: "🔧",
      alwaysEnabled: true,
    },
  ];

  const packId = VERTICAL_PACK_MAP[vertical];
  const packInfo = VERTICAL_PACK_LABELS[packId];
  if (packInfo) {
    options.push({
      moduleId: packId,
      label: packInfo.label,
      description: packInfo.description,
      icon: packInfo.icon,
    });
  }

  if (vertical === "logistics") {
    options.push({
      moduleId: "runsheet_connect",
      label: "Runsheet Connect",
      description: "Automated dispatch integration with Runsheet logistics platform",
      icon: "🔗",
    });
  }

  return options;
}

/**
 * Module Activation step for the onboarding wizard.
 * Shows available vertical packs for the selected vertical with toggle switches.
 * core_platform is always enabled and non-toggleable.
 *
 * Requirements: 12.2
 */
const ModuleActivation: React.FC<ModuleActivationProps> = ({
  vertical,
  enabledModules,
  onModulesChange,
}) => {
  const modules = getModuleOptions(vertical);

  const handleToggle = useCallback(
    (moduleId: string) => {
      if (moduleId === "core_platform") return;

      const isEnabled = enabledModules.includes(moduleId);
      const next = isEnabled
        ? enabledModules.filter((m) => m !== moduleId)
        : [...enabledModules, moduleId];
      onModulesChange(next);
    },
    [enabledModules, onModulesChange]
  );

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
            Activate Modules
          </h1>
          <p className="text-white/70 text-minimal">
            Choose which modules to enable for your business
          </p>
        </motion.div>

        {/* Module Toggles */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="space-y-4"
          role="group"
          aria-label="Module activation toggles"
        >
          {modules.map((mod, index) => {
            const isEnabled =
              mod.alwaysEnabled || enabledModules.includes(mod.moduleId);

            return (
              <motion.div
                key={mod.moduleId}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.1 + index * 0.05 }}
              >
                <div
                  className={`card-minimal rounded-xl p-5 transition-all duration-200 ${
                    isEnabled
                      ? "ring-1 ring-emerald-500/30 border-emerald-500/20"
                      : "opacity-70"
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <span className="text-3xl flex-shrink-0" role="img" aria-hidden="true">
                      {mod.icon}
                    </span>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-white font-medium text-lg">
                        {mod.label}
                      </h3>
                      <p className="text-white/60 text-sm mt-1">
                        {mod.description}
                      </p>
                    </div>
                    <div className="flex-shrink-0">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={isEnabled}
                        aria-label={`${mod.label}: ${isEnabled ? "enabled" : "disabled"}`}
                        disabled={mod.alwaysEnabled}
                        onClick={() => handleToggle(mod.moduleId)}
                        className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-gray-900 ${
                          isEnabled
                            ? "bg-emerald-500"
                            : "bg-white/20"
                        } ${mod.alwaysEnabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
                      >
                        <span
                          className={`inline-block size-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                            isEnabled ? "translate-x-6" : "translate-x-1"
                          }`}
                        />
                      </button>
                      {mod.alwaysEnabled && (
                        <span className="sr-only">Always enabled</span>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      </motion.div>
    </div>
  );
};

export default ModuleActivation;
