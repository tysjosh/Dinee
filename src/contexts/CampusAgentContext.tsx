"use client";

/**
 * Feature: dinee-campus (Task 34.1) — `CampusAgentProvider` / `useCampusAgent`.
 *
 * The shared React Context + custom hook for the Campus creation/edit flows,
 * following the established `CallsContext`/`useCalls` pattern in
 * `src/contexts/**`. It centralizes the cross-cutting concerns those flows share
 * so individual surfaces (Onboarding_Flow, Creation_Flow, Analytics_Dashboard,
 * settings) don't each re-derive them:
 *
 *   - The authenticated Student_Creator's calendar-month Usage_Meter snapshot,
 *     tier limits, and the set of near-limit dimensions, read live from
 *     `campus.usage.getUsage` (Req 13.1, 13.2).
 *   - A derived `nearLimit` flag + human labels for the "limit nearly reached"
 *     warning (Req 13.2), and a `reachedLimit` map for the reached-limit upgrade
 *     prompt (Req 13.3).
 *   - `goToUpgrade(dimension?)` — the single navigation seam to the Campus
 *     upgrade CTA target (`/campus/upgrade`), which routes through the EXISTING
 *     checkout flow (Req 13.3, 13.4).
 *
 * The discovery/profile/analytics reads stay on Convex `useQuery`/`useMutation`
 * directly (per the design's State management note); this provider only owns the
 * creation/edit shared state. It is safe to mount above unauthenticated content:
 * the usage query is skipped until the viewer is authenticated, and every value
 * has a well-defined "not loaded yet" shape.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type {
  UsageDimension,
  UsageSnapshot,
  TierLimits,
} from "../../convex/campus/logic/usage";

/** The account tier resolved from the owner's subscription (Req 13.1, 13.4). */
export type CampusAccountTier = "free" | "paid";

/** The `campus.usage.getUsage` result shape (see `convex/campus/usage.ts`). */
export interface CampusUsage {
  readonly tier: CampusAccountTier;
  readonly period: string;
  readonly usage: UsageSnapshot;
  readonly limits: TierLimits;
  readonly nearLimit: readonly UsageDimension[];
}

/** Student-facing labels for each metered dimension (no business terminology). */
export const USAGE_DIMENSION_LABELS: Readonly<Record<UsageDimension, string>> = {
  agents: "agents",
  documentUploads: "document uploads",
  callMinutes: "call minutes",
};

interface CampusAgentContextValue {
  /** True until the viewer is known to be authenticated (auth still resolving). */
  readonly authLoading: boolean;
  /** Whether a Student_Creator is signed in (usage is only read when true). */
  readonly isAuthenticated: boolean;
  /** True while the usage snapshot is being fetched for a signed-in viewer. */
  readonly usageLoading: boolean;
  /** The live Usage_Meter snapshot, or null before it loads / when signed out. */
  readonly usage: CampusUsage | null;
  /** The dimensions currently in the near-limit band (≥80% of and < limit). */
  readonly nearLimitDimensions: readonly UsageDimension[];
  /** True when any dimension is in the near-limit band (Req 13.2). */
  readonly isNearLimit: boolean;
  /** The dimensions whose usage has reached (≥) the tier limit (Req 13.3). */
  readonly reachedLimitDimensions: readonly UsageDimension[];
  /** Navigate to the upgrade CTA target, optionally citing a dimension. */
  readonly goToUpgrade: (dimension?: UsageDimension) => void;
}

const CampusAgentContext = createContext<CampusAgentContextValue | undefined>(
  undefined
);

/** Builds the `/campus/upgrade` href, tagging the reason dimension when known. */
export function buildUpgradeHref(dimension?: UsageDimension): string {
  return dimension ? `/campus/upgrade?reason=${dimension}` : "/campus/upgrade";
}

export function CampusAgentProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();

  // The Usage_Meter snapshot is owner-scoped and only meaningful when signed in;
  // skip the query entirely for anonymous viewers (landing/discovery/profile).
  const usageResult = useQuery(
    api.campus.usage.getUsage,
    isAuthenticated ? {} : "skip"
  ) as CampusUsage | undefined;

  const usage = usageResult ?? null;
  const usageLoading = isAuthenticated && usageResult === undefined;

  const nearLimitDimensions = useMemo<readonly UsageDimension[]>(
    () => usage?.nearLimit ?? [],
    [usage]
  );

  // Dimensions at or above their tier limit — used for the reached-limit upgrade
  // prompt (Req 13.3). A non-finite (unbounded paid-tier) limit is never reached.
  const reachedLimitDimensions = useMemo<readonly UsageDimension[]>(() => {
    if (!usage) return [];
    const { usage: counts, limits } = usage;
    const dims: UsageDimension[] = [];
    if (Number.isFinite(limits.agents) && counts.agents >= limits.agents) {
      dims.push("agents");
    }
    if (
      Number.isFinite(limits.documentUploads) &&
      counts.documentUploads >= limits.documentUploads
    ) {
      dims.push("documentUploads");
    }
    if (
      Number.isFinite(limits.callMinutes) &&
      counts.callMinutes >= limits.callMinutes
    ) {
      dims.push("callMinutes");
    }
    return dims;
  }, [usage]);

  const goToUpgrade = useCallback(
    (dimension?: UsageDimension) => {
      router.push(buildUpgradeHref(dimension));
    },
    [router]
  );

  const value = useMemo<CampusAgentContextValue>(
    () => ({
      authLoading,
      isAuthenticated,
      usageLoading,
      usage,
      nearLimitDimensions,
      isNearLimit: nearLimitDimensions.length > 0,
      reachedLimitDimensions,
      goToUpgrade,
    }),
    [
      authLoading,
      isAuthenticated,
      usageLoading,
      usage,
      nearLimitDimensions,
      reachedLimitDimensions,
      goToUpgrade,
    ]
  );

  return (
    <CampusAgentContext.Provider value={value}>
      {children}
    </CampusAgentContext.Provider>
  );
}

/**
 * Access the shared Campus creation/edit state. Must be called from within a
 * `CampusAgentProvider` (mounted by the `/campus/**` surfaces that need it).
 */
export function useCampusAgent(): CampusAgentContextValue {
  const context = useContext(CampusAgentContext);
  if (context === undefined) {
    throw new Error("useCampusAgent must be used within a CampusAgentProvider");
  }
  return context;
}
