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
    platformId: v.optional(v.string()),
    agentName: v.string(),
    specialInstructions: v.string(),
    languagePreference: v.union(
      v.literal("english"),
      v.literal("spanish"),
      v.literal("french"),
      v.literal("pidgin")
    ),
    locale: v.optional(v.string()),
    fallbackChannel: v.optional(
      v.union(v.literal("whatsapp"), v.literal("sms"), v.literal("none"))
    ),
    menuDetails: v.optional(v.array(v.object({
      name: v.string(),
      price: v.string(),
      description: v.optional(v.string()),
    }))),
    virtualNumber: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.platformId) {
      const platform = await ctx.db
        .query("platforms")
        .withIndex("by_platform_id", (q) => q.eq("platformId", args.platformId))
        .first();

      if (!platform) {
        throw new Error("Platform not found");
      }
    }

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
      locale: args.locale,
      fallbackChannel: args.fallbackChannel,
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

export const listRestaurantsByPlatform = query({
  args: { platformId: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("restaurants")
      .withIndex("by_platform_id", (q) => q.eq("platformId", args.platformId))
      .collect();
  },
});

export const updateRestaurant = mutation({
  args: {
    restaurantId: v.string(),
    platformId: v.optional(v.string()),
    name: v.optional(v.string()),
    agentName: v.optional(v.string()),
    specialInstructions: v.optional(v.string()),
    languagePreference: v.optional(v.union(
      v.literal("english"),
      v.literal("spanish"),
      v.literal("french"),
      v.literal("pidgin")
    )),
    locale: v.optional(v.string()),
    fallbackChannel: v.optional(
      v.union(v.literal("whatsapp"), v.literal("sms"), v.literal("none"))
    ),
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

    if (args.platformId) {
      const platform = await ctx.db
        .query("platforms")
        .withIndex("by_platform_id", (q) => q.eq("platformId", args.platformId))
        .first();

      if (!platform) {
        throw new Error("Platform not found");
      }
    }

    // Only update fields that are provided
    const updates: any = {};
    if (args.platformId !== undefined) updates.platformId = args.platformId;
    if (args.name !== undefined) updates.name = args.name;
    if (args.agentName !== undefined) updates.agentName = args.agentName;
    if (args.specialInstructions !== undefined) updates.specialInstructions = args.specialInstructions;
    if (args.languagePreference !== undefined) updates.languagePreference = args.languagePreference;
    if (args.locale !== undefined) updates.locale = args.locale;
    if (args.fallbackChannel !== undefined) updates.fallbackChannel = args.fallbackChannel;
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

      const branches = await ctx.db
        .query("branches")
        .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.restaurantId))
        .collect();

      for (const branch of branches) {
        await ctx.db.delete(branch._id);
      }

      return true;
    } catch (error) {
      console.log("Error in `deleteRestaurantData`", (error as Error).message);
      return false;
    }
  },
});



export const deleteAllData = mutation({
  handler: async (ctx) => {
    try {
      const allRestaurants = await ctx.db.query("restaurants").collect();
      for (const restaurant of allRestaurants) {
        await ctx.db.delete(restaurant._id);
      }

      const allMenuItems = await ctx.db.query("menuItems").collect();
      for (const item of allMenuItems) {
        await ctx.db.delete(item._id);
      }

      const allBranches = await ctx.db.query("branches").collect();
      for (const branch of allBranches) {
        await ctx.db.delete(branch._id);
      }

      const allPlatforms = await ctx.db.query("platforms").collect();
      for (const platform of allPlatforms) {
        await ctx.db.delete(platform._id);
      }

      return true;
    } catch (error) {
      console.log("Error in `deleteAllData`", (error as Error).message);
      return false;
    }
  },
});
