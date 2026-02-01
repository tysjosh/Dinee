/**
 * Branch Capacity Mutations and Queries
 * 
 * Convex operations for tracking branch capacity status.
 * Used by OrderRoutingService for routing decisions.
 */

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Get branch capacity status
 */
export const getBranchCapacity = query({
  args: {
    branchId: v.string(),
  },
  handler: async (ctx, args) => {
    const capacity = await ctx.db
      .query("branchCapacity")
      .withIndex("by_branch_id", (q) => q.eq("branchId", args.branchId))
      .first();

    if (!capacity) {
      // Return default values if no record exists
      return {
        branchId: args.branchId,
        status: "available" as const,
        activeOrders: 0,
        maxCapacity: 50,
        lastUpdated: 0,
      };
    }

    return capacity;
  },
});

/**
 * Get capacity for multiple branches
 */
export const getBranchCapacities = query({
  args: {
    branchIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const capacities: Record<string, {
      branchId: string;
      status: "available" | "busy" | "at_capacity";
      activeOrders: number;
      maxCapacity: number;
      lastUpdated: number;
    }> = {};

    for (const branchId of args.branchIds) {
      const capacity = await ctx.db
        .query("branchCapacity")
        .withIndex("by_branch_id", (q) => q.eq("branchId", branchId))
        .first();

      capacities[branchId] = capacity || {
        branchId,
        status: "available",
        activeOrders: 0,
        maxCapacity: 50,
        lastUpdated: 0,
      };
    }

    return capacities;
  },
});

/**
 * Update branch capacity status
 */
export const updateBranchCapacity = mutation({
  args: {
    branchId: v.string(),
    activeOrders: v.number(),
    maxCapacity: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const maxCapacity = args.maxCapacity ?? 50;
    
    // Calculate status based on active orders
    let status: "available" | "busy" | "at_capacity";
    if (args.activeOrders >= maxCapacity) {
      status = "at_capacity";
    } else if (args.activeOrders >= maxCapacity * 0.8) {
      status = "busy";
    } else {
      status = "available";
    }

    // Check if record exists
    const existing = await ctx.db
      .query("branchCapacity")
      .withIndex("by_branch_id", (q) => q.eq("branchId", args.branchId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        status,
        activeOrders: args.activeOrders,
        maxCapacity,
        lastUpdated: Date.now(),
      });
    } else {
      await ctx.db.insert("branchCapacity", {
        branchId: args.branchId,
        status,
        activeOrders: args.activeOrders,
        maxCapacity,
        lastUpdated: Date.now(),
      });
    }

    return { success: true, status, activeOrders: args.activeOrders };
  },
});

/**
 * Increment active orders for a branch
 */
export const incrementActiveOrders = mutation({
  args: {
    branchId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("branchCapacity")
      .withIndex("by_branch_id", (q) => q.eq("branchId", args.branchId))
      .first();

    const maxCapacity = existing?.maxCapacity ?? 50;
    const newActiveOrders = (existing?.activeOrders ?? 0) + 1;

    let status: "available" | "busy" | "at_capacity";
    if (newActiveOrders >= maxCapacity) {
      status = "at_capacity";
    } else if (newActiveOrders >= maxCapacity * 0.8) {
      status = "busy";
    } else {
      status = "available";
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        status,
        activeOrders: newActiveOrders,
        lastUpdated: Date.now(),
      });
    } else {
      await ctx.db.insert("branchCapacity", {
        branchId: args.branchId,
        status,
        activeOrders: newActiveOrders,
        maxCapacity,
        lastUpdated: Date.now(),
      });
    }

    return { success: true, status, activeOrders: newActiveOrders };
  },
});

/**
 * Decrement active orders for a branch
 */
export const decrementActiveOrders = mutation({
  args: {
    branchId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("branchCapacity")
      .withIndex("by_branch_id", (q) => q.eq("branchId", args.branchId))
      .first();

    if (!existing) {
      return { success: true, status: "available" as const, activeOrders: 0 };
    }

    const maxCapacity = existing.maxCapacity;
    const newActiveOrders = Math.max(0, existing.activeOrders - 1);

    let status: "available" | "busy" | "at_capacity";
    if (newActiveOrders >= maxCapacity) {
      status = "at_capacity";
    } else if (newActiveOrders >= maxCapacity * 0.8) {
      status = "busy";
    } else {
      status = "available";
    }

    await ctx.db.patch(existing._id, {
      status,
      activeOrders: newActiveOrders,
      lastUpdated: Date.now(),
    });

    return { success: true, status, activeOrders: newActiveOrders };
  },
});

/**
 * Get all branches by status
 */
export const getBranchesByStatus = query({
  args: {
    status: v.union(
      v.literal("available"),
      v.literal("busy"),
      v.literal("at_capacity")
    ),
  },
  handler: async (ctx, args) => {
    const capacities = await ctx.db
      .query("branchCapacity")
      .withIndex("by_status", (q) => q.eq("status", args.status))
      .collect();

    return capacities;
  },
});

/**
 * Clear all capacity data (for testing)
 */
export const clearAllCapacity = mutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("branchCapacity").collect();
    
    for (const record of all) {
      await ctx.db.delete(record._id);
    }

    return { success: true, deletedCount: all.length };
  },
});
