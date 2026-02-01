/**
 * Migration Mutations
 * 
 * Convex mutations for backward compatibility migration operations.
 * Requirements: 28.1, 28.2
 * 
 * Key features:
 * - Creates a default platform if none exists
 * - Assigns existing restaurants without platformId to the default platform
 * - Creates a default branch for restaurants without branches
 * - All operations are idempotent (can be run multiple times safely)
 */

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Default platform ID constant
 * Used to identify the default platform across the system
 */
const DEFAULT_PLATFORM_ID = "DEFAULT";

/**
 * Default platform configuration
 */
const DEFAULT_PLATFORM_CONFIG = {
  name: "Default Platform",
  settings: {
    defaultLanguage: "english" as const,
    enabledPaymentMethods: ["paystack", "flutterwave", "cod"] as const,
    whatsappEnabled: true,
    smsEnabled: true,
  },
};

/**
 * Default operating hours (9 AM - 9 PM, Monday-Saturday)
 */
function getDefaultOperatingHours() {
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
 * Generate a unique branch ID (10-character alphanumeric)
 */
function generateBranchId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "BR"; // Prefix for branch IDs
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Get or create the default platform
 * 
 * This mutation is idempotent - it will return the existing default platform
 * if one exists, or create a new one if it doesn't.
 * 
 * Requirements: 28.1
 */
export const getOrCreateDefaultPlatform = mutation({
  args: {},
  handler: async (ctx) => {
    // Check if default platform already exists
    const existingPlatform = await ctx.db
      .query("platforms")
      .withIndex("by_platform_id", (q) => q.eq("platformId", DEFAULT_PLATFORM_ID))
      .first();

    if (existingPlatform) {
      return {
        success: true,
        message: "Default platform already exists",
        platformId: existingPlatform.platformId,
        isNew: false,
      };
    }

    // Create the default platform
    const docId = await ctx.db.insert("platforms", {
      platformId: DEFAULT_PLATFORM_ID,
      name: DEFAULT_PLATFORM_CONFIG.name,
      settings: {
        defaultLanguage: DEFAULT_PLATFORM_CONFIG.settings.defaultLanguage,
        enabledPaymentMethods: [...DEFAULT_PLATFORM_CONFIG.settings.enabledPaymentMethods],
        whatsappEnabled: DEFAULT_PLATFORM_CONFIG.settings.whatsappEnabled,
        smsEnabled: DEFAULT_PLATFORM_CONFIG.settings.smsEnabled,
      },
      createdAt: Date.now(),
    });

    return {
      success: true,
      message: "Default platform created successfully",
      platformId: DEFAULT_PLATFORM_ID,
      docId,
      isNew: true,
    };
  },
});

/**
 * Get the default platform
 * 
 * Query to check if the default platform exists.
 */
export const getDefaultPlatform = query({
  args: {},
  handler: async (ctx) => {
    const platform = await ctx.db
      .query("platforms")
      .withIndex("by_platform_id", (q) => q.eq("platformId", DEFAULT_PLATFORM_ID))
      .first();

    return platform;
  },
});

/**
 * Assign restaurants without platformId to the default platform
 * 
 * This mutation is idempotent - it will only update restaurants that
 * don't already have a platformId assigned.
 * 
 * Requirements: 28.1
 */
export const assignRestaurantsToDefaultPlatform = mutation({
  args: {
    platformId: v.optional(v.string()), // Optional: use a specific platform instead of default
  },
  handler: async (ctx, args) => {
    const targetPlatformId = args.platformId || DEFAULT_PLATFORM_ID;

    // Verify the target platform exists
    const platform = await ctx.db
      .query("platforms")
      .withIndex("by_platform_id", (q) => q.eq("platformId", targetPlatformId))
      .first();

    if (!platform) {
      return {
        success: false,
        message: `Platform ${targetPlatformId} not found. Please create the default platform first.`,
        assignedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        assignedRestaurantIds: [],
        skippedRestaurantIds: [],
        failedRestaurantIds: [],
      };
    }

    // Get all restaurants
    const allRestaurants = await ctx.db.query("restaurants").collect();

    const assignedRestaurantIds: string[] = [];
    const skippedRestaurantIds: string[] = [];
    const failedRestaurantIds: string[] = [];

    for (const restaurant of allRestaurants) {
      try {
        // Check if restaurant already has a platformId
        if (restaurant.platformId && restaurant.platformId.trim() !== "") {
          skippedRestaurantIds.push(restaurant.restaurantId);
          continue;
        }

        // Assign the restaurant to the target platform
        await ctx.db.patch(restaurant._id, {
          platformId: targetPlatformId,
        });

        assignedRestaurantIds.push(restaurant.restaurantId);
      } catch (error) {
        console.error(`Failed to assign restaurant ${restaurant.restaurantId}:`, error);
        failedRestaurantIds.push(restaurant.restaurantId);
      }
    }

    return {
      success: failedRestaurantIds.length === 0,
      message: failedRestaurantIds.length === 0
        ? `Successfully processed ${allRestaurants.length} restaurants`
        : `Processed ${allRestaurants.length} restaurants with ${failedRestaurantIds.length} failures`,
      assignedCount: assignedRestaurantIds.length,
      skippedCount: skippedRestaurantIds.length,
      failedCount: failedRestaurantIds.length,
      assignedRestaurantIds,
      skippedRestaurantIds,
      failedRestaurantIds,
    };
  },
});

/**
 * Create default branches for restaurants without branches
 * 
 * This mutation is idempotent - it will only create branches for restaurants
 * that don't already have any branches.
 * 
 * Requirements: 28.2
 */
export const createDefaultBranchesForRestaurants = mutation({
  args: {},
  handler: async (ctx) => {
    // Get all restaurants
    const allRestaurants = await ctx.db.query("restaurants").collect();

    // Get all existing branches
    const allBranches = await ctx.db.query("branches").collect();

    // Create a map of restaurantId to branches
    const branchesByRestaurant = new Map<string, typeof allBranches>();
    for (const branch of allBranches) {
      const existing = branchesByRestaurant.get(branch.restaurantId) || [];
      existing.push(branch);
      branchesByRestaurant.set(branch.restaurantId, existing);
    }

    const createdBranches: Array<{ restaurantId: string; branchId: string }> = [];
    const skippedRestaurantIds: string[] = [];
    const failedRestaurantIds: string[] = [];

    for (const restaurant of allRestaurants) {
      try {
        const existingBranches = branchesByRestaurant.get(restaurant.restaurantId) || [];
        
        // Check if restaurant already has branches
        if (existingBranches.length > 0 || (restaurant.branchCount && restaurant.branchCount > 0)) {
          skippedRestaurantIds.push(restaurant.restaurantId);
          continue;
        }

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

        // Create the default branch
        await ctx.db.insert("branches", {
          branchId,
          restaurantId: restaurant.restaurantId,
          name: `${restaurant.name} - Main Branch`,
          address: "Address to be updated",
          phoneNumber: "Phone to be updated",
          operatingHours: getDefaultOperatingHours(),
          isActive: true,
          createdAt: Date.now(),
        });

        // Update the restaurant's branchCount
        await ctx.db.patch(restaurant._id, {
          branchCount: 1,
        });

        createdBranches.push({ restaurantId: restaurant.restaurantId, branchId });
      } catch (error) {
        console.error(`Failed to create branch for restaurant ${restaurant.restaurantId}:`, error);
        failedRestaurantIds.push(restaurant.restaurantId);
      }
    }

    return {
      success: failedRestaurantIds.length === 0,
      message: failedRestaurantIds.length === 0
        ? `Successfully processed ${allRestaurants.length} restaurants`
        : `Processed ${allRestaurants.length} restaurants with ${failedRestaurantIds.length} failures`,
      createdCount: createdBranches.length,
      skippedCount: skippedRestaurantIds.length,
      failedCount: failedRestaurantIds.length,
      createdBranches,
      skippedRestaurantIds,
      failedRestaurantIds,
    };
  },
});

/**
 * Run the full migration
 * 
 * This mutation runs all migration steps in sequence:
 * 1. Create default platform if it doesn't exist
 * 2. Assign restaurants without platformId to the default platform
 * 3. Create default branches for restaurants without branches
 * 
 * All operations are idempotent and can be run multiple times safely.
 * 
 * Requirements: 28.1, 28.2
 */
export const runFullMigration = mutation({
  args: {},
  handler: async (ctx) => {
    const startTime = Date.now();

    // Step 1: Get or create default platform
    let platformResult: {
      success: boolean;
      message: string;
      platformId?: string;
      isNew: boolean;
    };

    const existingPlatform = await ctx.db
      .query("platforms")
      .withIndex("by_platform_id", (q) => q.eq("platformId", DEFAULT_PLATFORM_ID))
      .first();

    if (existingPlatform) {
      platformResult = {
        success: true,
        message: "Default platform already exists",
        platformId: existingPlatform.platformId,
        isNew: false,
      };
    } else {
      await ctx.db.insert("platforms", {
        platformId: DEFAULT_PLATFORM_ID,
        name: DEFAULT_PLATFORM_CONFIG.name,
        settings: {
          defaultLanguage: DEFAULT_PLATFORM_CONFIG.settings.defaultLanguage,
          enabledPaymentMethods: [...DEFAULT_PLATFORM_CONFIG.settings.enabledPaymentMethods],
          whatsappEnabled: DEFAULT_PLATFORM_CONFIG.settings.whatsappEnabled,
          smsEnabled: DEFAULT_PLATFORM_CONFIG.settings.smsEnabled,
        },
        createdAt: Date.now(),
      });

      platformResult = {
        success: true,
        message: "Default platform created successfully",
        platformId: DEFAULT_PLATFORM_ID,
        isNew: true,
      };
    }

    // Step 2: Assign restaurants to default platform
    const allRestaurants = await ctx.db.query("restaurants").collect();
    const assignedRestaurantIds: string[] = [];
    const skippedRestaurantIds: string[] = [];
    const failedAssignmentIds: string[] = [];

    for (const restaurant of allRestaurants) {
      try {
        if (restaurant.platformId && restaurant.platformId.trim() !== "") {
          skippedRestaurantIds.push(restaurant.restaurantId);
          continue;
        }

        await ctx.db.patch(restaurant._id, {
          platformId: DEFAULT_PLATFORM_ID,
        });

        assignedRestaurantIds.push(restaurant.restaurantId);
      } catch (error) {
        console.error(`Failed to assign restaurant ${restaurant.restaurantId}:`, error);
        failedAssignmentIds.push(restaurant.restaurantId);
      }
    }

    const restaurantAssignmentResult = {
      success: failedAssignmentIds.length === 0,
      message: failedAssignmentIds.length === 0
        ? `Successfully assigned ${assignedRestaurantIds.length} restaurants`
        : `Assigned ${assignedRestaurantIds.length} restaurants with ${failedAssignmentIds.length} failures`,
      assignedCount: assignedRestaurantIds.length,
      skippedCount: skippedRestaurantIds.length,
      failedCount: failedAssignmentIds.length,
      assignedRestaurantIds,
      skippedRestaurantIds,
      failedRestaurantIds: failedAssignmentIds,
    };

    // Step 3: Create default branches
    // Re-fetch restaurants to get updated data
    const updatedRestaurants = await ctx.db.query("restaurants").collect();
    const allBranches = await ctx.db.query("branches").collect();

    const branchesByRestaurant = new Map<string, typeof allBranches>();
    for (const branch of allBranches) {
      const existing = branchesByRestaurant.get(branch.restaurantId) || [];
      existing.push(branch);
      branchesByRestaurant.set(branch.restaurantId, existing);
    }

    const createdBranches: Array<{ restaurantId: string; branchId: string }> = [];
    const skippedBranchRestaurantIds: string[] = [];
    const failedBranchIds: string[] = [];

    for (const restaurant of updatedRestaurants) {
      try {
        const existingBranches = branchesByRestaurant.get(restaurant.restaurantId) || [];
        
        if (existingBranches.length > 0 || (restaurant.branchCount && restaurant.branchCount > 0)) {
          skippedBranchRestaurantIds.push(restaurant.restaurantId);
          continue;
        }

        let branchId: string;
        let existingBranch;

        do {
          branchId = generateBranchId();
          existingBranch = await ctx.db
            .query("branches")
            .withIndex("by_branch_id", (q) => q.eq("branchId", branchId))
            .first();
        } while (existingBranch);

        await ctx.db.insert("branches", {
          branchId,
          restaurantId: restaurant.restaurantId,
          name: `${restaurant.name} - Main Branch`,
          address: "Address to be updated",
          phoneNumber: "Phone to be updated",
          operatingHours: getDefaultOperatingHours(),
          isActive: true,
          createdAt: Date.now(),
        });

        await ctx.db.patch(restaurant._id, {
          branchCount: 1,
        });

        createdBranches.push({ restaurantId: restaurant.restaurantId, branchId });
      } catch (error) {
        console.error(`Failed to create branch for restaurant ${restaurant.restaurantId}:`, error);
        failedBranchIds.push(restaurant.restaurantId);
      }
    }

    const branchCreationResult = {
      success: failedBranchIds.length === 0,
      message: failedBranchIds.length === 0
        ? `Successfully created ${createdBranches.length} branches`
        : `Created ${createdBranches.length} branches with ${failedBranchIds.length} failures`,
      createdCount: createdBranches.length,
      skippedCount: skippedBranchRestaurantIds.length,
      failedCount: failedBranchIds.length,
      createdBranches,
      skippedRestaurantIds: skippedBranchRestaurantIds,
      failedRestaurantIds: failedBranchIds,
    };

    // Calculate overall success
    const overallSuccess = 
      platformResult.success && 
      restaurantAssignmentResult.success && 
      branchCreationResult.success;

    const endTime = Date.now();

    return {
      success: overallSuccess,
      message: overallSuccess
        ? "Migration completed successfully"
        : "Migration completed with some failures",
      platformResult,
      restaurantAssignmentResult,
      branchCreationResult,
      totalRestaurantsProcessed: allRestaurants.length,
      totalBranchesCreated: createdBranches.length,
      durationMs: endTime - startTime,
    };
  },
});

/**
 * Get migration status
 * 
 * Query to check the current state of the migration.
 * Returns information about:
 * - Whether the default platform exists
 * - How many restaurants have platformId assigned
 * - How many restaurants have branches
 */
export const getMigrationStatus = query({
  args: {},
  handler: async (ctx) => {
    // Check default platform
    const defaultPlatform = await ctx.db
      .query("platforms")
      .withIndex("by_platform_id", (q) => q.eq("platformId", DEFAULT_PLATFORM_ID))
      .first();

    // Get all restaurants
    const allRestaurants = await ctx.db.query("restaurants").collect();

    // Count restaurants with/without platformId
    const restaurantsWithPlatform = allRestaurants.filter(
      (r) => r.platformId && r.platformId.trim() !== ""
    );
    const restaurantsWithoutPlatform = allRestaurants.filter(
      (r) => !r.platformId || r.platformId.trim() === ""
    );

    // Get all branches
    const allBranches = await ctx.db.query("branches").collect();

    // Create a set of restaurant IDs that have branches
    const restaurantIdsWithBranches = new Set(allBranches.map((b) => b.restaurantId));

    // Count restaurants with/without branches
    const restaurantsWithBranches = allRestaurants.filter(
      (r) => restaurantIdsWithBranches.has(r.restaurantId) || (r.branchCount && r.branchCount > 0)
    );
    const restaurantsWithoutBranches = allRestaurants.filter(
      (r) => !restaurantIdsWithBranches.has(r.restaurantId) && (!r.branchCount || r.branchCount === 0)
    );

    // Determine migration status
    const needsMigration = 
      !defaultPlatform || 
      restaurantsWithoutPlatform.length > 0 || 
      restaurantsWithoutBranches.length > 0;

    const migrationComplete = 
      defaultPlatform !== null && 
      restaurantsWithoutPlatform.length === 0 && 
      restaurantsWithoutBranches.length === 0;

    return {
      defaultPlatformExists: defaultPlatform !== null,
      defaultPlatformId: defaultPlatform?.platformId || null,
      totalRestaurants: allRestaurants.length,
      restaurantsWithPlatform: restaurantsWithPlatform.length,
      restaurantsWithoutPlatform: restaurantsWithoutPlatform.length,
      restaurantsWithoutPlatformIds: restaurantsWithoutPlatform.map((r) => r.restaurantId),
      totalBranches: allBranches.length,
      restaurantsWithBranches: restaurantsWithBranches.length,
      restaurantsWithoutBranches: restaurantsWithoutBranches.length,
      restaurantsWithoutBranchesIds: restaurantsWithoutBranches.map((r) => r.restaurantId),
      needsMigration,
      migrationComplete,
      status: migrationComplete ? "complete" : needsMigration ? "pending" : "unknown",
    };
  },
});


/**
 * ============================================================================
 * DATA MIGRATION MUTATIONS
 * ============================================================================
 * 
 * These mutations migrate existing data (menu items, calls, orders) to include
 * branchId references, mapping them to the new multi-tenant structure.
 * 
 * Requirements: 28.3, 28.4
 * - 28.3: System shall preserve menu items, calls, orders, transcripts
 * - 28.4: System shall map restaurantId references to new structure
 * 
 * All operations are idempotent (can be run multiple times safely).
 */

/**
 * Helper function to get the default branch for a restaurant
 */
async function getDefaultBranchForRestaurant(
  ctx: { db: { query: (table: string) => { withIndex: (name: string, fn: (q: { eq: (field: string, value: string) => unknown }) => unknown) => { first: () => Promise<{ branchId: string } | null> } } } },
  restaurantId: string
): Promise<string | null> {
  const branch = await ctx.db
    .query("branches")
    .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", restaurantId))
    .first();
  
  return branch?.branchId || null;
}


/**
 * Migrate menu items to include branchId
 * 
 * This mutation assigns branchId to menu items that don't have one,
 * using the default branch for each restaurant.
 * 
 * Requirements: 28.3, 28.4
 */
export const migrateMenuItemsToBranch = mutation({
  args: {},
  handler: async (ctx) => {
    // Get all menu items
    const allMenuItems = await ctx.db.query("menuItems").collect();
    
    // Get all branches grouped by restaurant
    const allBranches = await ctx.db.query("branches").collect();
    const branchesByRestaurant = new Map<string, string>();
    
    for (const branch of allBranches) {
      // Use the first branch found for each restaurant as the default
      if (!branchesByRestaurant.has(branch.restaurantId)) {
        branchesByRestaurant.set(branch.restaurantId, branch.branchId);
      }
    }

    const migratedItemIds: string[] = [];
    const skippedItemIds: string[] = [];
    const failedItemIds: string[] = [];

    for (const item of allMenuItems) {
      try {
        // Skip if already has a branchId
        if (item.branchId && item.branchId.trim() !== "") {
          skippedItemIds.push(item._id.toString());
          continue;
        }

        // Get the default branch for this restaurant
        const defaultBranchId = branchesByRestaurant.get(item.restaurantId);
        
        if (!defaultBranchId) {
          // No branch exists for this restaurant - skip but log
          console.warn(`No branch found for restaurant ${item.restaurantId}, skipping menu item`);
          skippedItemIds.push(item._id.toString());
          continue;
        }

        // Update the menu item with the branchId
        await ctx.db.patch(item._id, {
          branchId: defaultBranchId,
        });

        migratedItemIds.push(item._id.toString());
      } catch (error) {
        console.error(`Failed to migrate menu item ${item._id}:`, error);
        failedItemIds.push(item._id.toString());
      }
    }

    return {
      success: failedItemIds.length === 0,
      message: failedItemIds.length === 0
        ? `Successfully migrated ${migratedItemIds.length} menu items`
        : `Migrated ${migratedItemIds.length} menu items with ${failedItemIds.length} failures`,
      migratedCount: migratedItemIds.length,
      skippedCount: skippedItemIds.length,
      failedCount: failedItemIds.length,
      migratedItemIds,
      skippedItemIds,
      failedItemIds,
    };
  },
});


/**
 * Migrate calls to include branchId
 * 
 * This mutation assigns branchId to calls that don't have one,
 * using the default branch for each restaurant.
 * 
 * Requirements: 28.3, 28.4
 */
export const migrateCallsToBranch = mutation({
  args: {},
  handler: async (ctx) => {
    // Get all calls
    const allCalls = await ctx.db.query("calls").collect();
    
    // Get all branches grouped by restaurant
    const allBranches = await ctx.db.query("branches").collect();
    const branchesByRestaurant = new Map<string, string>();
    
    for (const branch of allBranches) {
      if (!branchesByRestaurant.has(branch.restaurantId)) {
        branchesByRestaurant.set(branch.restaurantId, branch.branchId);
      }
    }

    const migratedCallIds: string[] = [];
    const skippedCallIds: string[] = [];
    const failedCallIds: string[] = [];

    for (const call of allCalls) {
      try {
        // Skip if already has a branchId
        if (call.branchId && call.branchId.trim() !== "") {
          skippedCallIds.push(call.callId);
          continue;
        }

        // Skip if no restaurantId (orphaned call)
        if (!call.restaurantId) {
          skippedCallIds.push(call.callId);
          continue;
        }

        // Get the default branch for this restaurant
        const defaultBranchId = branchesByRestaurant.get(call.restaurantId);
        
        if (!defaultBranchId) {
          console.warn(`No branch found for restaurant ${call.restaurantId}, skipping call`);
          skippedCallIds.push(call.callId);
          continue;
        }

        // Update the call with the branchId
        await ctx.db.patch(call._id, {
          branchId: defaultBranchId,
        });

        migratedCallIds.push(call.callId);
      } catch (error) {
        console.error(`Failed to migrate call ${call.callId}:`, error);
        failedCallIds.push(call.callId);
      }
    }

    return {
      success: failedCallIds.length === 0,
      message: failedCallIds.length === 0
        ? `Successfully migrated ${migratedCallIds.length} calls`
        : `Migrated ${migratedCallIds.length} calls with ${failedCallIds.length} failures`,
      migratedCount: migratedCallIds.length,
      skippedCount: skippedCallIds.length,
      failedCount: failedCallIds.length,
      migratedCallIds,
      skippedCallIds,
      failedCallIds,
    };
  },
});


/**
 * Migrate orders to include branchId
 * 
 * This mutation assigns branchId to orders that don't have one,
 * using the default branch for each restaurant.
 * 
 * Requirements: 28.3, 28.4
 */
export const migrateOrdersToBranch = mutation({
  args: {},
  handler: async (ctx) => {
    // Get all orders
    const allOrders = await ctx.db.query("orders").collect();
    
    // Get all branches grouped by restaurant
    const allBranches = await ctx.db.query("branches").collect();
    const branchesByRestaurant = new Map<string, string>();
    
    for (const branch of allBranches) {
      if (!branchesByRestaurant.has(branch.restaurantId)) {
        branchesByRestaurant.set(branch.restaurantId, branch.branchId);
      }
    }

    const migratedOrderIds: string[] = [];
    const skippedOrderIds: string[] = [];
    const failedOrderIds: string[] = [];

    for (const order of allOrders) {
      try {
        // Skip if already has a branchId
        if (order.branchId && order.branchId.trim() !== "") {
          skippedOrderIds.push(order.orderId);
          continue;
        }

        // Get the default branch for this restaurant
        const defaultBranchId = branchesByRestaurant.get(order.restaurantId);
        
        if (!defaultBranchId) {
          console.warn(`No branch found for restaurant ${order.restaurantId}, skipping order`);
          skippedOrderIds.push(order.orderId);
          continue;
        }

        // Update the order with the branchId
        await ctx.db.patch(order._id, {
          branchId: defaultBranchId,
        });

        migratedOrderIds.push(order.orderId);
      } catch (error) {
        console.error(`Failed to migrate order ${order.orderId}:`, error);
        failedOrderIds.push(order.orderId);
      }
    }

    return {
      success: failedOrderIds.length === 0,
      message: failedOrderIds.length === 0
        ? `Successfully migrated ${migratedOrderIds.length} orders`
        : `Migrated ${migratedOrderIds.length} orders with ${failedOrderIds.length} failures`,
      migratedCount: migratedOrderIds.length,
      skippedCount: skippedOrderIds.length,
      failedCount: failedOrderIds.length,
      migratedOrderIds,
      skippedOrderIds,
      failedOrderIds,
    };
  },
});


/**
 * Run full data migration
 * 
 * This mutation runs all data migration steps in sequence:
 * 1. Migrate menu items to include branchId
 * 2. Migrate calls to include branchId
 * 3. Migrate orders to include branchId
 * 
 * Note: Transcripts are linked via callId, so they don't need direct migration.
 * They are preserved through the call relationship.
 * 
 * All operations are idempotent and can be run multiple times safely.
 * 
 * Requirements: 28.3, 28.4
 */
export const runFullDataMigration = mutation({
  args: {},
  handler: async (ctx) => {
    const startTime = Date.now();

    // Get all branches grouped by restaurant (shared lookup)
    const allBranches = await ctx.db.query("branches").collect();
    const branchesByRestaurant = new Map<string, string>();
    
    for (const branch of allBranches) {
      if (!branchesByRestaurant.has(branch.restaurantId)) {
        branchesByRestaurant.set(branch.restaurantId, branch.branchId);
      }
    }

    // Step 1: Migrate menu items
    const allMenuItems = await ctx.db.query("menuItems").collect();
    const migratedMenuItemIds: string[] = [];
    const skippedMenuItemIds: string[] = [];
    const failedMenuItemIds: string[] = [];

    for (const item of allMenuItems) {
      try {
        if (item.branchId && item.branchId.trim() !== "") {
          skippedMenuItemIds.push(item._id.toString());
          continue;
        }

        const defaultBranchId = branchesByRestaurant.get(item.restaurantId);
        if (!defaultBranchId) {
          skippedMenuItemIds.push(item._id.toString());
          continue;
        }

        await ctx.db.patch(item._id, { branchId: defaultBranchId });
        migratedMenuItemIds.push(item._id.toString());
      } catch (error) {
        console.error(`Failed to migrate menu item:`, error);
        failedMenuItemIds.push(item._id.toString());
      }
    }

    const menuItemsResult = {
      success: failedMenuItemIds.length === 0,
      message: `Migrated ${migratedMenuItemIds.length} menu items`,
      migratedCount: migratedMenuItemIds.length,
      skippedCount: skippedMenuItemIds.length,
      failedCount: failedMenuItemIds.length,
      migratedItemIds: migratedMenuItemIds,
      skippedItemIds: skippedMenuItemIds,
      failedItemIds: failedMenuItemIds,
    };


    // Step 2: Migrate calls
    const allCalls = await ctx.db.query("calls").collect();
    const migratedCallIds: string[] = [];
    const skippedCallIds: string[] = [];
    const failedCallIds: string[] = [];

    for (const call of allCalls) {
      try {
        if (call.branchId && call.branchId.trim() !== "") {
          skippedCallIds.push(call.callId);
          continue;
        }

        if (!call.restaurantId) {
          skippedCallIds.push(call.callId);
          continue;
        }

        const defaultBranchId = branchesByRestaurant.get(call.restaurantId);
        if (!defaultBranchId) {
          skippedCallIds.push(call.callId);
          continue;
        }

        await ctx.db.patch(call._id, { branchId: defaultBranchId });
        migratedCallIds.push(call.callId);
      } catch (error) {
        console.error(`Failed to migrate call:`, error);
        failedCallIds.push(call.callId);
      }
    }

    const callsResult = {
      success: failedCallIds.length === 0,
      message: `Migrated ${migratedCallIds.length} calls`,
      migratedCount: migratedCallIds.length,
      skippedCount: skippedCallIds.length,
      failedCount: failedCallIds.length,
      migratedCallIds,
      skippedCallIds,
      failedCallIds,
    };


    // Step 3: Migrate orders
    const allOrders = await ctx.db.query("orders").collect();
    const migratedOrderIds: string[] = [];
    const skippedOrderIds: string[] = [];
    const failedOrderIds: string[] = [];

    for (const order of allOrders) {
      try {
        if (order.branchId && order.branchId.trim() !== "") {
          skippedOrderIds.push(order.orderId);
          continue;
        }

        const defaultBranchId = branchesByRestaurant.get(order.restaurantId);
        if (!defaultBranchId) {
          skippedOrderIds.push(order.orderId);
          continue;
        }

        await ctx.db.patch(order._id, { branchId: defaultBranchId });
        migratedOrderIds.push(order.orderId);
      } catch (error) {
        console.error(`Failed to migrate order:`, error);
        failedOrderIds.push(order.orderId);
      }
    }

    const ordersResult = {
      success: failedOrderIds.length === 0,
      message: `Migrated ${migratedOrderIds.length} orders`,
      migratedCount: migratedOrderIds.length,
      skippedCount: skippedOrderIds.length,
      failedCount: failedOrderIds.length,
      migratedOrderIds,
      skippedOrderIds,
      failedOrderIds,
    };

    // Calculate overall success
    const overallSuccess = 
      menuItemsResult.success && 
      callsResult.success && 
      ordersResult.success;

    const endTime = Date.now();

    return {
      success: overallSuccess,
      message: overallSuccess
        ? "Data migration completed successfully"
        : "Data migration completed with some failures",
      menuItemsResult,
      callsResult,
      ordersResult,
      totalItemsMigrated: migratedMenuItemIds.length,
      totalCallsMigrated: migratedCallIds.length,
      totalOrdersMigrated: migratedOrderIds.length,
      durationMs: endTime - startTime,
    };
  },
});


/**
 * Get data migration status
 * 
 * Query to check the current state of data migration.
 * Returns information about:
 * - How many menu items have branchId assigned
 * - How many calls have branchId assigned
 * - How many orders have branchId assigned
 * 
 * Requirements: 28.3, 28.4
 */
export const getDataMigrationStatus = query({
  args: {},
  handler: async (ctx) => {
    // Get all menu items
    const allMenuItems = await ctx.db.query("menuItems").collect();
    const menuItemsWithBranch = allMenuItems.filter(
      (item) => item.branchId && item.branchId.trim() !== ""
    );
    const menuItemsWithoutBranch = allMenuItems.filter(
      (item) => !item.branchId || item.branchId.trim() === ""
    );

    // Get all calls
    const allCalls = await ctx.db.query("calls").collect();
    const callsWithBranch = allCalls.filter(
      (call) => call.branchId && call.branchId.trim() !== ""
    );
    const callsWithoutBranch = allCalls.filter(
      (call) => !call.branchId || call.branchId.trim() === ""
    );

    // Get all orders
    const allOrders = await ctx.db.query("orders").collect();
    const ordersWithBranch = allOrders.filter(
      (order) => order.branchId && order.branchId.trim() !== ""
    );
    const ordersWithoutBranch = allOrders.filter(
      (order) => !order.branchId || order.branchId.trim() === ""
    );

    // Get transcript count (preserved via call relationship)
    const allTranscripts = await ctx.db.query("transcripts").collect();

    // Determine migration status
    const needsMigration = 
      menuItemsWithoutBranch.length > 0 || 
      callsWithoutBranch.length > 0 || 
      ordersWithoutBranch.length > 0;

    const migrationComplete = 
      menuItemsWithoutBranch.length === 0 && 
      callsWithoutBranch.length === 0 && 
      ordersWithoutBranch.length === 0;

    return {
      // Menu items
      totalMenuItems: allMenuItems.length,
      menuItemsWithBranch: menuItemsWithBranch.length,
      menuItemsWithoutBranch: menuItemsWithoutBranch.length,
      // Calls
      totalCalls: allCalls.length,
      callsWithBranch: callsWithBranch.length,
      callsWithoutBranch: callsWithoutBranch.length,
      // Orders
      totalOrders: allOrders.length,
      ordersWithBranch: ordersWithBranch.length,
      ordersWithoutBranch: ordersWithoutBranch.length,
      // Transcripts (preserved via call relationship)
      totalTranscripts: allTranscripts.length,
      // Status
      needsMigration,
      migrationComplete,
      status: migrationComplete ? "complete" : needsMigration ? "pending" : "unknown",
    };
  },
});


/**
 * Run complete migration (structure + data)
 * 
 * This mutation runs all migration steps in sequence:
 * 1. Create default platform if it doesn't exist
 * 2. Assign restaurants without platformId to the default platform
 * 3. Create default branches for restaurants without branches
 * 4. Migrate menu items to include branchId
 * 5. Migrate calls to include branchId
 * 6. Migrate orders to include branchId
 * 
 * All operations are idempotent and can be run multiple times safely.
 * Transcripts are preserved through their relationship with calls.
 * 
 * Requirements: 28.1, 28.2, 28.3, 28.4
 */
export const runCompleteMigration = mutation({
  args: {},
  handler: async (ctx) => {
    const startTime = Date.now();

    // ========================================
    // PHASE 1: Structure Migration
    // ========================================

    // Step 1: Get or create default platform
    let platformResult: {
      success: boolean;
      message: string;
      platformId?: string;
      isNew: boolean;
    };

    const existingPlatform = await ctx.db
      .query("platforms")
      .withIndex("by_platform_id", (q) => q.eq("platformId", DEFAULT_PLATFORM_ID))
      .first();

    if (existingPlatform) {
      platformResult = {
        success: true,
        message: "Default platform already exists",
        platformId: existingPlatform.platformId,
        isNew: false,
      };
    } else {
      await ctx.db.insert("platforms", {
        platformId: DEFAULT_PLATFORM_ID,
        name: DEFAULT_PLATFORM_CONFIG.name,
        settings: {
          defaultLanguage: DEFAULT_PLATFORM_CONFIG.settings.defaultLanguage,
          enabledPaymentMethods: [...DEFAULT_PLATFORM_CONFIG.settings.enabledPaymentMethods],
          whatsappEnabled: DEFAULT_PLATFORM_CONFIG.settings.whatsappEnabled,
          smsEnabled: DEFAULT_PLATFORM_CONFIG.settings.smsEnabled,
        },
        createdAt: Date.now(),
      });

      platformResult = {
        success: true,
        message: "Default platform created successfully",
        platformId: DEFAULT_PLATFORM_ID,
        isNew: true,
      };
    }


    // Step 2: Assign restaurants to default platform
    const allRestaurants = await ctx.db.query("restaurants").collect();
    const assignedRestaurantIds: string[] = [];
    const skippedRestaurantIds: string[] = [];
    const failedAssignmentIds: string[] = [];

    for (const restaurant of allRestaurants) {
      try {
        if (restaurant.platformId && restaurant.platformId.trim() !== "") {
          skippedRestaurantIds.push(restaurant.restaurantId);
          continue;
        }

        await ctx.db.patch(restaurant._id, {
          platformId: DEFAULT_PLATFORM_ID,
        });

        assignedRestaurantIds.push(restaurant.restaurantId);
      } catch (error) {
        console.error(`Failed to assign restaurant ${restaurant.restaurantId}:`, error);
        failedAssignmentIds.push(restaurant.restaurantId);
      }
    }

    // Step 3: Create default branches
    const updatedRestaurants = await ctx.db.query("restaurants").collect();
    const allBranches = await ctx.db.query("branches").collect();

    const branchesByRestaurant = new Map<string, typeof allBranches>();
    for (const branch of allBranches) {
      const existing = branchesByRestaurant.get(branch.restaurantId) || [];
      existing.push(branch);
      branchesByRestaurant.set(branch.restaurantId, existing);
    }

    const createdBranches: Array<{ restaurantId: string; branchId: string }> = [];
    const skippedBranchRestaurantIds: string[] = [];
    const failedBranchIds: string[] = [];

    for (const restaurant of updatedRestaurants) {
      try {
        const existingBranches = branchesByRestaurant.get(restaurant.restaurantId) || [];
        
        if (existingBranches.length > 0 || (restaurant.branchCount && restaurant.branchCount > 0)) {
          skippedBranchRestaurantIds.push(restaurant.restaurantId);
          continue;
        }

        let branchId: string;
        let existingBranch;

        do {
          branchId = generateBranchId();
          existingBranch = await ctx.db
            .query("branches")
            .withIndex("by_branch_id", (q) => q.eq("branchId", branchId))
            .first();
        } while (existingBranch);

        await ctx.db.insert("branches", {
          branchId,
          restaurantId: restaurant.restaurantId,
          name: `${restaurant.name} - Main Branch`,
          address: "Address to be updated",
          phoneNumber: "Phone to be updated",
          operatingHours: getDefaultOperatingHours(),
          isActive: true,
          createdAt: Date.now(),
        });

        await ctx.db.patch(restaurant._id, {
          branchCount: 1,
        });

        createdBranches.push({ restaurantId: restaurant.restaurantId, branchId });
        
        // Update the map for data migration phase
        branchesByRestaurant.set(restaurant.restaurantId, [{ 
          branchId, 
          restaurantId: restaurant.restaurantId 
        } as typeof allBranches[0]]);
      } catch (error) {
        console.error(`Failed to create branch for restaurant ${restaurant.restaurantId}:`, error);
        failedBranchIds.push(restaurant.restaurantId);
      }
    }


    // ========================================
    // PHASE 2: Data Migration
    // ========================================

    // Refresh branches map after creation
    const refreshedBranches = await ctx.db.query("branches").collect();
    const branchIdByRestaurant = new Map<string, string>();
    for (const branch of refreshedBranches) {
      if (!branchIdByRestaurant.has(branch.restaurantId)) {
        branchIdByRestaurant.set(branch.restaurantId, branch.branchId);
      }
    }

    // Step 4: Migrate menu items
    const allMenuItems = await ctx.db.query("menuItems").collect();
    const migratedMenuItemIds: string[] = [];
    const skippedMenuItemIds: string[] = [];
    const failedMenuItemIds: string[] = [];

    for (const item of allMenuItems) {
      try {
        if (item.branchId && item.branchId.trim() !== "") {
          skippedMenuItemIds.push(item._id.toString());
          continue;
        }

        const defaultBranchId = branchIdByRestaurant.get(item.restaurantId);
        if (!defaultBranchId) {
          skippedMenuItemIds.push(item._id.toString());
          continue;
        }

        await ctx.db.patch(item._id, { branchId: defaultBranchId });
        migratedMenuItemIds.push(item._id.toString());
      } catch (error) {
        console.error(`Failed to migrate menu item:`, error);
        failedMenuItemIds.push(item._id.toString());
      }
    }

    // Step 5: Migrate calls
    const allCalls = await ctx.db.query("calls").collect();
    const migratedCallIds: string[] = [];
    const skippedCallIds: string[] = [];
    const failedCallIds: string[] = [];

    for (const call of allCalls) {
      try {
        if (call.branchId && call.branchId.trim() !== "") {
          skippedCallIds.push(call.callId);
          continue;
        }

        if (!call.restaurantId) {
          skippedCallIds.push(call.callId);
          continue;
        }

        const defaultBranchId = branchIdByRestaurant.get(call.restaurantId);
        if (!defaultBranchId) {
          skippedCallIds.push(call.callId);
          continue;
        }

        await ctx.db.patch(call._id, { branchId: defaultBranchId });
        migratedCallIds.push(call.callId);
      } catch (error) {
        console.error(`Failed to migrate call:`, error);
        failedCallIds.push(call.callId);
      }
    }

    // Step 6: Migrate orders
    const allOrders = await ctx.db.query("orders").collect();
    const migratedOrderIds: string[] = [];
    const skippedOrderIds: string[] = [];
    const failedOrderIds: string[] = [];

    for (const order of allOrders) {
      try {
        if (order.branchId && order.branchId.trim() !== "") {
          skippedOrderIds.push(order.orderId);
          continue;
        }

        const defaultBranchId = branchIdByRestaurant.get(order.restaurantId);
        if (!defaultBranchId) {
          skippedOrderIds.push(order.orderId);
          continue;
        }

        await ctx.db.patch(order._id, { branchId: defaultBranchId });
        migratedOrderIds.push(order.orderId);
      } catch (error) {
        console.error(`Failed to migrate order:`, error);
        failedOrderIds.push(order.orderId);
      }
    }


    // ========================================
    // RESULTS
    // ========================================

    const endTime = Date.now();

    // Calculate overall success
    const structureSuccess = 
      platformResult.success && 
      failedAssignmentIds.length === 0 && 
      failedBranchIds.length === 0;

    const dataSuccess = 
      failedMenuItemIds.length === 0 && 
      failedCallIds.length === 0 && 
      failedOrderIds.length === 0;

    const overallSuccess = structureSuccess && dataSuccess;

    return {
      success: overallSuccess,
      message: overallSuccess
        ? "Complete migration finished successfully"
        : "Complete migration finished with some failures",
      // Structure migration results
      structureMigration: {
        platformResult,
        restaurantAssignment: {
          assignedCount: assignedRestaurantIds.length,
          skippedCount: skippedRestaurantIds.length,
          failedCount: failedAssignmentIds.length,
        },
        branchCreation: {
          createdCount: createdBranches.length,
          skippedCount: skippedBranchRestaurantIds.length,
          failedCount: failedBranchIds.length,
        },
      },
      // Data migration results
      dataMigration: {
        menuItems: {
          migratedCount: migratedMenuItemIds.length,
          skippedCount: skippedMenuItemIds.length,
          failedCount: failedMenuItemIds.length,
        },
        calls: {
          migratedCount: migratedCallIds.length,
          skippedCount: skippedCallIds.length,
          failedCount: failedCallIds.length,
        },
        orders: {
          migratedCount: migratedOrderIds.length,
          skippedCount: skippedOrderIds.length,
          failedCount: failedOrderIds.length,
        },
      },
      // Totals
      totals: {
        restaurantsProcessed: allRestaurants.length,
        branchesCreated: createdBranches.length,
        menuItemsMigrated: migratedMenuItemIds.length,
        callsMigrated: migratedCallIds.length,
        ordersMigrated: migratedOrderIds.length,
      },
      durationMs: endTime - startTime,
    };
  },
});