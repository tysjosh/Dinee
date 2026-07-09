import { Suspense } from "react";
import { CampusAgentProvider } from "@/contexts/CampusAgentContext";
import { AnalyticsDashboard } from "@/components/campus/AnalyticsDashboard";

/**
 * Feature: dinee-campus (Task 33.1 + 34.1)
 *
 * Route `/campus/dashboard` — the owner-gated Usage_Dashboard (Req 9.1–9.8,
 * 14.1). Renders the client `AnalyticsDashboard`, which reads the target
 * Campus_Agent id from the `?agentId=` query string and the owner-only
 * analytics from the `campus.analytics.getAgentAnalytics` query.
 *
 * Wrapped in `CampusAgentProvider` (Task 34.1) so the dashboard can surface the
 * shared near-limit warning + upgrade CTA from the Usage_Meter (Req 13.2, 13.3).
 * `useSearchParams` requires a Suspense boundary in the App Router, so the
 * client dashboard is wrapped accordingly.
 */
export default function CampusDashboardPage() {
  return (
    <Suspense fallback={null}>
      <CampusAgentProvider>
        <AnalyticsDashboard />
      </CampusAgentProvider>
    </Suspense>
  );
}
