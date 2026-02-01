import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

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
      v.literal("spanish"),
      v.literal("french")
    ),
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
      name: args.name,
      agentName: args.agentName,
      specialInstructions: args.specialInstructions,
      languagePreference: args.languagePreference,
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

export const updateRestaurant = mutation({
  args: {
    restaurantId: v.string(),
    name: v.optional(v.string()),
    agentName: v.optional(v.string()),
    specialInstructions: v.optional(v.string()),
    languagePreference: v.optional(v.union(
      v.literal("english"),
      v.literal("spanish"),
      v.literal("french")
    )),
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
      languagePreference?: "english" | "spanish" | "french";
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


