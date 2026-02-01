/**
 * Migration Rollback Mutations
 * 
 * Convex mutations for migration rollback capability.
 * Requirements: 28.7
 * 
 * Key features:
 * - Creates snapshots before migration for rollback capability
 * - Supports rollback within 30 days of migration
 * - Reverts restaurant platformId assignments
 * - Deletes created branches
 * - Reverts branchId assignments on menu items, calls, and orders
 */

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * 30 days in milliseconds
 */
const ROLLBACK_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Generate a unique snapshot ID
 */
function generateSnapshotId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "SNAP";
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Create a migration snapshot before running migration
 * 
 * This mutation captures the current state of restaurants, branches,
 * and data before migration, enabling rollback within 30 days.
 * 
 * Requirements: 28.7
 */
export const createMigrationSnapshot = mutation({
  args: {
    migrationType: v.union(
      v.literal("structure"),
      v.literal("data"),
      v.literal("complete")
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const expiresAt = now + ROLLBACK_WINDOW_MS;

    // Capture current restaurant state
    const allRestaurants = await ctx.db.query("restaurants").collect();
    const restaurantSnapshots = allRestaurants.map((r) => ({
      restaurantId: r.restaurantId,
      originalPlatformId: r.platformId || undefined,
      originalBranchCount: r.branchCount || undefined,
    }));

    // Get existing branches (to know which ones NOT to delete on rollback)
    const existingBranches = await ctx.db.query("branches").collect();
    const existingBranchIds = new Set(existingBranches.map((b) => b.branchId));

    // Get current data state for tracking what gets migrated
    const menuItemsWithBranch = await ctx.db.query("menuItems").collect();
    const callsWithBranch = await ctx.db.query("calls").collect();
    const ordersWithBranch = await ctx.db.query("orders").collect();

    // Track items that already have branchId (won't be reverted)
    const existingMenuItemIds = menuItemsWithBranch
      .filter((m) => m.branchId && m.branchId.trim() !== "")
      .map((m) => m._id.toString());
    const existingCallIds = callsWithBranch
      .filter((c) => c.branchId && c.branchId.trim() !== "")
      .map((c) => c.callId);
    const existingOrderIds = ordersWithBranch
      .filter((o) => o.branchId && o.branchId.trim() !== "")
      .map((o) => o.orderId);

    // Generate unique snapshot ID
    let snapshotId: string;
    let existingSnapshot;

    do {
      snapshotId = generateSnapshotId();
      existingSnapshot = await ctx.db
        .query("migrationSnapshots")
        .withIndex("by_snapshot_id", (q) => q.eq("snapshotId", snapshotId))
        .first();
    } while (existingSnapshot);

    // Create the snapshot
    await ctx.db.insert("migrationSnapshots", {
      snapshotId,
      migrationType: args.migrationType,
      restaurantSnapshots,
      createdBranchIds: [], // Will be populated after migration
      migratedMenuItemIds: [], // Will be populated after migration
      migratedCallIds: [], // Will be populated after migration
      migratedOrderIds: [], // Will be populated after migration
      status: "active",
      createdAt: now,
      expiresAt,
    });

    return {
      success: true,
      message: "Migration snapshot created successfully",
      snapshotId,
      expiresAt,
      restaurantCount: restaurantSnapshots.length,
      existingBranchCount: existingBranchIds.size,
    };
  },
});


/**
 * Update migration snapshot with created/migrated items
 * 
 * Called after migration to record what was created/migrated,
 * enabling accurate rollback.
 * 
 * Requirements: 28.7
 */
export const updateMigrationSnapshot = mutation({
  args: {
    snapshotId: v.string(),
    createdBranchIds: v.optional(v.array(v.string())),
    migratedMenuItemIds: v.optional(v.array(v.string())),
    migratedCallIds: v.optional(v.array(v.string())),
    migratedOrderIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const snapshot = await ctx.db
      .query("migrationSnapshots")
      .withIndex("by_snapshot_id", (q) => q.eq("snapshotId", args.snapshotId))
      .first();

    if (!snapshot) {
      return {
        success: false,
        message: `Snapshot ${args.snapshotId} not found`,
      };
    }

    if (snapshot.status !== "active") {
      return {
        success: false,
        message: `Snapshot ${args.snapshotId} is not active (status: ${snapshot.status})`,
      };
    }

    // Update with new data
    await ctx.db.patch(snapshot._id, {
      createdBranchIds: args.createdBranchIds || snapshot.createdBranchIds,
      migratedMenuItemIds: args.migratedMenuItemIds || snapshot.migratedMenuItemIds,
      migratedCallIds: args.migratedCallIds || snapshot.migratedCallIds,
      migratedOrderIds: args.migratedOrderIds || snapshot.migratedOrderIds,
    });

    return {
      success: true,
      message: "Snapshot updated successfully",
      snapshotId: args.snapshotId,
    };
  },
});


/**
 * Check rollback eligibility
 * 
 * Verifies if a migration can be rolled back based on:
 * - Snapshot exists and is active
 * - Within 30-day rollback window
 * 
 * Requirements: 28.7
 */
export const checkRollbackEligibility = query({
  args: {
    snapshotId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // If specific snapshot requested
    if (args.snapshotId) {
      const snapshotIdValue = args.snapshotId;
      const snapshot = await ctx.db
        .query("migrationSnapshots")
        .withIndex("by_snapshot_id", (q) => q.eq("snapshotId", snapshotIdValue))
        .first();

      if (!snapshot) {
        return {
          eligible: false,
          reason: `Snapshot ${args.snapshotId} not found`,
        };
      }

      if (snapshot.status === "rolled_back") {
        return {
          eligible: false,
          reason: "This migration has already been rolled back",
          snapshot: {
            snapshotId: snapshot.snapshotId,
            migrationType: snapshot.migrationType,
            status: snapshot.status,
            rolledBackAt: snapshot.rolledBackAt,
          },
        };
      }

      if (snapshot.status === "expired" || now > snapshot.expiresAt) {
        return {
          eligible: false,
          reason: "Rollback window has expired (30 days)",
          snapshot: {
            snapshotId: snapshot.snapshotId,
            migrationType: snapshot.migrationType,
            status: snapshot.status,
            expiresAt: snapshot.expiresAt,
          },
        };
      }

      const daysRemaining = Math.ceil((snapshot.expiresAt - now) / (24 * 60 * 60 * 1000));

      return {
        eligible: true,
        reason: `Rollback available for ${daysRemaining} more days`,
        daysRemaining,
        snapshot: {
          snapshotId: snapshot.snapshotId,
          migrationType: snapshot.migrationType,
          status: snapshot.status,
          createdAt: snapshot.createdAt,
          expiresAt: snapshot.expiresAt,
          restaurantCount: snapshot.restaurantSnapshots.length,
          branchCount: snapshot.createdBranchIds.length,
          menuItemCount: snapshot.migratedMenuItemIds.length,
          callCount: snapshot.migratedCallIds.length,
          orderCount: snapshot.migratedOrderIds.length,
        },
      };
    }

    // Find most recent active snapshot
    const activeSnapshots = await ctx.db
      .query("migrationSnapshots")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();

    const validSnapshots = activeSnapshots.filter((s) => now < s.expiresAt);

    if (validSnapshots.length === 0) {
      return {
        eligible: false,
        reason: "No active migration snapshots available for rollback",
      };
    }

    // Sort by creation date (most recent first)
    validSnapshots.sort((a, b) => b.createdAt - a.createdAt);
    const latestSnapshot = validSnapshots[0];
    const daysRemaining = Math.ceil((latestSnapshot.expiresAt - now) / (24 * 60 * 60 * 1000));

    return {
      eligible: true,
      reason: `Rollback available for ${daysRemaining} more days`,
      daysRemaining,
      snapshot: {
        snapshotId: latestSnapshot.snapshotId,
        migrationType: latestSnapshot.migrationType,
        status: latestSnapshot.status,
        createdAt: latestSnapshot.createdAt,
        expiresAt: latestSnapshot.expiresAt,
        restaurantCount: latestSnapshot.restaurantSnapshots.length,
        branchCount: latestSnapshot.createdBranchIds.length,
        menuItemCount: latestSnapshot.migratedMenuItemIds.length,
        callCount: latestSnapshot.migratedCallIds.length,
        orderCount: latestSnapshot.migratedOrderIds.length,
      },
      availableSnapshots: validSnapshots.map((s) => ({
        snapshotId: s.snapshotId,
        migrationType: s.migrationType,
        createdAt: s.createdAt,
      })),
    };
  },
});


/**
 * Rollback migration
 * 
 * Reverts migration changes based on a snapshot:
 * 1. Reverts restaurant platformId assignments
 * 2. Deletes branches created during migration
 * 3. Removes branchId from migrated menu items, calls, and orders
 * 
 * Requirements: 28.7
 */
export const rollbackMigration = mutation({
  args: {
    snapshotId: v.string(),
    rolledBackBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const startTime = Date.now();

    // Get the snapshot
    const snapshot = await ctx.db
      .query("migrationSnapshots")
      .withIndex("by_snapshot_id", (q) => q.eq("snapshotId", args.snapshotId))
      .first();

    if (!snapshot) {
      return {
        success: false,
        message: `Snapshot ${args.snapshotId} not found`,
        snapshotId: args.snapshotId,
        restaurantsReverted: 0,
        branchesDeleted: 0,
        menuItemsReverted: 0,
        callsReverted: 0,
        ordersReverted: 0,
        durationMs: Date.now() - startTime,
      };
    }

    if (snapshot.status === "rolled_back") {
      return {
        success: false,
        message: "This migration has already been rolled back",
        snapshotId: args.snapshotId,
        restaurantsReverted: 0,
        branchesDeleted: 0,
        menuItemsReverted: 0,
        callsReverted: 0,
        ordersReverted: 0,
        durationMs: Date.now() - startTime,
      };
    }

    if (snapshot.status === "expired" || Date.now() > snapshot.expiresAt) {
      return {
        success: false,
        message: "Rollback window has expired (30 days)",
        snapshotId: args.snapshotId,
        restaurantsReverted: 0,
        branchesDeleted: 0,
        menuItemsReverted: 0,
        callsReverted: 0,
        ordersReverted: 0,
        durationMs: Date.now() - startTime,
      };
    }

    let restaurantsReverted = 0;
    let branchesDeleted = 0;
    let menuItemsReverted = 0;
    let callsReverted = 0;
    let ordersReverted = 0;

    // Step 1: Revert restaurant platformId assignments
    for (const restaurantSnapshot of snapshot.restaurantSnapshots) {
      try {
        const restaurant = await ctx.db
          .query("restaurants")
          .withIndex("by_restaurant_id", (q) => 
            q.eq("restaurantId", restaurantSnapshot.restaurantId)
          )
          .first();

        if (restaurant) {
          await ctx.db.patch(restaurant._id, {
            platformId: restaurantSnapshot.originalPlatformId || "",
            branchCount: restaurantSnapshot.originalBranchCount,
          });
          restaurantsReverted++;
        }
      } catch (error) {
        console.error(`Failed to revert restaurant ${restaurantSnapshot.restaurantId}:`, error);
      }
    }

    // Step 2: Delete branches created during migration
    for (const branchId of snapshot.createdBranchIds) {
      try {
        const branch = await ctx.db
          .query("branches")
          .withIndex("by_branch_id", (q) => q.eq("branchId", branchId))
          .first();

        if (branch) {
          await ctx.db.delete(branch._id);
          branchesDeleted++;
        }
      } catch (error) {
        console.error(`Failed to delete branch ${branchId}:`, error);
      }
    }

    // Step 3: Remove branchId from migrated menu items
    const allMenuItems = await ctx.db.query("menuItems").collect();
    const migratedMenuItemIdSet = new Set(snapshot.migratedMenuItemIds);
    
    for (const item of allMenuItems) {
      if (migratedMenuItemIdSet.has(item._id.toString())) {
        try {
          await ctx.db.patch(item._id, { branchId: undefined });
          menuItemsReverted++;
        } catch (error) {
          console.error(`Failed to revert menu item ${item._id}:`, error);
        }
      }
    }

    // Step 4: Remove branchId from migrated calls
    const allCalls = await ctx.db.query("calls").collect();
    const migratedCallIdSet = new Set(snapshot.migratedCallIds);
    
    for (const call of allCalls) {
      if (migratedCallIdSet.has(call.callId)) {
        try {
          await ctx.db.patch(call._id, { branchId: undefined });
          callsReverted++;
        } catch (error) {
          console.error(`Failed to revert call ${call.callId}:`, error);
        }
      }
    }

    // Step 5: Remove branchId from migrated orders
    const allOrders = await ctx.db.query("orders").collect();
    const migratedOrderIdSet = new Set(snapshot.migratedOrderIds);
    
    for (const order of allOrders) {
      if (migratedOrderIdSet.has(order.orderId)) {
        try {
          await ctx.db.patch(order._id, { branchId: undefined });
          ordersReverted++;
        } catch (error) {
          console.error(`Failed to revert order ${order.orderId}:`, error);
        }
      }
    }

    // Mark snapshot as rolled back
    await ctx.db.patch(snapshot._id, {
      status: "rolled_back",
      rolledBackAt: Date.now(),
      rolledBackBy: args.rolledBackBy,
    });

    const endTime = Date.now();

    return {
      success: true,
      message: "Migration rolled back successfully",
      snapshotId: args.snapshotId,
      restaurantsReverted,
      branchesDeleted,
      menuItemsReverted,
      callsReverted,
      ordersReverted,
      durationMs: endTime - startTime,
    };
  },
});


/**
 * Get all migration snapshots
 * 
 * Returns all migration snapshots with their status.
 */
export const getAllSnapshots = query({
  args: {},
  handler: async (ctx) => {
    const snapshots = await ctx.db.query("migrationSnapshots").collect();
    const now = Date.now();

    return snapshots.map((s) => ({
      snapshotId: s.snapshotId,
      migrationType: s.migrationType,
      status: s.status,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      isExpired: now > s.expiresAt,
      daysRemaining: s.status === "active" 
        ? Math.max(0, Math.ceil((s.expiresAt - now) / (24 * 60 * 60 * 1000)))
        : 0,
      restaurantCount: s.restaurantSnapshots.length,
      branchCount: s.createdBranchIds.length,
      menuItemCount: s.migratedMenuItemIds.length,
      callCount: s.migratedCallIds.length,
      orderCount: s.migratedOrderIds.length,
      rolledBackAt: s.rolledBackAt,
      rolledBackBy: s.rolledBackBy,
    }));
  },
});

/**
 * Expire old snapshots
 * 
 * Marks snapshots past their 30-day window as expired.
 * Should be run periodically (e.g., daily cron job).
 */
export const expireOldSnapshots = mutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const activeSnapshots = await ctx.db
      .query("migrationSnapshots")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();

    let expiredCount = 0;

    for (const snapshot of activeSnapshots) {
      if (now > snapshot.expiresAt) {
        await ctx.db.patch(snapshot._id, { status: "expired" });
        expiredCount++;
      }
    }

    return {
      success: true,
      message: `Expired ${expiredCount} snapshots`,
      expiredCount,
    };
  },
});

/**
 * Get rollback status
 * 
 * Returns the current rollback status including:
 * - Whether rollback is available
 * - Active snapshots
 * - Days remaining in rollback window
 */
export const getRollbackStatus = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const allSnapshots = await ctx.db.query("migrationSnapshots").collect();

    const activeSnapshots = allSnapshots.filter(
      (s) => s.status === "active" && now < s.expiresAt
    );
    const rolledBackSnapshots = allSnapshots.filter(
      (s) => s.status === "rolled_back"
    );
    const expiredSnapshots = allSnapshots.filter(
      (s) => s.status === "expired" || (s.status === "active" && now >= s.expiresAt)
    );

    // Find the most recent active snapshot
    const latestActive = activeSnapshots.length > 0
      ? activeSnapshots.sort((a, b) => b.createdAt - a.createdAt)[0]
      : null;

    return {
      rollbackAvailable: activeSnapshots.length > 0,
      activeSnapshotCount: activeSnapshots.length,
      rolledBackSnapshotCount: rolledBackSnapshots.length,
      expiredSnapshotCount: expiredSnapshots.length,
      latestSnapshot: latestActive
        ? {
            snapshotId: latestActive.snapshotId,
            migrationType: latestActive.migrationType,
            createdAt: latestActive.createdAt,
            expiresAt: latestActive.expiresAt,
            daysRemaining: Math.ceil((latestActive.expiresAt - now) / (24 * 60 * 60 * 1000)),
          }
        : null,
    };
  },
});
