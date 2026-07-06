import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { verticalValidator } from "./shared/validators";

// Generate a 5-digit numeric restaurant ID
function generateRestaurantId(): string {
  // Generate a random 5-digit number (10000-99999)
  const min = 10000;
  const max = 99999;
  return Math.floor(Math.random() * (max - min + 1) + min).toString();
}

export const createRestaurant = mutation({
  args: {
    name: v.string(),
    agentName: v.string(),
    specialInstructions: v.string(),
    languagePreference: v.union(
      v.literal("english"),
      v.literal("nigerian_english"),
      v.literal("pidgin"),
      v.literal("spanish"),
      v.literal("french")
    ),
    platformId: v.string(), // Required: foreign key to platforms table
    menuDetails: v.optional(v.array(v.object({
      name: v.string(),
      price: v.string(),
      description: v.optional(v.string()),
    }))),
    virtualNumber: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Generate unique restaurant ID
    let restaurantId: string;
    let existingRestaurant;

    do {
      restaurantId = generateRestaurantId();
      existingRestaurant = await ctx.db
        .query("restaurants")
        .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", restaurantId))
        .first();
    } while (existingRestaurant);

    const docId = await ctx.db.insert("restaurants", {
      restaurantId,
      platformId: args.platformId,
      name: args.name,
      agentName: args.agentName,
      specialInstructions: args.specialInstructions,
      languagePreference: args.languagePreference,
      branchCount: 0, // Initialize with 0 branches
      createdAt: Date.now(),
    });

    return { restaurantId, docId };
  },
});

export const getRestaurant = query({
  args: { restaurantId: v.string() },
  handler: async (ctx, args) => {
    const restaurant = await ctx.db
      .query("restaurants")
      .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.restaurantId))
      .first();

    return restaurant;
  },
});

// Get all restaurants (for admin/seed purposes)
export const getAllRestaurants = query({
  args: {},
  handler: async (ctx) => {
    const restaurants = await ctx.db
      .query("restaurants")
      .order("desc")
      .collect();

    return restaurants;
  },
});

// Get all restaurants for a specific platform
export const getRestaurantsByPlatform = query({
  args: { platformId: v.string() },
  handler: async (ctx, args) => {
    const restaurants = await ctx.db
      .query("restaurants")
      .withIndex("by_platform_id", (q) => q.eq("platformId", args.platformId))
      .collect();

    return restaurants;
  },
});

// Update the branch count for a restaurant
export const updateBranchCount = mutation({
  args: {
    restaurantId: v.string(),
    branchCount: v.number(),
  },
  handler: async (ctx, args) => {
    const restaurant = await ctx.db
      .query("restaurants")
      .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.restaurantId))
      .first();

    if (!restaurant) {
      throw new Error("Restaurant not found");
    }

    await ctx.db.patch(restaurant._id, {
      branchCount: args.branchCount,
    });

    return restaurant._id;
  },
});

export const updateRestaurant = mutation({
  args: {
    restaurantId: v.string(),
    name: v.optional(v.string()),
    agentName: v.optional(v.string()),
    specialInstructions: v.optional(v.string()),
    languagePreference: v.optional(v.union(
      v.literal("english"),
      v.literal("nigerian_english"),
      v.literal("pidgin"),
      v.literal("spanish"),
      v.literal("french")
    )),
    platformId: v.optional(v.string()),
    branchCount: v.optional(v.number()),
    menuDetails: v.optional(v.array(v.object({
      name: v.string(),
      price: v.string(),
      description: v.optional(v.string()),
    }))),
    virtualNumber: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const restaurant = await ctx.db
      .query("restaurants")
      .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.restaurantId))
      .first();

    if (!restaurant) {
      throw new Error("Restaurant not found");
    }

    // Define proper type for restaurant updates
    type RestaurantUpdate = {
      name?: string;
      agentName?: string;
      specialInstructions?: string;
      languagePreference?: "english" | "nigerian_english" | "pidgin" | "spanish" | "french";
      platformId?: string;
      branchCount?: number;
      menuDetails?: Array<{
        name: string;
        price: string;
        description?: string;
      }>;
      virtualNumber?: string;
    };

    // Only update fields that are provided
    const updates: RestaurantUpdate = {};
    if (args.name !== undefined) updates.name = args.name;
    if (args.agentName !== undefined) updates.agentName = args.agentName;
    if (args.specialInstructions !== undefined) updates.specialInstructions = args.specialInstructions;
    if (args.languagePreference !== undefined) updates.languagePreference = args.languagePreference;
    if (args.platformId !== undefined) updates.platformId = args.platformId;
    if (args.branchCount !== undefined) updates.branchCount = args.branchCount;
    if (args.menuDetails !== undefined) updates.menuDetails = args.menuDetails;
    if (args.virtualNumber !== undefined) updates.virtualNumber = args.virtualNumber;

    await ctx.db.patch(restaurant._id, updates);

    return restaurant._id;
  },
});

export const deleteRestaurantData = mutation({
  args: { restaurantId: v.string() },
  handler: async (ctx, args) => {
    try {
      // Delete restaurant
      const restaurant = await ctx.db
        .query("restaurants")
        .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.restaurantId))
        .first();

      if (restaurant) {
        await ctx.db.delete(restaurant._id);
      }

      // Delete all menu items for this restaurant
      const menuItems = await ctx.db
        .query("menuItems")
        .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.restaurantId))
        .collect();

      for (const item of menuItems) {
        await ctx.db.delete(item._id);
      }

      return true;
    } catch (error) {
      console.log("Error in `deleteRestaurantData`", (error as Error).message);
      return false;
    }
  },
});



// Operating hours validator for a single day (shared with branches)
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

// Branch data type for transactional creation
const branchDataValidator = v.object({
  name: v.string(),
  address: v.string(),
  phoneNumber: v.string(),
  operatingHours: v.optional(operatingHoursValidator),
  isActive: v.optional(v.boolean()),
});

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
 * Create a restaurant with branches atomically (transactional)
 * Requirements: 1.4, 3.5
 * 
 * This mutation creates a restaurant and all its branches in a single transaction.
 * If any branch creation fails, the entire operation is rolled back (restaurant and
 * any previously created branches are deleted).
 * 
 * A default branch is always created if no branches are provided.
 */
export const createRestaurantWithBranches = mutation({
  args: {
    name: v.string(),
    agentName: v.string(),
    specialInstructions: v.string(),
    languagePreference: v.union(
      v.literal("english"),
      v.literal("nigerian_english"),
      v.literal("pidgin"),
      v.literal("spanish"),
      v.literal("french")
    ),
    platformId: v.string(),
    branches: v.optional(v.array(branchDataValidator)),
    menuDetails: v.optional(v.array(v.object({
      name: v.string(),
      price: v.string(),
      description: v.optional(v.string()),
    }))),
    virtualNumber: v.optional(v.string()),
    vertical: v.optional(verticalValidator),
    enabledModules: v.optional(v.array(v.string())),
    // Country/region (NG | US); absent defaults to NG in app logic.
    country: v.optional(v.union(v.literal("NG"), v.literal("US"))),
    source_platform: v.optional(v.string()),
    source_tenant: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Track created resources for potential rollback
    let restaurantDocId: Id<"restaurants"> | null = null;
    const createdBranchDocIds: Id<"branches">[] = [];
    
    try {
      // Step 1: Generate unique restaurant ID
      let restaurantId: string;
      let existingRestaurant;

      do {
        restaurantId = generateRestaurantId();
        existingRestaurant = await ctx.db
          .query("restaurants")
          .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", restaurantId))
          .first();
      } while (existingRestaurant);

      // Step 2: Create the restaurant with initial branchCount of 0
      restaurantDocId = await ctx.db.insert("restaurants", {
        restaurantId,
        platformId: args.platformId,
        name: args.name,
        agentName: args.agentName,
        specialInstructions: args.specialInstructions,
        languagePreference: args.languagePreference,
        branchCount: 0, // Will be updated after branches are created
        createdAt: Date.now(),
        ...(args.vertical !== undefined && { vertical: args.vertical }),
        ...(args.enabledModules !== undefined && { enabledModules: args.enabledModules }),
        ...(args.country !== undefined && { country: args.country }),
      });

      // Step 3: Prepare branches to create
      // If no branches provided, create a default branch (Requirement 1.4)
      const branchesToCreate = args.branches && args.branches.length > 0
        ? args.branches
        : [{
            name: `${args.name} - Main Branch`,
            address: "Address to be updated",
            phoneNumber: "Phone to be updated",
            operatingHours: getDefaultOperatingHours(),
            isActive: true,
          }];

      // Step 4: Create all branches
      const createdBranches: { branchId: string; docId: Id<"branches"> }[] = [];
      
      for (const branchData of branchesToCreate) {
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

        const operatingHours = branchData.operatingHours ?? getDefaultOperatingHours();
        const isActive = branchData.isActive ?? true;

        const branchDocId = await ctx.db.insert("branches", {
          branchId,
          restaurantId,
          name: branchData.name,
          address: branchData.address,
          phoneNumber: branchData.phoneNumber,
          operatingHours,
          isActive,
          createdAt: Date.now(),
        });

        createdBranchDocIds.push(branchDocId);
        createdBranches.push({ branchId, docId: branchDocId });
      }

      // Step 5: Update restaurant's branchCount
      await ctx.db.patch(restaurantDocId, {
        branchCount: createdBranches.length,
      });

      // Return success with all created IDs
      return {
        success: true,
        restaurantId,
        restaurantDocId,
        branches: createdBranches,
        branchCount: createdBranches.length,
      };
    } catch (error) {
      // Rollback: Delete any created branches
      for (const branchDocId of createdBranchDocIds) {
        try {
          await ctx.db.delete(branchDocId);
        } catch (deleteError) {
          console.error(`Failed to rollback branch ${branchDocId}:`, deleteError);
        }
      }

      // Rollback: Delete the restaurant if it was created
      if (restaurantDocId) {
        try {
          await ctx.db.delete(restaurantDocId);
        } catch (deleteError) {
          console.error(`Failed to rollback restaurant ${restaurantDocId}:`, deleteError);
        }
      }

      // Re-throw the original error
      throw new Error(`Failed to create restaurant with branches: ${(error as Error).message}`);
    }
  },
});

// DANGEROUS: This mutation deletes ALL data. Only use in development.
// In production, this should be protected by authorization or removed entirely.
export const deleteAllData = mutation({
  args: {
    // Require explicit confirmation to prevent accidental deletion
    confirmDeletion: v.literal("DELETE_ALL_DATA_CONFIRMED"),
  },
  handler: async (ctx, args) => {
    // Additional safety check - only allow in development
    const isDevelopment = process.env.NODE_ENV === "development";
    if (!isDevelopment) {
      throw new Error("deleteAllData is only available in development environment");
    }

    try {
      const allRestaurants = await ctx.db.query("restaurants").collect();
      for (const restaurant of allRestaurants) {
        await ctx.db.delete(restaurant._id);
      }

      const allMenuItems = await ctx.db.query("menuItems").collect();
      for (const item of allMenuItems) {
        await ctx.db.delete(item._id);
      }

      return true;
    } catch (error) {
      throw new Error(`Failed to delete all data: ${(error as Error).message}`);
    }
  },
});


