"use client";

import React, { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import CustomRadio from "@/components/ui/CustomRadio";
import { LanguagePreference } from "@/types/global";
import MenuDetails from "./menu-details";
import { useRestaurantStorage } from "@/hooks/useRestaurantStorage";
import { MinimalHeader } from "@/components/ui/Header";
import BranchSetup, { BranchData } from "./BranchSetup";
import type { Vertical } from "@/lib/modules/types";

export interface BusinessSetupProps {
  onComplete: (restaurantId: string, country: "NG" | "US") => void;
  vertical?: Vertical;
}

export interface FormData {
  name: string;
  country: "NG" | "US";
  agentName: string;
  menuDetails: Array<{
    name: string;
    price: string;
    description?: string;
  }>;
  specialInstructions: string;
  languagePreference: LanguagePreference;
  branches: BranchData[];
}

export interface FormErrors {
  [key: string]: string | undefined;
}

/** Maps each vertical to its user-facing entity label. */
const VERTICAL_LABELS: Record<Vertical, string> = {
  restaurant: "Restaurant",
  logistics: "Business",
  healthcare: "Practice",
  legal: "Firm",
  hospitality: "Property",
  general_services: "Business",
};

const getSteps = (vertical?: Vertical) => {
  const entityLabel = VERTICAL_LABELS[vertical || "restaurant"];

  const steps = [
    {
      id: "restaurant-name",
      title: `${entityLabel} Information`,
      description: `Tell us about your ${entityLabel.toLowerCase()}`,
    },
    {
      id: "branches",
      title: "Branch Locations",
      description: `Add your ${entityLabel.toLowerCase()}'s office locations`,
    },
    {
      id: "agent-name",
      title: "AI Agent Setup",
      description: "Configure your AI agent",
    },
    ...(!vertical || vertical === "restaurant"
      ? [
          {
            id: "menu-details",
            title: "Menu Details",
            description: "Provide your menu information",
          },
        ]
      : []),
    {
      id: "special-instructions",
      title: "Special Instructions",
      description: "Add any special handling instructions",
    },
    {
      id: "language-preferences",
      title: "Language Preferences",
      description: "Choose your preferred language",
    },
  ];

  return steps;
};

const LANGUAGE_OPTIONS: {
  value: LanguagePreference;
  label: string;
  description?: string;
}[] = [
  {
    value: "english",
    label: "English",
    description: "Default language for customer interactions",
  },
  {
    value: "nigerian_english",
    label: "Nigerian English",
    description: "English with Nigerian accent patterns and local expressions",
  },
  {
    value: "pidgin",
    label: "Nigerian Pidgin",
    description: "Nigerian Pidgin English (Naija) for local customers",
  },
  {
    value: "spanish",
    label: "Spanish",
    description: "Español - Para clientes hispanohablantes",
  },
  {
    value: "french",
    label: "French",
    description: "Français - Pour les clients francophones",
  },
];

const SPECIAL_INSTRUCTION_EXAMPLES: Record<string, string> = {
  restaurant:
    '"Always ask for pickup time", "Mention daily specials", "Check for allergies"',
  logistics:
    '"Confirm delivery address", "Ask for package weight", "Mention tracking options"',
  healthcare:
    '"Ask about insurance provider", "Confirm appointment date", "Check for medication allergies"',
  legal:
    '"Ask about case type", "Confirm consultation availability", "Note urgency level"',
  hospitality:
    '"Ask about room preferences", "Mention current promotions", "Check for special occasions"',
  general_services:
    '"Ask about preferred time", "Mention available services", "Note special requirements"',
};

function getSpecialInstructionExamples(vertical?: Vertical): string {
  return SPECIAL_INSTRUCTION_EXAMPLES[vertical || "restaurant"] || SPECIAL_INSTRUCTION_EXAMPLES.general_services;
}

/**
 * Multi-step business setup component that guides users through
 * configuring their business information and AI agent settings
 * 
 * Requirements: 3.2 - Allows adding multiple branches during initial setup
 */
const BusinessSetup: React.FC<BusinessSetupProps> = ({ onComplete, vertical }) => {
  const { saveRestaurantData } = useRestaurantStorage();
  const entityLabel = VERTICAL_LABELS[vertical || "restaurant"];
  const STEPS = getSteps(vertical);

  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState<FormData>({
    name: "",
    country: "NG",
    agentName: "",
    menuDetails: [],
    specialInstructions: "",
    languagePreference: "english",
    branches: [],
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  
  // Branch management state
  const [isAddingBranch, setIsAddingBranch] = useState(false);
  const [editingBranchIndex, setEditingBranchIndex] = useState<number | null>(null);

  useEffect(() => {
    setPageLoading(false);
  }, []);

  const validateCurrentStep = useCallback((): boolean => {
    const newErrors: FormErrors = {};
    const currentStepId = STEPS[currentStep].id;

    switch (currentStepId) {
      case "restaurant-name":
        if (!formData.name.trim()) {
          newErrors.name = `${entityLabel} name is required`;
        } else if (formData.name.trim().length < 2) {
          newErrors.name = `${entityLabel} name must be at least 2 characters`;
        }
        break;

      case "branches":
        // At least one branch is required
        if (formData.branches.length === 0) {
          newErrors.branches = "Please add at least one branch location";
        }
        break;

      case "agent-name":
        if (!formData.agentName.trim()) {
          newErrors.agentName = "Agent name is required";
        } else if (formData.agentName.trim().length < 2) {
          newErrors.agentName = "Agent name must be at least 2 characters";
        }
        break;

      case "menu-details":
        if (!formData.menuDetails.length) {
          newErrors.menuDetails = "Menu details are required";
        }
        break;

      case "special-instructions":
        if (
          formData.specialInstructions.trim() &&
          formData.specialInstructions.trim().length < 5
        ) {
          newErrors.specialInstructions =
            "Special instructions should be at least 5 characters if provided";
        }
        break;

      case "language-preferences":
        if (!formData.languagePreference) {
          newErrors.languagePreference = "Please select a language preference";
        }
        break;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [currentStep, formData]);

  const handleInputChange = (
    field: keyof FormData,
    value: string | FormData["menuDetails"]
  ) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  const handleNext = useCallback(() => {
    if (validateCurrentStep()) {
      if (currentStep < STEPS.length - 1) {
        setCurrentStep((prev) => prev + 1);
      }
    }
  }, [currentStep, validateCurrentStep]);

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  /**
   * Add a new branch to the list
   */
  const handleAddBranch = (branchData: BranchData) => {
    setFormData((prev) => ({
      ...prev,
      branches: [...prev.branches, branchData],
    }));
    setIsAddingBranch(false);
    // Clear branch error when a branch is added
    if (errors.branches) {
      setErrors((prev) => ({ ...prev, branches: undefined }));
    }
  };

  /**
   * Update an existing branch
   */
  const handleUpdateBranch = (branchData: BranchData) => {
    if (editingBranchIndex !== null) {
      setFormData((prev) => ({
        ...prev,
        branches: prev.branches.map((branch, index) =>
          index === editingBranchIndex ? branchData : branch
        ),
      }));
      setEditingBranchIndex(null);
    }
  };

  /**
   * Remove a branch from the list
   */
  const handleRemoveBranch = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      branches: prev.branches.filter((_, i) => i !== index),
    }));
  };

  /**
   * Start editing a branch
   */
  const handleEditBranch = (index: number) => {
    setEditingBranchIndex(index);
  };

  /**
   * Cancel branch add/edit mode
   */
  const handleCancelBranchEdit = () => {
    setIsAddingBranch(false);
    setEditingBranchIndex(null);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter" && !isSubmitting) {
        event.preventDefault();
        handleNext();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [currentStep, isSubmitting, handleNext]);

  const handleSubmit = async () => {
    if (!validateCurrentStep()) {
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await saveRestaurantData({
        name: formData.name,
        country: formData.country,
        agentName: formData.agentName,
        menuDetails: formData.menuDetails,
        specialInstructions: formData.specialInstructions,
        languagePreference: formData.languagePreference,
        branches: formData.branches,
      });

      onComplete(result?.restaurantId || "", formData.country);
    } catch (error) {
      setErrors({
        general:
          error instanceof Error
            ? error.message
            : "Setup failed. Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderStepContent = () => {
    const currentStepId = STEPS[currentStep].id;

    switch (currentStepId) {
      case "restaurant-name":
        return (
          <div className="space-y-6">
            <div>
              <label
                htmlFor="business-country"
                className="block text-sm font-medium text-white/70 mb-3"
              >
                Country
                <span className="text-red-400 ml-1" aria-label="required">
                  *
                </span>
              </label>
              <select
                id="business-country"
                value={formData.country}
                onChange={(e) => {
                  const country = e.target.value as "NG" | "US";
                  setFormData((prev) => ({
                    ...prev,
                    country,
                    // Reset Nigeria-only languages when switching to the US.
                    languagePreference:
                      country === "US" &&
                      (prev.languagePreference === "nigerian_english" ||
                        prev.languagePreference === "pidgin")
                        ? "english"
                        : prev.languagePreference,
                  }));
                }}
                className="input-dark w-full px-4 py-3 rounded-lg"
                disabled={isSubmitting}
              >
                <option value="NG">Nigeria (₦ NGN)</option>
                <option value="US">United States ($ USD)</option>
              </select>
              <p className="mt-2 text-sm text-white/60">
                Determines your currency, payment methods, and phone number
                format.
              </p>
            </div>
            <div>
            <label className="block text-sm font-medium text-white/70 mb-3">
              {entityLabel} Name
              <span className="text-red-400 ml-1" aria-label="required">
                *
              </span>
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                handleInputChange("name", e.target.value)
              }
              placeholder={`Enter your ${entityLabel.toLowerCase()} name`}
              className={`input-dark w-full px-4 py-3 rounded-lg ${
                errors.name
                  ? "border-red-500/50 focus:ring-red-500/50 focus:border-red-500/50"
                  : ""
              }`}
              required
              autoFocus
              disabled={isSubmitting}
            />
            {errors.name && (
              <p className="mt-2 text-sm text-red-400" role="alert">
                {errors.name}
              </p>
            )}
            </div>
          </div>
        );

      case "branches":
        // Show BranchSetup form when adding or editing
        if (isAddingBranch) {
          return (
            <BranchSetup
              onComplete={handleAddBranch}
              onBack={handleCancelBranchEdit}
              isSubmitting={isSubmitting}
              title="Add New Branch"
              description="Enter the details for this branch location"
              submitButtonText="Add Branch"
            />
          );
        }

        if (editingBranchIndex !== null) {
          return (
            <BranchSetup
              initialData={formData.branches[editingBranchIndex]}
              onComplete={handleUpdateBranch}
              onBack={handleCancelBranchEdit}
              isSubmitting={isSubmitting}
              title="Edit Branch"
              description="Update the details for this branch location"
              submitButtonText="Save Changes"
            />
          );
        }

        // Show branch list and add button
        return (
          <div className="space-y-6">
            {/* Branch List */}
            {formData.branches.length > 0 && (
              <div className="space-y-3">
                <label className="block text-sm font-medium text-white/70">
                  Added Branches ({formData.branches.length})
                </label>
                <AnimatePresence mode="popLayout">
                  {formData.branches.map((branch, index) => (
                    <motion.div
                      key={`branch-${index}-${branch.name}`}
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      transition={{ duration: 0.2 }}
                      className="bg-white/5 border border-white/10 rounded-lg p-4 hover:border-emerald-500/30 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <h4 className="text-white font-medium truncate">
                            {branch.name}
                          </h4>
                          <p className="text-white/60 text-sm mt-1 truncate">
                            {branch.address}
                          </p>
                          <p className="text-white/50 text-sm mt-1">
                            {branch.phoneNumber}
                          </p>
                          {/* Operating hours summary */}
                          <div className="mt-2 flex flex-wrap gap-1">
                            {Object.entries(branch.operatingHours).map(([day, hours]) => (
                              hours && (
                                <span
                                  key={day}
                                  className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                >
                                  {day.slice(0, 3).toUpperCase()}
                                </span>
                              )
                            ))}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button
                            type="button"
                            onClick={() => handleEditBranch(index)}
                            disabled={isSubmitting}
                            className="p-2 text-white/60 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                            aria-label={`Edit ${branch.name}`}
                          >
                            <svg
                              className="w-4 h-4"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                              />
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveBranch(index)}
                            disabled={isSubmitting}
                            className="p-2 text-red-400/60 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                            aria-label={`Remove ${branch.name}`}
                          >
                            <svg
                              className="w-4 h-4"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                              />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}

            {/* Add Branch Button */}
            <div>
              <button
                type="button"
                onClick={() => setIsAddingBranch(true)}
                disabled={isSubmitting}
                className="w-full flex items-center justify-center gap-2 px-4 py-4 border-2 border-dashed border-white/20 rounded-lg text-white/70 hover:text-white hover:border-emerald-500/50 hover:bg-emerald-500/5 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                  />
                </svg>
                <span>Add {formData.branches.length > 0 ? "Another" : "a"} Branch</span>
              </button>
            </div>

            {/* Error message */}
            {errors.branches && (
              <p className="text-sm text-red-400" role="alert">
                {errors.branches}
              </p>
            )}

            {/* Helper text */}
            {!errors.branches && (
              <p className="text-sm text-white/60">
                Add at least one branch location. You can add more branches later from your dashboard.
              </p>
            )}
          </div>
        );

      case "agent-name":
        return (
          <div>
            <label className="block text-sm font-medium text-white/70 mb-3">
              AI Agent Name
              <span className="text-red-400 ml-1" aria-label="required">
                *
              </span>
            </label>
            <input
              type="text"
              value={formData.agentName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                handleInputChange("agentName", e.target.value)
              }
              placeholder="Enter a name for your AI agent"
              className={`input-dark w-full px-4 py-3 rounded-lg ${
                errors.agentName
                  ? "border-red-500/50 focus:ring-red-500/50 focus:border-red-500/50"
                  : ""
              }`}
              required
              autoFocus
              disabled={isSubmitting}
            />
            {errors.agentName && (
              <p className="mt-2 text-sm text-red-400" role="alert">
                {errors.agentName}
              </p>
            )}
            <p className="mt-2 text-sm text-white/60">
              This is how your AI agent will introduce itself to customers
            </p>
          </div>
        );

      case "menu-details":
        return (
          <div>
            <label
              htmlFor="menu-details"
              className="block text-sm font-medium text-white/70 mb-3"
            >
              Menu Details
              <span className="text-red-400 ml-1" aria-label="required">
                *
              </span>
            </label>
            <MenuDetails
              menuDetails={formData.menuDetails}
              handleInputChange={handleInputChange}
            />
            {errors.menuDetails && (
              <p
                id="menu-details-error"
                className="mt-2 text-sm text-red-400"
                role="alert"
              >
                {errors.menuDetails}
              </p>
            )}
            {!errors.menuDetails && (
              <p
                id="menu-details-helper"
                className="mt-2 text-sm text-white/60"
              >
                Include popular items, prices, and any special categories or
                dietary options
              </p>
            )}
          </div>
        );

      case "special-instructions":
        return (
          <div>
            <label
              htmlFor="special-instructions"
              className="block text-sm font-medium text-white/70 mb-3"
            >
              Special Instructions
              <span className="text-white/60 ml-1">(Optional)</span>
            </label>
            <textarea
              id="special-instructions"
              value={formData.specialInstructions}
              onChange={(e) =>
                handleInputChange("specialInstructions", e.target.value)
              }
              placeholder="Any special handling instructions for your AI agent..."
              className={`input-dark w-full h-32 px-4 py-3 rounded-lg resize-none ${
                errors.specialInstructions
                  ? "border-red-500/50 focus:ring-red-500/50 focus:border-red-500/50"
                  : ""
              }`}
              autoFocus
              disabled={isSubmitting}
              aria-invalid={Boolean(errors.specialInstructions)}
              aria-describedby={
                errors.specialInstructions
                  ? "special-instructions-error"
                  : "special-instructions-helper"
              }
            />
            {errors.specialInstructions && (
              <p
                id="special-instructions-error"
                className="mt-2 text-sm text-red-400"
                role="alert"
              >
                {errors.specialInstructions}
              </p>
            )}
            {!errors.specialInstructions && (
              <p
                id="special-instructions-helper"
                className="mt-2 text-sm text-white/60"
              >
                Examples: {getSpecialInstructionExamples(vertical)}
              </p>
            )}
          </div>
        );

      case "language-preferences":
        return (
          <div>
            <fieldset>
              <legend className="block text-sm font-medium text-white/70 mb-4">
                Language Preference
                <span className="text-red-400 ml-1" aria-label="required">
                  *
                </span>
              </legend>
              <div className="space-y-3">
                {LANGUAGE_OPTIONS.filter(
                  (option) =>
                    formData.country !== "US" ||
                    (option.value !== "nigerian_english" &&
                      option.value !== "pidgin")
                ).map((option) => (
                  <CustomRadio
                    key={option.value}
                    id={`language-${option.value}`}
                    name="languagePreference"
                    value={option.value}
                    checked={formData.languagePreference === option.value}
                    onChange={(value) =>
                      handleInputChange(
                        "languagePreference",
                        value as LanguagePreference
                      )
                    }
                    label={option.label}
                    description={option.description}
                    disabled={isSubmitting}
                    variant="detailed"
                  />
                ))}
              </div>
            </fieldset>
            {errors.languagePreference && (
              <p className="mt-2 text-sm text-red-400" role="alert">
                {errors.languagePreference}
              </p>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  const isLastStep = currentStep === STEPS.length - 1;

  if (pageLoading) {
    return (
      <div className="min-h-screen bg-black">
        <MinimalHeader />
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-emerald-500/30 border-t-emerald-500"></div>
        </div>
      </div>
    );
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
            {entityLabel} Setup
          </h1>
          <p className="text-white/70 text-minimal">
            Let&apos;s configure your AI agent for your {entityLabel.toLowerCase()}
          </p>
        </motion.div>

        {/* Progress Indicator */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="card-minimal rounded-xl p-6"
        >
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-medium text-white/70">
              Step {currentStep + 1} of {STEPS.length}
            </span>
            <span className="text-sm text-white/60">
              {Math.round(((currentStep + 1) / STEPS.length) * 100)}% Complete
            </span>
          </div>
          <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden">
            <div
              className="bg-emerald-500 h-2 rounded-full transition-all duration-500 ease-out"
              style={{
                width: `${((currentStep + 1) / STEPS.length) * 100}%`,
              }}
            />
          </div>
        </motion.div>

        {/* Main Form */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="card-minimal rounded-xl overflow-hidden"
        >
          {/* Header */}
          <div className="px-6 py-6 border-b border-white/10">
            <h2 className="text-xl text-white text-minimal">
              {STEPS[currentStep].title}
            </h2>
            <p className="text-white/70 mt-1 text-minimal">
              {STEPS[currentStep].description}
            </p>
          </div>

          {/* Content */}
          <div className="p-6">
            {errors.general && (
              <div
                className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg mb-6"
                role="alert"
                aria-live="polite"
              >
                {errors.general}
              </div>
            )}

            <div className="space-y-6">{renderStepContent()}</div>

            {/* Navigation - Hide when adding/editing branches */}
            {!(STEPS[currentStep].id === "branches" && (isAddingBranch || editingBranchIndex !== null)) && (
              <div className="flex justify-between pt-8 mt-8 border-t border-white/10">
                <button
                  className="btn-minimal btn-secondary-minimal px-6 py-3 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={handlePrevious}
                  disabled={currentStep === 0 || isSubmitting}
                >
                  Previous
                </button>

                {isLastStep ? (
                  <button
                    className="btn-minimal btn-primary-minimal px-8 py-3 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={handleSubmit}
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? (
                      <span className="flex items-center gap-2">
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-emerald-500/30 border-t-emerald-500"></div>
                        Setting up...
                      </span>
                    ) : (
                      "Complete Setup"
                    )}
                  </button>
                ) : (
                  <button
                    className="btn-minimal btn-primary-minimal px-8 py-3 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={handleNext}
                    disabled={isSubmitting}
                  >
                    Next
                  </button>
                )}
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
};

export default BusinessSetup;
