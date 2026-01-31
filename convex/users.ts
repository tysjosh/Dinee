import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { assertBranchPlatform, assertRestaurantPlatform } from "./tenancy";

function generateUserId(): string {
  const randomSegment = Math.random().toString(36).slice(2, 10);
  return `user-${randomSegment}`;
}

export const createUser = mutation({
  args: {
    email: v.string(),
    role: v.union(
      v.literal("platform_admin"),
      v.literal("restaurant_owner"),
      v.literal("branch_manager"),
      v.literal("supervisor")
    ),
    platformId: v.optional(v.string()),
    restaurantId: v.optional(v.string()),
    branchId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let resolvedPlatformId = args.platformId;
    let resolvedRestaurantId = args.restaurantId;
    let resolvedBranchId = args.branchId;

    if (args.branchId && args.platformId) {
      const branch = await assertBranchPlatform(ctx, args.branchId, args.platformId);
      resolvedRestaurantId = branch.restaurantId;
    }

    if (args.restaurantId && args.platformId) {
      await assertRestaurantPlatform(ctx, args.restaurantId, args.platformId);
    }

    if (!resolvedPlatformId && args.restaurantId) {
      const restaurant = await ctx.db
        .query("restaurants")
        .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.restaurantId))
        .first();
      resolvedPlatformId = restaurant?.platformId;
    }

    if (!resolvedPlatformId && args.branchId) {
      const branch = await ctx.db
        .query("branches")
        .withIndex("by_branch_id", (q) => q.eq("branchId", args.branchId))
        .first();
      resolvedPlatformId = branch?.platformId;
      resolvedRestaurantId = branch?.restaurantId;
    }

    if (args.role === "platform_admin" && !resolvedPlatformId) {
      throw new Error("Platform admin must be assigned to a platform");
    }

    if (args.role === "restaurant_owner" && !resolvedRestaurantId) {
      throw new Error("Restaurant owner must be assigned to a restaurant");
    }

    if (args.role === "branch_manager" && !resolvedBranchId) {
      throw new Error("Branch manager must be assigned to a branch");
    }

    let userId: string;
    let existingUser;
    do {
      userId = generateUserId();
      existingUser = await ctx.db
        .query("users")
        .withIndex("by_user_id", (q) => q.eq("userId", userId))
        .first();
    } while (existingUser);

    const docId = await ctx.db.insert("users", {
      userId,
      email: args.email,
      role: args.role,
      platformId: resolvedPlatformId,
      restaurantId: resolvedRestaurantId,
      branchId: resolvedBranchId,
      createdAt: Date.now(),
    });

    return { userId, docId };
  },
});

export const getUser = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("users")
      .withIndex("by_user_id", (q) => q.eq("userId", args.userId))
      .first();
  },
});

export const listUsersByPlatform = query({
  args: { platformId: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("users")
      .withIndex("by_platform_id", (q) => q.eq("platformId", args.platformId))
      .collect();
  },
});

export const updateUserRole = mutation({
  args: {
    userId: v.string(),
    role: v.union(
      v.literal("platform_admin"),
      v.literal("restaurant_owner"),
      v.literal("branch_manager"),
      v.literal("supervisor")
    ),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_user_id", (q) => q.eq("userId", args.userId))
      .first();

    if (!user) {
      throw new Error("User not found");
    }

    await ctx.db.patch(user._id, { role: args.role });
    return user._id;
  },
});
