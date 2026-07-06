"use client";

import React, { useCallback } from "react";
import { motion } from "motion/react";
import type { Vertical } from "@/lib/modules/types";

export interface BusinessTypeSelectionProps {
  onSelect: (vertical: Vertical) => void;
  selectedVertical?: Vertical;
}

interface VerticalOption {
  value: Vertical;
  label: string;
  icon: string;
  description: string;
  /** Whether this vertical is fully implemented (real dashboard + tools). */
  available: boolean;
}

// Only Restaurant and Logistics have real dashboards and wired tool handlers.
// Healthcare/Legal/Hospitality/General Services are prompt-only today (no
// dashboard, no backend handlers), so they are shown as "Coming soon" and are
// not selectable — an onboarded business there would hit dead ends.
const VERTICAL_OPTIONS: VerticalOption[] = [
  {
    value: "restaurant",
    label: "Restaurant",
    icon: "🍽️",
    description: "Food ordering, menu management, and reservation handling",
    available: true,
  },
  {
    value: "logistics",
    label: "Logistics",
    icon: "🚚",
    description: "Shipment tracking, rider dispatch, and delivery management",
    available: true,
  },
  {
    value: "healthcare",
    label: "Healthcare",
    icon: "🏥",
    description: "Patient appointments, inquiries, and clinic management",
    available: false,
  },
  {
    value: "legal",
    label: "Legal",
    icon: "⚖️",
    description: "Consultation booking, case inquiries, and client intake",
    available: false,
  },
  {
    value: "hospitality",
    label: "Hospitality",
    icon: "🏨",
    description: "Room reservations, guest services, and concierge support",
    available: false,
  },
  {
    value: "general_services",
    label: "General Services",
    icon: "🏢",
    description: "Appointment scheduling, service inquiries, and callbacks",
    available: false,
  },
];

/**
 * Business Type Selection step for the onboarding wizard.
 * Displays a grid of 6 vertical options with icons and descriptions.
 * Each option is a clickable card that highlights when selected.
 *
 * Requirements: 12.1, 12.5, 2.2, 2.3, 2.7
 */
const BusinessTypeSelection: React.FC<BusinessTypeSelectionProps> = ({
  onSelect,
  selectedVertical,
}) => {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, vertical: Vertical, available: boolean) => {
      if (!available) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelect(vertical);
      }
    },
    [onSelect]
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
            Business Setup
          </h1>
          <p className="text-white/70 text-minimal">
            What type of business are you setting up?
          </p>
        </motion.div>

        {/* Vertical Options Grid */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          role="radiogroup"
          aria-label="Select your business type"
          className="grid grid-cols-1 sm:grid-cols-2 gap-4"
        >
          {VERTICAL_OPTIONS.map((option, index) => {
            const isSelected = selectedVertical === option.value;
            const isAvailable = option.available;

            return (
              <motion.div
                key={option.value}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.1 + index * 0.05 }}
              >
                <div
                  role="radio"
                  aria-checked={isSelected}
                  aria-disabled={!isAvailable}
                  aria-label={`${option.label}: ${option.description}${
                    isAvailable ? "" : " (coming soon)"
                  }`}
                  tabIndex={isAvailable ? 0 : -1}
                  onClick={() => isAvailable && onSelect(option.value)}
                  onKeyDown={(e) => handleKeyDown(e, option.value, isAvailable)}
                  className={`card-minimal rounded-xl p-5 transition-all duration-200 ${
                    !isAvailable
                      ? "opacity-50 cursor-not-allowed"
                      : isSelected
                        ? "cursor-pointer ring-2 ring-emerald-500 border-emerald-500/50 bg-emerald-500/10"
                        : "cursor-pointer hover:border-white/20 hover:bg-white/5"
                  }`}
                >
                  <div className="flex items-start gap-4">
                    <span className="text-3xl" role="img" aria-hidden="true">
                      {option.icon}
                    </span>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-white font-medium text-lg flex items-center gap-2">
                        {option.label}
                        {!isAvailable && (
                          <span className="text-[10px] uppercase tracking-wide font-semibold text-amber-300/80 bg-amber-500/10 border border-amber-500/20 rounded px-1.5 py-0.5">
                            Coming soon
                          </span>
                        )}
                      </h3>
                      <p className="text-white/60 text-sm mt-1">
                        {option.description}
                      </p>
                    </div>
                    {isSelected && isAvailable && (
                      <div className="flex-shrink-0 mt-1">
                        <svg
                          className="w-5 h-5 text-emerald-400"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                          aria-hidden="true"
                        >
                          <path
                            fillRule="evenodd"
                            d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </div>
                    )}
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

export default BusinessTypeSelection;
