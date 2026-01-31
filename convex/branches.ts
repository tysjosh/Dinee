import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { assertRestaurantPlatform } from "./tenancy";

function generateBranchId(restaurantId: string): string {
  const randomSegment = Math.random().toString(36).slice(2, 8);
  return `branch-${restaurantId}-${randomSegment}`;
}

export const createBranch = mutation({
  args: {
    platformId: v.string(),
    restaurantId: v.string(),
    name: v.string(),
    address: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await assertRestaurantPlatform(ctx, args.restaurantId, args.platformId);

    let branchId: string;
    let existingBranch;

    do {
      branchId = generateBranchId(args.restaurantId);
      existingBranch = await ctx.db
        .query("branches")
        .withIndex("by_branch_id", (q) => q.eq("branchId", branchId))
        .first();
    } while (existingBranch);

    const docId = await ctx.db.insert("branches", {
      branchId,
      platformId: args.platformId,
      restaurantId: args.restaurantId,
      name: args.name,
      address: args.address,
      createdAt: Date.now(),
    });

    return { branchId, docId };
  },
});

export const getBranch = query({
  args: { branchId: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("branches")
      .withIndex("by_branch_id", (q) => q.eq("branchId", args.branchId))
      .first();
  },
});

export const listBranchesByRestaurant = query({
  args: { restaurantId: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("branches")
      .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.restaurantId))
      .collect();
  },
});

export const listBranchesByPlatform = query({
  args: { platformId: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("branches")
      .withIndex("by_platform_id", (q) => q.eq("platformId", args.platformId))
      .collect();
  },
});
