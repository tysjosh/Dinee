"use client";

import React, { useState, useCallback } from "react";
import { motion } from "motion/react";
import { getCountryConfig } from "@/lib/region";

/**
 * Operating hours for a single day
 */
export interface DayHours {
  open: string;
  close: string;
}

/**
 * Operating hours for all days of the week
 */
export interface OperatingHours {
  monday?: DayHours;
  tuesday?: DayHours;
  wednesday?: DayHours;
  thursday?: DayHours;
  friday?: DayHours;
  saturday?: DayHours;
  sunday?: DayHours;
}

/**
 * Branch data structure
 */
export interface BranchData {
  name: string;
  address: string;
  phoneNumber: string;
  operatingHours: OperatingHours;
}

/**
 * Props for the BranchSetup component
 */
export interface BranchSetupProps {
  /** Initial branch data for editing */
  initialData?: Partial<BranchData>;
  /** Callback when branch setup is complete */
  onComplete: (data: BranchData) => void;
  /** Callback when user wants to go back */
  onBack?: () => void;
  /** Whether the form is in a submitting state */
  isSubmitting?: boolean;
  /** Title to display (defaults to "Branch Setup") */
  title?: string;
  /** Description to display */
  description?: string;
  /** Submit button text (defaults to "Save Branch") */
  submitButtonText?: string;
  /** Tenant country (NG | US) driving phone/address placeholders. Defaults NG. */
  country?: "NG" | "US";
}

/**
 * Form validation errors
 */
interface FormErrors {
  name?: string;
  address?: string;
  phoneNumber?: string;
  operatingHours?: string;
}

/**
 * Days of the week for operating hours
 */
const DAYS_OF_WEEK = [
  { key: "monday", label: "Monday" },
  { key: "tuesday", label: "Tuesday" },
  { key: "wednesday", label: "Wednesday" },
  { key: "thursday", label: "Thursday" },
  { key: "friday", label: "Friday" },
  { key: "saturday", label: "Saturday" },
  { key: "sunday", label: "Sunday" },
] as const;

type DayKey = (typeof DAYS_OF_WEEK)[number]["key"];

/**
 * Default operating hours (9 AM - 9 PM, Monday-Saturday)
 */
const getDefaultOperatingHours = (): OperatingHours => {
  const defaultHours = { open: "09:00", close: "21:00" };
  return {
    monday: defaultHours,
    tuesday: defaultHours,
    wednesday: defaultHours,
    thursday: defaultHours,
    friday: defaultHours,
    saturday: defaultHours,
    sunday: undefined, // Closed on Sunday by default
  };
};

/**
 * BranchSetup component for collecting branch information during onboarding
 * 
 * Requirements: 3.1, 3.3
 * - Collects branch name, address, phone number, and operating hours
 * - Validates required fields before submission
 */
const BranchSetup: React.FC<BranchSetupProps> = ({
  initialData,
  onComplete,
  onBack,
  isSubmitting = false,
  title = "Branch Setup",
  description = "Enter the details for this branch location",
  submitButtonText = "Save Branch",
  country,
}) => {
  const countryCfg = getCountryConfig(country);
  const phonePlaceholder =
    countryCfg.code === "US"
      ? "e.g., +1 (415) 555 0123"
      : "e.g., +234 801 234 5678";
  const namePlaceholder =
    countryCfg.code === "US"
      ? "e.g., Main Branch, Downtown"
      : "e.g., Main Branch, Victoria Island";
  const addressPlaceholder =
    countryCfg.code === "US"
      ? "Enter the full address (street, city, state, ZIP)"
      : "Enter the full address of this branch";
  const [formData, setFormData] = useState<BranchData>({
    name: initialData?.name || "",
    address: initialData?.address || "",
    phoneNumber: initialData?.phoneNumber || "",
    operatingHours: initialData?.operatingHours || getDefaultOperatingHours(),
  });

  const [errors, setErrors] = useState<FormErrors>({});
  const [dayEnabled, setDayEnabled] = useState<Record<DayKey, boolean>>(() => {
    const initial: Record<DayKey, boolean> = {} as Record<DayKey, boolean>;
    DAYS_OF_WEEK.forEach(({ key }) => {
      initial[key] = formData.operatingHours[key] !== undefined;
    });
    return initial;
  });

  /**
   * Validate the form data
   */
  const validateForm = useCallback((): boolean => {
    const newErrors: FormErrors = {};

    // Validate branch name (required, min 2 characters)
    if (!formData.name.trim()) {
      newErrors.name = "Branch name is required";
    } else if (formData.name.trim().length < 2) {
      newErrors.name = "Branch name must be at least 2 characters";
    }

    // Validate address (required, min 5 characters)
    if (!formData.address.trim()) {
      newErrors.address = "Address is required";
    } else if (formData.address.trim().length < 5) {
      newErrors.address = "Address must be at least 5 characters";
    }

    // Validate phone number (required, basic format check)
    if (!formData.phoneNumber.trim()) {
      newErrors.phoneNumber = "Phone number is required";
    } else if (!/^[\d\s+()-]{7,20}$/.test(formData.phoneNumber.trim())) {
      newErrors.phoneNumber = "Please enter a valid phone number";
    }

    // Validate operating hours (at least one day should be enabled)
    const hasOperatingHours = Object.values(dayEnabled).some((enabled) => enabled);
    if (!hasOperatingHours) {
      newErrors.operatingHours = "Please set operating hours for at least one day";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formData, dayEnabled]);

  /**
   * Handle input field changes
   */
  const handleInputChange = (field: keyof BranchData, value: string) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
    // Clear error when user starts typing
    if (errors[field as keyof FormErrors]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  /**
   * Toggle a day's operating hours on/off
   */
  const handleDayToggle = (day: DayKey) => {
    setDayEnabled((prev) => {
      const newEnabled = { ...prev, [day]: !prev[day] };
      
      // Update operating hours based on toggle
      setFormData((prevData) => ({
        ...prevData,
        operatingHours: {
          ...prevData.operatingHours,
          [day]: newEnabled[day] ? { open: "09:00", close: "21:00" } : undefined,
        },
      }));
      
      return newEnabled;
    });
    
    // Clear operating hours error when user makes changes
    if (errors.operatingHours) {
      setErrors((prev) => ({ ...prev, operatingHours: undefined }));
    }
  };

  /**
   * Update operating hours for a specific day
   */
  const handleHoursChange = (day: DayKey, field: "open" | "close", value: string) => {
    setFormData((prev) => ({
      ...prev,
      operatingHours: {
        ...prev.operatingHours,
        [day]: {
          ...prev.operatingHours[day],
          [field]: value,
        },
      },
    }));
  };

  /**
   * Handle form submission
   */
  const handleSubmit = () => {
    if (validateForm()) {
      // Build final operating hours (only include enabled days)
      const finalOperatingHours: OperatingHours = {};
      DAYS_OF_WEEK.forEach(({ key }) => {
        if (dayEnabled[key] && formData.operatingHours[key]) {
          finalOperatingHours[key] = formData.operatingHours[key];
        }
      });

      onComplete({
        ...formData,
        name: formData.name.trim(),
        address: formData.address.trim(),
        phoneNumber: formData.phoneNumber.trim(),
        operatingHours: finalOperatingHours,
      });
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="w-full max-w-2xl mx-auto"
    >
      {/* Header */}
      <div className="text-center mb-8">
        <h2 className="text-2xl text-white mb-2 text-minimal">{title}</h2>
        <p className="text-white/70 text-minimal">{description}</p>
      </div>

      {/* Form Card */}
      <div className="card-minimal rounded-xl overflow-hidden">
        <div className="p-6 space-y-6">
          {/* Branch Name */}
          <div>
            <label
              htmlFor="branch-name"
              className="block text-sm font-medium text-white/70 mb-2"
            >
              Branch Name
              <span className="text-red-400 ml-1" aria-label="required">
                *
              </span>
            </label>
            <input
              id="branch-name"
              type="text"
              value={formData.name}
              onChange={(e) => handleInputChange("name", e.target.value)}
              placeholder={namePlaceholder}
              className={`input-dark w-full px-4 py-3 rounded-lg ${
                errors.name
                  ? "border-red-500/50 focus:ring-red-500/50 focus:border-red-500/50"
                  : ""
              }`}
              disabled={isSubmitting}
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? "branch-name-error" : undefined}
            />
            {errors.name && (
              <p id="branch-name-error" className="mt-2 text-sm text-red-400" role="alert">
                {errors.name}
              </p>
            )}
          </div>

          {/* Address */}
          <div>
            <label
              htmlFor="branch-address"
              className="block text-sm font-medium text-white/70 mb-2"
            >
              Address
              <span className="text-red-400 ml-1" aria-label="required">
                *
              </span>
            </label>
            <textarea
              id="branch-address"
              value={formData.address}
              onChange={(e) => handleInputChange("address", e.target.value)}
              placeholder={addressPlaceholder}
              className={`input-dark w-full px-4 py-3 rounded-lg resize-none h-24 ${
                errors.address
                  ? "border-red-500/50 focus:ring-red-500/50 focus:border-red-500/50"
                  : ""
              }`}
              disabled={isSubmitting}
              aria-invalid={Boolean(errors.address)}
              aria-describedby={errors.address ? "branch-address-error" : undefined}
            />
            {errors.address && (
              <p id="branch-address-error" className="mt-2 text-sm text-red-400" role="alert">
                {errors.address}
              </p>
            )}
          </div>

          {/* Phone Number */}
          <div>
            <label
              htmlFor="branch-phone"
              className="block text-sm font-medium text-white/70 mb-2"
            >
              Phone Number
              <span className="text-red-400 ml-1" aria-label="required">
                *
              </span>
            </label>
            <input
              id="branch-phone"
              type="tel"
              value={formData.phoneNumber}
              onChange={(e) => handleInputChange("phoneNumber", e.target.value)}
              placeholder={phonePlaceholder}
              className={`input-dark w-full px-4 py-3 rounded-lg ${
                errors.phoneNumber
                  ? "border-red-500/50 focus:ring-red-500/50 focus:border-red-500/50"
                  : ""
              }`}
              disabled={isSubmitting}
              aria-invalid={Boolean(errors.phoneNumber)}
              aria-describedby={errors.phoneNumber ? "branch-phone-error" : undefined}
            />
            {errors.phoneNumber && (
              <p id="branch-phone-error" className="mt-2 text-sm text-red-400" role="alert">
                {errors.phoneNumber}
              </p>
            )}
            <p className="mt-1 text-xs text-white/50">
              This number will be used for customer inquiries
            </p>
          </div>

          {/* Operating Hours */}
          <div>
            <fieldset>
              <legend className="block text-sm font-medium text-white/70 mb-3">
                Operating Hours
                <span className="text-white/50 ml-1">(Optional)</span>
              </legend>
              
              <div className="space-y-3">
                {DAYS_OF_WEEK.map(({ key, label }) => (
                  <div
                    key={key}
                    className={`flex items-center gap-4 p-3 rounded-lg transition-colors ${
                      dayEnabled[key]
                        ? "bg-emerald-500/10 border border-emerald-500/20"
                        : "bg-white/5 border border-white/10"
                    }`}
                  >
                    {/* Day Toggle */}
                    <label className="flex items-center gap-3 cursor-pointer min-w-[140px]">
                      <input
                        type="checkbox"
                        checked={dayEnabled[key]}
                        onChange={() => handleDayToggle(key)}
                        disabled={isSubmitting}
                        className="w-4 h-4 rounded border-white/30 bg-white/10 text-emerald-500 focus:ring-emerald-500/50 focus:ring-offset-0"
                      />
                      <span
                        className={`text-sm ${
                          dayEnabled[key] ? "text-white" : "text-white/50"
                        }`}
                      >
                        {label}
                      </span>
                    </label>

                    {/* Time Inputs */}
                    {dayEnabled[key] && (
                      <div className="flex items-center gap-2 flex-1">
                        <input
                          type="time"
                          value={formData.operatingHours[key]?.open || "09:00"}
                          onChange={(e) => handleHoursChange(key, "open", e.target.value)}
                          disabled={isSubmitting}
                          className="input-dark px-3 py-1.5 rounded text-sm w-28"
                          aria-label={`${label} opening time`}
                        />
                        <span className="text-white/50 text-sm">to</span>
                        <input
                          type="time"
                          value={formData.operatingHours[key]?.close || "21:00"}
                          onChange={(e) => handleHoursChange(key, "close", e.target.value)}
                          disabled={isSubmitting}
                          className="input-dark px-3 py-1.5 rounded text-sm w-28"
                          aria-label={`${label} closing time`}
                        />
                      </div>
                    )}

                    {/* Closed indicator */}
                    {!dayEnabled[key] && (
                      <span className="text-white/40 text-sm italic">Closed</span>
                    )}
                  </div>
                ))}
              </div>

              {errors.operatingHours && (
                <p className="mt-3 text-sm text-red-400" role="alert">
                  {errors.operatingHours}
                </p>
              )}
            </fieldset>
          </div>
        </div>

        {/* Footer with Actions */}
        <div className="px-6 py-4 border-t border-white/10 flex justify-between">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              disabled={isSubmitting}
              className="btn-minimal btn-secondary-minimal px-6 py-3 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Back
            </button>
          ) : (
            <div /> // Spacer
          )}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="btn-minimal btn-primary-minimal px-8 py-3 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <span className="flex items-center gap-2">
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-emerald-500/30 border-t-emerald-500" />
                Saving...
              </span>
            ) : (
              submitButtonText
            )}
          </button>
        </div>
      </div>
    </motion.div>
  );
};

export default BranchSetup;
