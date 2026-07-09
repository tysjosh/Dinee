"use client";

import { useSearchParams } from "next/navigation";
import { OnboardingWizard } from "@/components/campus/OnboardingWizard";
import { CreationWizard } from "@/components/campus/CreationWizard";

/**
 * Feature: dinee-campus (Task 29.1)
 *
 * Client router for the `/campus/create` surface. The Onboarding_Flow
 * (`OnboardingWizard`) creates a draft and links to
 * `/campus/create?agentId=…` labeled "Keep building"; that `agentId` is the
 * entry point for the seven-step `CreationWizard`. This component picks the
 * right surface from the `agentId` query value so both flows share one route
 * and one draft: no `agentId` → onboarding a brand-new agent; `agentId` present
 * → the creation flow for that draft.
 */
export function CampusCreateRouter() {
  const searchParams = useSearchParams();
  const agentId = searchParams.get("agentId");

  if (agentId) {
    return <CreationWizard agentId={agentId} />;
  }
  return <OnboardingWizard />;
}

export default CampusCreateRouter;
