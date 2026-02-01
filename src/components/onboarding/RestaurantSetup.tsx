"use client";

import React, { useEffect, useState, useCallback } from "react";
import { motion } from "motion/react";
import CustomRadio from "@/components/ui/CustomRadio";
import { LanguagePreference } from "@/types/global";
import MenuDetails from "./menu-details";
import { useRestaurantStorage } from "@/hooks/useRestaurantStorage";
import { MinimalHeader } from "@/components/ui/Header";

export interface RestaurantSetupProps {
  onComplete: (restaurantId: string) => void;
}

export interface FormData {
  name: string;
  agentName: string;
  menuDetails: Array<{
    name: string;
    price: string;
    description?: string;
  }>;
  specialInstructions: string;
  languagePreference: LanguagePreference;
}

export interface FormErrors {
  [key: string]: string | undefined;
}
const STEPS = [
  {
    id: "restaurant-name",
    title: "Restaurant Information",
    description: "Tell us about your restaurant",
  },
  {
    id: "agent-name",
    title: "AI Agent Setup",
    description: "Configure your AI agent",
  },
  {
    id: "menu-details",
    title: "Menu Details",
    description: "Provide your menu information",
  },
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

/**
 * Multi-step restaurant setup component that guides users through
 * configuring their restaurant information and AI agent settings
 */
const RestaurantSetup: React.FC<RestaurantSetupProps> = ({ onComplete }) => {
  const { saveRestaurantData } = useRestaurantStorage();

  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState<FormData>({
    name: "",
    agentName: "",
    menuDetails: [],
    specialInstructions: "",
    languagePreference: "english",
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);

  useEffect(() => {
    setPageLoading(false);
  }, []);

  const validateCurrentStep = useCallback((): boolean => {
    const newErrors: FormErrors = {};
    const currentStepId = STEPS[currentStep].id;

    switch (currentStepId) {
      case "restaurant-name":
        if (!formData.name.trim()) {
          newErrors.name = "Restaurant name is required";
        } else if (formData.name.trim().length < 2) {
          newErrors.name = "Restaurant name must be at least 2 characters";
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
        agentName: formData.agentName,
        menuDetails: formData.menuDetails,
        specialInstructions: formData.specialInstructions,
        languagePreference: formData.languagePreference,
      });

      onComplete(result?.restaurantId || "");
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
          <div>
            <label className="block text-sm font-medium text-white/70 mb-3">
              Restaurant Name
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
              placeholder="Enter your restaurant name"
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
                Examples: &quot;Always ask for pickup time&quot;, &quot;Mention
                daily specials&quot;, &quot;Check for allergies&quot;
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
                {LANGUAGE_OPTIONS.map((option) => (
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
            Restaurant Setup
          </h1>
          <p className="text-white/70 text-minimal">
            Let&apos;s configure your AI agent for your restaurant
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

            {/* Navigation */}
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
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
};

export default RestaurantSetup;
