"use client";

/**
 * Feature: dinee-campus (Task 34.1) — near-limit warning + upgrade option.
 *
 * Presents the "limit nearly reached" warning whenever any metered dimension is
 * in the near-limit band (usage ≥ 80% of and below the limit) and offers the
 * upgrade option routed through the shared `/campus/upgrade` CTA target
 * (Req 13.2, 13.3). Reads the live Usage_Meter snapshot from `useCampusAgent`,
 * so it must be mounted within a `CampusAgentProvider`. Renders nothing when no
 * dimension is near its limit.
 *
 * Mobile-first: no horizontal scroll at 360px; the upgrade control meets the
 * 44×44 touch-target minimum (Req 14.1, 14.2).
 */

import React from "react";
import {
  useCampusAgent,
  USAGE_DIMENSION_LABELS,
} from "@/contexts/CampusAgentContext";

export function NearLimitBanner() {
  const { isNearLimit, nearLimitDimensions, goToUpgrade } = useCampusAgent();

  if (!isNearLimit) return null;

  const labels = nearLimitDimensions.map((d) => USAGE_DIMENSION_LABELS[d]);
  const dimensionText =
    labels.length === 1
      ? labels[0]
      : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  // Pass a single reason dimension through to the upgrade page when unambiguous.
  const reason =
    nearLimitDimensions.length === 1 ? nearLimitDimensions[0] : undefined;

  return (
    <div
      className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4"
      role="status"
      data-testid="campus-near-limit-banner"
    >
      <p className="text-sm font-medium text-amber-200">
        You&apos;re close to your free plan {dimensionText} limit.
      </p>
      <p className="mt-1 text-sm text-amber-200/80">
        Upgrade to keep creating without interruptions.
      </p>
      <button
        type="button"
        onClick={() => goToUpgrade(reason)}
        className="btn btn-primary btn-sm mt-3 min-h-[44px]"
        data-testid="campus-near-limit-upgrade"
      >
        See upgrade options
      </button>
    </div>
  );
}

export default NearLimitBanner;
