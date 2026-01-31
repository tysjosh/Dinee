import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Create menu items for a restaurant
export const createMenuItems = mutation({
  args: {
    restaurantId: v.string(),
    menuItems: v.array(v.object({
      name: v.string(),
      price: v.string(),
      description: v.optional(v.string()),
      modifiers: v.optional(v.array(v.string())),
    })),
  },
  handler: async (ctx, args) => {
    const { restaurantId, menuItems } = args;

    // Delete existing menu items for this restaurant
    const existingItems = await ctx.db
      .query("menuItems")
      .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", restaurantId))
      .collect();

    for (const item of existingItems) {
      await ctx.db.delete(item._id);
    }

    // Insert new menu items
    const insertedItems = [];
    for (const item of menuItems) {
      const insertedItem = await ctx.db.insert("menuItems", {
        restaurantId,
        name: item.name,
        price: item.price,
        description: item.description,
        modifiers: item.modifiers,
      });
      insertedItems.push(insertedItem);
    }

    return insertedItems;
  },
});

// Get menu items for a restaurant
export const getMenuItems = query({
  args: { restaurantId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("menuItems")
      .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.restaurantId))
      .collect();
  },
});

// Update a menu item
export const updateMenuItem = mutation({
  args: {
    id: v.id("menuItems"),
    name: v.optional(v.string()),
    price: v.optional(v.string()),
    description: v.optional(v.string()),
    modifiers: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    return await ctx.db.patch(id, updates);
  },
});

// Delete a menu item
export const deleteMenuItem = mutation({
  args: { id: v.id("menuItems") },
  handler: async (ctx, args) => {
    return await ctx.db.delete(args.id);
  },
});
