"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import BusinessTypeSelection from "@/components/onboarding/BusinessTypeSelection";
import ModuleActivation from "@/components/onboarding/ModuleActivation";
import IntegrationSetup, {
  type RunsheetConfig,
} from "@/components/onboarding/IntegrationSetup";
import RestaurantSetup from "@/components/onboarding/RestaurantSetup";
import RestaurantIdDisplay from "@/components/onboarding/VirtualNumberGenerator";
import { useRestaurantStorage } from "@/hooks/useRestaurantStorage";
import { MinimalHeader } from "@/components/ui/Header";
import type { Vertical } from "@/lib/modules/types";

type OnboardingStep =
  | "business-type"
  | "business-setup"
  | "module-activation"
  | "integration-setup"
  | "restaurant-id"
  | "complete";

/**
 * Onboarding page — guides users through multi-vertical business setup.
 *
 * Flow:
 * 1. Business Type Selection (vertical picker)
 * 2. Business Setup (name, agent, language — reuses RestaurantSetup)
 * 3. Module Activation (enable packs for selected vertical)
 * 4. Integration Setup (conditional — Runsheet Connect for logistics)
 * 5. Virtual Number / Business ID display
 * 6. Complete → redirect to dashboard
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7
 */
export default function OnboardingPage() {
  const router = useRouter();
  const { restaurantId } = useRestaurantStorage();
  const [currentStep, setCurrentStep] = useState<OnboardingStep>("business-type");
  const [generatedBusinessId, setGeneratedBusinessId] = useState("");
  const [selectedVertical, setSelectedVertical] = useState<Vertical | undefined>();
  const [enabledModules, setEnabledModules] = useState<string[]>(["core_platform"]);
  const [runsheetConfig, setRunsheetConfig] = useState<RunsheetConfig | undefined>();

  useEffect(() => {
    if (restaurantId) {
      router.push("/client/dashboard");
    }
    window.scrollTo(0, 0);
  }, [restaurantId, router]);

  const handleVerticalSelect = (vertical: Vertical) => {
    setSelectedVertical(vertical);
    // Auto-add the vertical's pack to enabledModules
    const packMap: Record<Vertical, string> = {
      restaurant: "restaurant_pack",
      logistics: "logistics_pack",
      healthcare: "healthcare_pack",
      legal: "legal_pack",
      hospitality: "hospitality_pack",
      general_services: "general_services_pack",
    };
    setEnabledModules(["core_platform", packMap[vertical]]);
    setCurrentStep("business-setup");
  };

  const handleBusinessSetup = (businessId: string) => {
    setGeneratedBusinessId(businessId);
    setCurrentStep("module-activation");
  };

  const handleModulesConfirmed = () => {
    // Show integration setup for logistics with runsheet_connect enabled
    if (
      selectedVertical === "logistics" &&
      enabledModules.includes("runsheet_connect")
    ) {
      setCurrentStep("integration-setup");
    } else {
      setCurrentStep("restaurant-id");
    }
  };

  const handleIntegrationDone = () => {
    setCurrentStep("restaurant-id");
  };

  const handleComplete = async () => {
    setCurrentStep("complete");
    sessionStorage.setItem("fromOnboarding", "true");
    setTimeout(() => {
      router.push("/client/dashboard");
    }, 2000);
  };

  const renderCurrentStep = () => {
    switch (currentStep) {
      case "business-type":
        return (
          <div className="flex items-center justify-center min-h-screen px-6 py-20">
            <div className="max-w-2xl w-full">
              <BusinessTypeSelection
                onSelect={handleVerticalSelect}
                selectedVertical={selectedVertical}
              />
              <p className="text-center text-sm text-white/50 mt-6">
                Choose the type of business you&apos;re setting up
              </p>
            </div>
          </div>
        );

      case "business-setup":
        return <RestaurantSetup onComplete={handleBusinessSetup} vertical={selectedVertical} />;

      case "module-activation":
        return (
          <div className="flex items-center justify-center min-h-screen px-6 py-20">
            <div className="max-w-2xl w-full space-y-6">
              <ModuleActivation
                vertical={selectedVertical!}
                enabledModules={enabledModules}
                onModulesChange={setEnabledModules}
              />
              <div className="flex justify-end">
                <button
                  onClick={handleModulesConfirmed}
                  className="px-6 py-3 bg-emerald-500 hover:bg-emerald-600 text-white font-medium rounded-lg transition-colors min-h-[44px]"
                >
                  Continue
                </button>
              </div>
            </div>
          </div>
        );

      case "integration-setup":
        return (
          <div className="flex items-center justify-center min-h-screen px-6 py-20">
            <div className="max-w-2xl w-full space-y-6">
              <IntegrationSetup
                vertical={selectedVertical!}
                enabledModules={enabledModules}
                onConfigChange={setRunsheetConfig}
                config={runsheetConfig}
              />
              <div className="flex justify-between">
                <button
                  onClick={handleIntegrationDone}
                  className="px-6 py-3 text-white/60 hover:text-white font-medium rounded-lg transition-colors min-h-[44px]"
                >
                  Skip for now
                </button>
                <button
                  onClick={handleIntegrationDone}
                  className="px-6 py-3 bg-emerald-500 hover:bg-emerald-600 text-white font-medium rounded-lg transition-colors min-h-[44px]"
                >
                  Continue
                </button>
              </div>
            </div>
          </div>
        );

      case "restaurant-id":
        return (
          <RestaurantIdDisplay
            restaurantId={generatedBusinessId}
            onComplete={handleComplete}
          />
        );

      case "complete":
        return (
          <div className="flex items-center justify-center min-h-screen px-6 py-20">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              className="max-w-md w-full text-center space-y-8 relative z-10"
            >
              <div className="glass-card rounded-2xl p-8">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.8, delay: 0.2 }}
                  className="space-y-6"
                >
                  <div className="w-16 h-16 mx-auto bg-emerald-500/20 rounded-full flex items-center justify-center">
                    <svg className="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h1 className="text-3xl font-bold text-white">Setup Complete!</h1>
                  <p className="text-gray-400 leading-relaxed">
                    Your AI reception agent is now ready to handle calls. Redirecting you to the dashboard...
                  </p>
                  <div className="flex justify-center pt-4">
                    <div className="relative">
                      <div className="animate-spin rounded-full h-8 w-8 border-2 border-emerald-500/30 border-t-emerald-500"></div>
                    </div>
                  </div>
                </motion.div>
              </div>
            </motion.div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-black text-white overflow-hidden relative">
      <MinimalHeader />
      <AnimatePresence mode="wait">
        <motion.div
          key={currentStep}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.5, ease: "easeInOut" }}
          className="relative z-10"
        >
          {renderCurrentStep()}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
