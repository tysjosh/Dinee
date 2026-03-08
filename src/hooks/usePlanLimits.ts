"use client";

import { useQuery } from "convex/react";
import { useMemo } from "react";
import { api } from "../../convex/_generated/api";
import { useTenant } from "@/contexts/TenantContext";
import { getPlanById, isWithinLimit } from "@/lib/billing/SubscriptionService";
import type { PlanLimits } from "@/lib/billing/types";

/**
 * Result of a single limit check.
 */
export interface LimitCheckResult {
  /** Whether the action is allowed */
  allowed: boolean;
  /** Current usage count */
  current: number;
  /** Plan limit (-1 means unlimited) */
  limit: number;
}

/**
 * Return type for the usePlanLimits hook.
 */
export interface UsePlanLimitsReturn {
  canCreateBranch: () => LimitCheckResult;
  canProcessCall: () => LimitCheckResult;
  canCreateOrder: () => LimitCheckResult;
  canAddMenuItem: () => LimitCheckResult;
  canInviteTeamMember: () => LimitCheckResult;
  isAdmin: boolean;
  isLoading: boolean;
}

/**
 * Check a usage value against a plan limit, respecting -1 as unlimited.
 */
function checkLimit(current: number, limit: number): LimitCheckResult {
  return {
    allowed: isWithinLimit(current, limit),
    current,
    limit,
  };
}

/** Default limits when no subscription exists (most restrictive). */
const NO_PLAN_LIMITS: PlanLimits = {
  maxBranches: 0,
  maxCallsPerMonth: 0,
  maxOrdersPerMonth: 0,
  maxCatalogItems: 0,
  maxTeamMembers: 0,
};

/** Result returned while data is still loading. */
const LOADING_RESULT: LimitCheckResult = { allowed: false, current: 0, limit: 0 };

/** Result returned for admin users — always allowed. */
function adminResult(current: number): LimitCheckResult {
  return { allowed: true, current, limit: -1 };
}

/**
 * Hook that queries subscription and usage data, returns limit check
 * functions with platform_admin bypass.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.7
 *
 * @param restaurantId - The restaurant to check limits for
 */
export function usePlanLimits(restaurantId: string | undefined): UsePlanLimitsReturn {
  const { state: tenantState } = useTenant();
  const isAdmin = tenantState.userRole === "platform_admin";

  const subscription = useQuery(
    api.subscriptions.getSubscriptionByRestaurant,
    restaurantId ? { restaurantId } : "skip"
  );

  const periodStart = subscription?.currentPeriodStart ?? 0;
  const periodEnd = subscription?.currentPeriodEnd ?? 0;

  const usage = useQuery(
    api.subscriptions.getSubscriptionUsage,
    restaurantId && periodStart && periodEnd
      ? { restaurantId, periodStart, periodEnd }
      : "skip"
  );

  const plan = useMemo(
    () => (subscription?.planId ? getPlanById(subscription.planId) : undefined),
    [subscription?.planId]
  );

  const limits: PlanLimits = plan?.limits ?? NO_PLAN_LIMITS;

  const isLoading =
    subscription === undefined || (subscription !== null && usage === undefined);

  return useMemo(() => {
    // While loading, return safe defaults that block actions
    if (isLoading) {
      return {
        canCreateBranch: () => LOADING_RESULT,
        canProcessCall: () => LOADING_RESULT,
        canCreateOrder: () => LOADING_RESULT,
        canAddMenuItem: () => LOADING_RESULT,
        canInviteTeamMember: () => LOADING_RESULT,
        isAdmin,
        isLoading: true,
      };
    }

    const branchCount = usage?.branchCount ?? 0;
    const callsThisPeriod = usage?.callsThisPeriod ?? 0;
    const ordersThisPeriod = usage?.ordersThisPeriod ?? 0;
    const catalogItemCount = usage?.catalogItemCount ?? 0;
    const teamMemberCount = usage?.teamMemberCount ?? 0;

    return {
      canCreateBranch: () =>
        isAdmin
          ? adminResult(branchCount)
          : checkLimit(branchCount, limits.maxBranches),
      canProcessCall: () =>
        isAdmin
          ? adminResult(callsThisPeriod)
          : checkLimit(callsThisPeriod, limits.maxCallsPerMonth),
      canCreateOrder: () =>
        isAdmin
          ? adminResult(ordersThisPeriod)
          : checkLimit(ordersThisPeriod, limits.maxOrdersPerMonth),
      canAddMenuItem: () =>
        isAdmin
          ? adminResult(catalogItemCount)
          : checkLimit(catalogItemCount, limits.maxCatalogItems),
      canInviteTeamMember: () =>
        isAdmin
          ? adminResult(teamMemberCount)
          : checkLimit(teamMemberCount, limits.maxTeamMembers),
      isAdmin,
      isLoading: false,
    };
  }, [isLoading, isAdmin, usage, limits]);
}
