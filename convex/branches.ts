import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import {
  requireTenantAccessOrInternal,
  requireRoleOrInternal,
  requirePlatformAdmin,
  TENANT_OWNER_ROLES,
} from "./shared/ownership";

// Branch functions serve the dashboard (session) and the partner API (server,
// forwards the internal secret). Access is scoped to the owning tenant.
//
// Structural lifecycle ops (create / delete a branch) are owner-only for
// session callers (requireRoleOrInternal) — branch managers and supervisors are
// operational and must not add or remove branches. Server-to-server callers
// (partner-API provisioning) forwarding the internal secret are unrestricted.

// Operating hours validator for a single day
const dayHoursValidator = v.optional(
  v.object({
    open: v.string(),
    close: v.string(),
  })
);

// Operating hours validator (reusable)
const operatingHoursValidator = v.object({
  monday: dayHoursValidator,
  tuesday: dayHoursValidator,
  wednesday: dayHoursValidator,
  thursday: dayHoursValidator,
  friday: dayHoursValidator,
  saturday: dayHoursValidator,
  sunday: dayHoursValidator,
});

// Type definitions
type DayHours = { open: string; close: string } | undefined;

type OperatingHours = {
  monday?: DayHours;
  tuesday?: DayHours;
  wednesday?: DayHours;
  thursday?: DayHours;
  friday?: DayHours;
  saturday?: DayHours;
  sunday?: DayHours;
};

// Generate a unique branch ID (10-character alphanumeric)
function generateBranchId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "BR"; // Prefix for branch IDs
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Default operating hours (9 AM - 9 PM, Monday-Saturday)
function getDefaultOperatingHours(): OperatingHours {
  const defaultHours = { open: "09:00", close: "21:00" };
  return {
    monday: defaultHours,
    tuesday: defaultHours,
    wednesday: defaultHours,
    thursday: defaultHours,
    friday: defaultHours,
    saturday: defaultHours,
    sunday: undefined, // Closed on Sunday by default
  };
}

/**
 * Create a new branch
 * Requirements: 1.3
 */
export const createBranch = mutation({
  args: {
    restaurantId: v.string(),
    name: v.string(),
    address: v.string(),
    phoneNumber: v.string(),
    operatingHours: v.optional(operatingHoursValidator),
    isActive: v.optional(v.boolean()),
    internalSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Owner-only for session callers; partner provisioning (internal secret) is
    // unrestricted. Branch managers / supervisors cannot create branches.
    await requireRoleOrInternal(
      ctx,
      args.restaurantId,
      TENANT_OWNER_ROLES,
      args.internalSecret
    );
    // Generate unique branch ID
    let branchId: string;
    let existingBranch;

    do {
      branchId = generateBranchId();
      existingBranch = await ctx.db
        .query("branches")
        .withIndex("by_branch_id", (q) => q.eq("branchId", branchId))
        .first();
    } while (existingBranch);

    const operatingHours = args.operatingHours ?? getDefaultOperatingHours();
    const isActive = args.isActive ?? true;

    const docId = await ctx.db.insert("branches", {
      branchId,
      restaurantId: args.restaurantId,
      name: args.name,
      address: args.address,
      phoneNumber: args.phoneNumber,
      operatingHours,
      isActive,
      createdAt: Date.now(),
    });

    return { branchId, docId };
  },
});

/**
 * Get a branch by branchId
 */
export const getBranch = query({
  args: { branchId: v.string(), internalSecret: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const branch = await ctx.db
      .query("branches")
      .withIndex("by_branch_id", (q) => q.eq("branchId", args.branchId))
      .first();

    await requireTenantAccessOrInternal(ctx, branch?.restaurantId ?? "", args.internalSecret);
    return branch;
  },
});

/**
 * Get all branches for a specific restaurant
 */
export const getBranchesByRestaurant = query({
  args: { restaurantId: v.string(), internalSecret: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireTenantAccessOrInternal(ctx, args.restaurantId, args.internalSecret);
    const branches = await ctx.db
      .query("branches")
      .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.restaurantId))
      .collect();

    return branches;
  },
});

/**
 * Get all active branches for a specific restaurant
 */
export const getActiveBranchesByRestaurant = query({
  args: { restaurantId: v.string(), internalSecret: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireTenantAccessOrInternal(ctx, args.restaurantId, args.internalSecret);
    const branches = await ctx.db
      .query("branches")
      .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.restaurantId))
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();

    return branches;
  },
});

/**
 * Get all branches (platform-wide) — admins only.
 */
export const getAllBranches = query({
  args: {},
  handler: async (ctx) => {
    await requirePlatformAdmin(ctx);
    const branches = await ctx.db.query("branches").take(1000);
    return branches;
  },
});

/**
 * Update a branch
 */
export const updateBranch = mutation({
  args: {
    branchId: v.string(),
    name: v.optional(v.string()),
    address: v.optional(v.string()),
    phoneNumber: v.optional(v.string()),
    operatingHours: v.optional(operatingHoursValidator),
    isActive: v.optional(v.boolean()),
    internalSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const branch = await ctx.db
      .query("branches")
      .withIndex("by_branch_id", (q) => q.eq("branchId", args.branchId))
      .first();

    if (!branch) {
      throw new Error("Branch not found");
    }

    await requireTenantAccessOrInternal(ctx, branch.restaurantId, args.internalSecret);

    // Build updates object with only provided fields
    const updates: {
      name?: string;
      address?: string;
      phoneNumber?: string;
      operatingHours?: OperatingHours;
      isActive?: boolean;
    } = {};

    if (args.name !== undefined) {
      updates.name = args.name;
    }
    if (args.address !== undefined) {
      updates.address = args.address;
    }
    if (args.phoneNumber !== undefined) {
      updates.phoneNumber = args.phoneNumber;
    }
    if (args.operatingHours !== undefined) {
      updates.operatingHours = args.operatingHours;
    }
    if (args.isActive !== undefined) {
      updates.isActive = args.isActive;
    }

    if (Object.keys(updates).length > 0) {
      await ctx.db.patch(branch._id, updates);
    }

    return branch._id;
  },
});

/**
 * Update branch operating hours (partial update)
 */
export const updateBranchOperatingHours = mutation({
  args: {
    branchId: v.string(),
    monday: dayHoursValidator,
    tuesday: dayHoursValidator,
    wednesday: dayHoursValidator,
    thursday: dayHoursValidator,
    friday: dayHoursValidator,
    saturday: dayHoursValidator,
    sunday: dayHoursValidator,
    internalSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const branch = await ctx.db
      .query("branches")
      .withIndex("by_branch_id", (q) => q.eq("branchId", args.branchId))
      .first();

    if (!branch) {
      throw new Error("Branch not found");
    }

    await requireTenantAccessOrInternal(ctx, branch.restaurantId, args.internalSecret);

    // Merge existing operating hours with updates
    const updatedHours: OperatingHours = {
      ...branch.operatingHours,
    };

    if (args.monday !== undefined) {
      updatedHours.monday = args.monday;
    }
    if (args.tuesday !== undefined) {
      updatedHours.tuesday = args.tuesday;
    }
    if (args.wednesday !== undefined) {
      updatedHours.wednesday = args.wednesday;
    }
    if (args.thursday !== undefined) {
      updatedHours.thursday = args.thursday;
    }
    if (args.friday !== undefined) {
      updatedHours.friday = args.friday;
    }
    if (args.saturday !== undefined) {
      updatedHours.saturday = args.saturday;
    }
    if (args.sunday !== undefined) {
      updatedHours.sunday = args.sunday;
    }

    await ctx.db.patch(branch._id, { operatingHours: updatedHours });

    return branch._id;
  },
});

/**
 * Activate a branch
 */
export const activateBranch = mutation({
  args: { branchId: v.string(), internalSecret: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const branch = await ctx.db
      .query("branches")
      .withIndex("by_branch_id", (q) => q.eq("branchId", args.branchId))
      .first();

    if (!branch) {
      throw new Error("Branch not found");
    }

    await requireTenantAccessOrInternal(ctx, branch.restaurantId, args.internalSecret);
    await ctx.db.patch(branch._id, { isActive: true });

    return branch._id;
  },
});

/**
 * Deactivate a branch
 */
export const deactivateBranch = mutation({
  args: { branchId: v.string(), internalSecret: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const branch = await ctx.db
      .query("branches")
      .withIndex("by_branch_id", (q) => q.eq("branchId", args.branchId))
      .first();

    if (!branch) {
      throw new Error("Branch not found");
    }

    await requireTenantAccessOrInternal(ctx, branch.restaurantId, args.internalSecret);
    await ctx.db.patch(branch._id, { isActive: false });

    return branch._id;
  },
});

/**
 * Delete a branch
 */
export const deleteBranch = mutation({
  args: { branchId: v.string(), internalSecret: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const branch = await ctx.db
      .query("branches")
      .withIndex("by_branch_id", (q) => q.eq("branchId", args.branchId))
      .first();

    if (!branch) {
      throw new Error("Branch not found");
    }

    // Owner-only for session callers; internal (server) callers unrestricted.
    await requireRoleOrInternal(
      ctx,
      branch.restaurantId,
      TENANT_OWNER_ROLES,
      args.internalSecret
    );
    await ctx.db.delete(branch._id);

    return { success: true, branchId: args.branchId };
  },
});

/**
 * Count branches for a restaurant
 */
export const countBranchesByRestaurant = query({
  args: { restaurantId: v.string(), internalSecret: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireTenantAccessOrInternal(ctx, args.restaurantId, args.internalSecret);
    const branches = await ctx.db
      .query("branches")
      .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.restaurantId))
      .collect();

    return {
      total: branches.length,
      active: branches.filter((b) => b.isActive).length,
      inactive: branches.filter((b) => !b.isActive).length,
    };
  },
});
