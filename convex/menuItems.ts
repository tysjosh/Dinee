import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { requireTenantAccessOrInternal } from "./shared/ownership";

// Menu functions serve the dashboard (session) and server routes (partner API,
// which forwards the internal secret). Reads/writes are scoped to the owning
// tenant, or allowed for a trusted server caller carrying INTERNAL_API_KEY.
// Note: the voice runtime reads menus via the secret-guarded
// `internal.getRestaurantAndMenuDetailsUsingId`, not these functions.

// Create menu items for a restaurant (optionally for a specific branch)
export const createMenuItems = mutation({
  args: {
    restaurantId: v.string(),
    branchId: v.optional(v.string()),
    menuItems: v.array(v.object({
      name: v.string(),
      price: v.string(),
      priceNumeric: v.optional(v.number()),
      description: v.optional(v.string()),
      category: v.optional(v.string()),
      modifiers: v.optional(v.array(v.object({
        name: v.string(),
        price: v.number(),
      }))),
      isAvailable: v.optional(v.boolean()),
    })),
    internalSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireTenantAccessOrInternal(ctx, args.restaurantId, args.internalSecret);
    const { restaurantId, branchId, menuItems } = args;

    // Delete existing menu items for this restaurant/branch
    if (branchId) {
      // Delete branch-specific menu items
      const existingItems = await ctx.db
        .query("menuItems")
        .withIndex("by_branch_id", (q) => q.eq("branchId", branchId))
        .collect();

      for (const item of existingItems) {
        await ctx.db.delete(item._id);
      }
    } else {
      // Delete restaurant-level menu items (those without branchId)
      const existingItems = await ctx.db
        .query("menuItems")
        .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", restaurantId))
        .collect();

      for (const item of existingItems) {
        if (!item.branchId) {
          await ctx.db.delete(item._id);
        }
      }
    }

    // Insert new menu items
    const insertedItems = [];
    for (const item of menuItems) {
      const insertedItem = await ctx.db.insert("menuItems", {
        restaurantId,
        branchId,
        name: item.name,
        price: item.price,
        priceNumeric: item.priceNumeric,
        description: item.description,
        category: item.category,
        modifiers: item.modifiers,
        isAvailable: item.isAvailable ?? true,
      });
      insertedItems.push(insertedItem);
    }

    return insertedItems;
  },
});

// Get menu items for a restaurant
export const getMenuItems = query({
  args: { restaurantId: v.string(), internalSecret: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireTenantAccessOrInternal(ctx, args.restaurantId, args.internalSecret);
    return await ctx.db
      .query("menuItems")
      .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.restaurantId))
      .collect();
  },
});
// Get a single menu item by its Convex document ID
// Used by the partner-API authorization layer (server) to resolve
// menuItem → restaurantId, so it accepts the internal secret.
export const getMenuItemById = query({
  args: { id: v.id("menuItems"), internalSecret: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.id);
    await requireTenantAccessOrInternal(
      ctx,
      item?.restaurantId ?? "",
      args.internalSecret
    );
    return item;
  },
});



// Resolve a branchId to its owning restaurantId for tenant checks.
async function branchRestaurantId(
  ctx: QueryCtx,
  branchId: string
): Promise<string> {
  const branch = await ctx.db
    .query("branches")
    .withIndex("by_branch_id", (q) => q.eq("branchId", branchId))
    .first();
  return branch?.restaurantId ?? "";
}

// Get menu items for a specific branch
export const getMenuItemsByBranch = query({
  args: { branchId: v.string(), internalSecret: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireTenantAccessOrInternal(
      ctx,
      await branchRestaurantId(ctx, args.branchId),
      args.internalSecret
    );
    return await ctx.db
      .query("menuItems")
      .withIndex("by_branch_id", (q) => q.eq("branchId", args.branchId))
      .collect();
  },
});

// Get available menu items for a restaurant
export const getAvailableMenuItems = query({
  args: { restaurantId: v.string(), internalSecret: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireTenantAccessOrInternal(ctx, args.restaurantId, args.internalSecret);
    const items = await ctx.db
      .query("menuItems")
      .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.restaurantId))
      .collect();
    
    return items.filter(item => item.isAvailable !== false);
  },
});

// Get available menu items for a specific branch
export const getAvailableMenuItemsByBranch = query({
  args: { branchId: v.string(), internalSecret: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireTenantAccessOrInternal(
      ctx,
      await branchRestaurantId(ctx, args.branchId),
      args.internalSecret
    );
    const items = await ctx.db
      .query("menuItems")
      .withIndex("by_branch_id", (q) => q.eq("branchId", args.branchId))
      .collect();
    
    return items.filter(item => item.isAvailable !== false);
  },
});

// Update a menu item
export const updateMenuItem = mutation({
  args: {
    id: v.id("menuItems"),
    branchId: v.optional(v.string()),
    name: v.optional(v.string()),
    price: v.optional(v.string()),
    priceNumeric: v.optional(v.number()),
    description: v.optional(v.string()),
    category: v.optional(v.string()),
    modifiers: v.optional(v.array(v.object({
      name: v.string(),
      price: v.number(),
    }))),
    isAvailable: v.optional(v.boolean()),
    internalSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, internalSecret, ...updates } = args;
    const existing = await ctx.db.get(id);
    await requireTenantAccessOrInternal(ctx, existing?.restaurantId ?? "", internalSecret);
    return await ctx.db.patch(id, updates);
  },
});

// Delete a menu item
export const deleteMenuItem = mutation({
  args: { id: v.id("menuItems"), internalSecret: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    await requireTenantAccessOrInternal(ctx, existing?.restaurantId ?? "", args.internalSecret);
    return await ctx.db.delete(args.id);
  },
});

// Toggle menu item availability
export const toggleMenuItemAvailability = mutation({
  args: { id: v.id("menuItems"), internalSecret: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.id);
    if (!item) {
      throw new Error("Menu item not found");
    }
    await requireTenantAccessOrInternal(ctx, item.restaurantId, args.internalSecret);
    const newAvailability = item.isAvailable === false ? true : false;
    await ctx.db.patch(args.id, { isAvailable: newAvailability });
    return newAvailability;
  },
});