/**
 * Phone Number Provisioning — Queries
 *
 * Convex queries for reading provisioning data.
 * Requirements: 8.2, 8.3, 9.1, 10.1
 */

import { query, internalQuery } from "../_generated/server";
import { v } from "convex/values";

// ─── Feature-flag gate for scheduled lifecycle functions ───────────────────

/**
 * Whether the global `dedicated_numbers_enabled` feature flag is on.
 *
 * Mirrors the gate the provisioning mutations already apply (Req 11.6) so the
 * scheduled lifecycle actions (pool replenishment, quarantine expiry, health
 * checks) no-op when the feature is disabled. Absent flag → disabled.
 */
export const isDedicatedNumbersEnabled = internalQuery({
  args: {},
  handler: async (ctx): Promise<boolean> => {
    const flags = await ctx.db.query("featureFlags").collect();
    const flag = flags.find(
      (f: any) => f.name === "dedicated_numbers_enabled" && f.scope === "global"
    );
    return flag?.enabled === true;
  },
});

// ─── Internal query used by executeProvisioning action ──────────────────────

/** Get a provisioning request by requestId (internal — for actions) */
export const getProvisioningRequestInternal = internalQuery({
  args: {
    requestId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("provisioningRequests")
      .withIndex("by_request_id", (q: any) => q.eq("requestId", args.requestId))
      .first();
  },
});

/** Get quarantined numbers with expired quarantine periods (internal — for scheduled functions) */
export const getExpiredQuarantineNumbers = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    // Query all quarantined numbers using the by_quarantine_expires index
    const quarantinedNumbers = await ctx.db
      .query("phoneNumbers")
      .withIndex("by_status", (q: any) => q.eq("status", "quarantined"))
      .collect();

    // Filter to only those whose quarantine has expired
    return quarantinedNumbers.filter(
      (n: any) => n.quarantineExpiresAt != null && n.quarantineExpiresAt < now
    );
  },
});

/** Get available number count for a specific region (internal — for scheduled functions) */
export const getAvailableCountByRegion = internalQuery({
  args: {
    region: v.string(),
  },
  handler: async (ctx, args) => {
    const availableNumbers = await ctx.db
      .query("phoneNumbers")
      .withIndex("by_status", (q: any) => q.eq("status", "available"))
      .collect();

    return availableNumbers.filter((n: any) => n.region === args.region).length;
  },
});

/** Get all assigned phone numbers (internal — for health checks) */
export const getAssignedNumbers = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("phoneNumbers")
      .withIndex("by_status", (q: any) => q.eq("status", "assigned"))
      .collect();
  },
});


// ─── Public queries ─────────────────────────────────────────────────────────

/**
 * Get the assigned phone number record for a branch.
 * Uses the by_assigned_to index to find the number with assignedToType "branch"
 * and assignedToId matching the given branchId.
 * Req 9.1, 10.1
 */
export const getPhoneNumberByBranch = query({
  args: {
    branchId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("phoneNumbers")
      .withIndex("by_assigned_to", (q: any) =>
        q.eq("assignedToType", "branch").eq("assignedToId", args.branchId)
      )
      .first();
  },
});

/**
 * Get a provisioning request by requestId (public — for frontend polling).
 * Req 9.1
 */
export const getProvisioningRequest = query({
  args: {
    requestId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("provisioningRequests")
      .withIndex("by_request_id", (q: any) => q.eq("requestId", args.requestId))
      .first();
  },
});

/**
 * Get provisioning request history for a branch.
 * Returns all provisioning requests associated with the given branchId,
 * ordered by creation time (most recent first).
 * Req 10.1
 */
export const getProvisioningRequestsByBranch = query({
  args: {
    branchId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("provisioningRequests")
      .withIndex("by_branch_id", (q: any) => q.eq("branchId", args.branchId))
      .collect();
  },
});

/**
 * Get pool status — available number counts per region.
 * If a region is provided, returns the count for that region only.
 * Otherwise returns counts for all regions.
 * Req 10.1
 */
export const getPoolStatus = query({
  args: {
    region: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const availableNumbers = await ctx.db
      .query("phoneNumbers")
      .withIndex("by_status", (q: any) => q.eq("status", "available"))
      .collect();

    if (args.region) {
      const count = availableNumbers.filter(
        (n: any) => n.region === args.region
      ).length;
      return { [args.region]: count };
    }

    // Group by region
    const counts: Record<string, number> = {};
    for (const number of availableNumbers) {
      const region = number.region;
      counts[region] = (counts[region] || 0) + 1;
    }
    return counts;
  },
});

/**
 * Get total monthly phone number costs grouped by provider or region.
 * Only counts numbers in "assigned" status (active cost).
 * Req 8.2
 */
export const getMonthlyPhoneNumberCosts = query({
  args: {
    groupBy: v.union(v.literal("provider"), v.literal("region")),
  },
  handler: async (ctx, args) => {
    const assignedNumbers = await ctx.db
      .query("phoneNumbers")
      .withIndex("by_status", (q: any) => q.eq("status", "assigned"))
      .collect();

    const groups: Record<string, { totalCost: number; currency: string; count: number }> = {};

    for (const number of assignedNumbers) {
      const key = args.groupBy === "provider" ? number.provider : number.region;
      if (!groups[key]) {
        groups[key] = { totalCost: 0, currency: number.currency ?? "USD", count: 0 };
      }
      groups[key].totalCost += number.monthlyCost ?? 0;
      groups[key].count += 1;
    }

    return groups;
  },
});

/**
 * Get per-branch phone number cost for billing integration.
 * Returns the monthly cost of the number assigned to the given branch.
 * Req 8.3
 */
export const getBranchPhoneNumberCost = query({
  args: {
    branchId: v.string(),
  },
  handler: async (ctx, args) => {
    const phoneNumber = await ctx.db
      .query("phoneNumbers")
      .withIndex("by_assigned_to", (q: any) =>
        q.eq("assignedToType", "branch").eq("assignedToId", args.branchId)
      )
      .first();

    if (!phoneNumber) {
      return { branchId: args.branchId, monthlyCost: 0, currency: "USD", hasNumber: false };
    }

    return {
      branchId: args.branchId,
      monthlyCost: phoneNumber.monthlyCost ?? 0,
      currency: phoneNumber.currency ?? "USD",
      hasNumber: true,
      numberId: phoneNumber.numberId,
      phoneNumber: phoneNumber.phoneNumber,
      provider: phoneNumber.provider,
    };
  },
});
