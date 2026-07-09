import { Suspense } from "react";
import { CampusAgentProvider } from "@/contexts/CampusAgentContext";
import { CampusCreateRouter } from "./CampusCreateRouter";

/**
 * Feature: dinee-campus (Task 28.2 + 29.1 + 34.1)
 *
 * Route `/campus/create` — the student creation surface. With no query it shows
 * the Onboarding_Flow (`OnboardingWizard`); with `?agentId=…` it shows the
 * seven-step `CreationWizard` for that draft (the Onboarding_Flow's
 * "Keep building" destination). Auth is required only to complete/publish and is
 * enforced inline by the wizards (Req 2.1–2.9, 4.1–4.7).
 *
 * Wrapped in `CampusAgentProvider` (Task 34.1) so the creation/edit flow can
 * read the shared Usage_Meter snapshot via `useCampusAgent` — powering the
 * near-limit warning + upgrade CTA (Req 13.2, 13.3). `useSearchParams` requires
 * a Suspense boundary in the App Router, so the client router is wrapped
 * accordingly.
 */
export default function CampusCreatePage() {
  return (
    <Suspense fallback={null}>
      <CampusAgentProvider>
        <CampusCreateRouter />
      </CampusAgentProvider>
    </Suspense>
  );
}
