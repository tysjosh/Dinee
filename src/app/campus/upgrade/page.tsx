import { Suspense } from "react";
import { CampusAgentProvider } from "@/contexts/CampusAgentContext";
import { UpgradeView } from "@/components/campus/UpgradeView";

/**
 * Feature: dinee-campus (Task 34.1)
 *
 * Route `/campus/upgrade` — the upgrade CTA target every near-limit warning and
 * reached-limit prompt points at (e.g. the `CreationWizard` publish blocker's
 * "See upgrade options" link). It presents the paid creator tier and starts
 * checkout through the EXISTING checkout flow (Req 13.3, 13.4).
 *
 * Wrapped in `CampusAgentProvider` so `UpgradeView` can read the live
 * Usage_Meter snapshot via `useCampusAgent`, and in `Suspense` because
 * `useSearchParams` (the `?reason=` dimension) requires a boundary in the App
 * Router.
 */
export default function CampusUpgradePage() {
  return (
    <Suspense fallback={null}>
      <CampusAgentProvider>
        <UpgradeView />
      </CampusAgentProvider>
    </Suspense>
  );
}
