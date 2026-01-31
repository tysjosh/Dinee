import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { assertPlatformAccess, assertRole, getUserById } from "./auth";

function generatePlatformId(): string {
  const randomSegment = Math.random().toString(36).slice(2, 8);
  return `plat-${randomSegment}`;
}

export const createPlatform = mutation({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    let platformId: string;
    let existingPlatform;

    do {
      platformId = generatePlatformId();
      existingPlatform = await ctx.db
        .query("platforms")
        .withIndex("by_platform_id", (q) => q.eq("platformId", platformId))
        .first();
    } while (existingPlatform);

    const docId = await ctx.db.insert("platforms", {
      platformId,
      name: args.name,
      createdAt: Date.now(),
    });

    return { platformId, docId };
  },
});

export const getPlatform = query({
  args: { platformId: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("platforms")
      .withIndex("by_platform_id", (q) => q.eq("platformId", args.platformId))
      .first();
  },
});

export const listPlatforms = query({
  handler: async (ctx) => {
    return ctx.db.query("platforms").collect();
  },
});

export const getPlatformSummary = query({
  args: { platformId: v.string(), userId: v.string() },
  handler: async (ctx, args) => {
    const user = await getUserById(ctx, args.userId);
    assertRole(user.role, ["platform_admin", "supervisor"]);
    assertPlatformAccess(user, args.platformId);

    const restaurants = await ctx.db
      .query("restaurants")
      .withIndex("by_platform_id", (q) => q.eq("platformId", args.platformId))
      .collect();

    const branches = await ctx.db
      .query("branches")
      .withIndex("by_platform_id", (q) => q.eq("platformId", args.platformId))
      .collect();

    const calls = await ctx.db
      .query("calls")
      .withIndex("by_platform_id", (q) => q.eq("platformId", args.platformId))
      .collect();

    const orders = await ctx.db
      .query("orders")
      .withIndex("by_platform_id", (q) => q.eq("platformId", args.platformId))
      .collect();

    const missedCalls = calls.filter(
      (call) => call.status === "completed" && !call.orderId
    ).length;

    const conversionRate = calls.length
      ? Number(((orders.length / calls.length) * 100).toFixed(1))
      : 0;

    return {
      restaurants: restaurants.length,
      branches: branches.length,
      calls: calls.length,
      orders: orders.length,
      missedCalls,
      conversionRate,
    };
  },
});

export const getPlatformMetrics = query({
  args: {
    platformId: v.string(),
    userId: v.string(),
    restaurantId: v.optional(v.string()),
    branchId: v.optional(v.string()),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getUserById(ctx, args.userId);
    assertRole(user.role, ["platform_admin", "supervisor"]);
    assertPlatformAccess(user, args.platformId);

    const calls = await ctx.db
      .query("calls")
      .withIndex("by_platform_id", (q) => q.eq("platformId", args.platformId))
      .filter((q) =>
        q.and(
          args.restaurantId ? q.eq(q.field("restaurantId"), args.restaurantId) : q.eq(q.field("platformId"), args.platformId),
          args.branchId ? q.eq(q.field("branchId"), args.branchId) : q.eq(q.field("platformId"), args.platformId),
          args.startDate ? q.gte(q.field("callStartTime"), args.startDate) : q.eq(q.field("platformId"), args.platformId),
          args.endDate ? q.lte(q.field("callStartTime"), args.endDate) : q.eq(q.field("platformId"), args.platformId)
        )
      )
      .collect();

    const orders = await ctx.db
      .query("orders")
      .withIndex("by_platform_id", (q) => q.eq("platformId", args.platformId))
      .filter((q) =>
        q.and(
          args.restaurantId ? q.eq(q.field("restaurantId"), args.restaurantId) : q.eq(q.field("platformId"), args.platformId),
          args.branchId ? q.eq(q.field("branchId"), args.branchId) : q.eq(q.field("platformId"), args.platformId),
          args.startDate ? q.gte(q.field("orderPlacementTime"), args.startDate) : q.eq(q.field("platformId"), args.platformId),
          args.endDate ? q.lte(q.field("orderPlacementTime"), args.endDate) : q.eq(q.field("platformId"), args.platformId)
        )
      )
      .collect();

    const missedCalls = calls.filter(
      (call) => call.status === "completed" && !call.orderId
    ).length;

    const conversionRate = calls.length
      ? Number(((orders.length / calls.length) * 100).toFixed(1))
      : 0;

    return {
      calls: calls.length,
      orders: orders.length,
      missedCalls,
      conversionRate,
    };
  },
});

export const getPlatformReport = query({
  args: {
    platformId: v.string(),
    userId: v.string(),
    restaurantId: v.optional(v.string()),
    branchId: v.optional(v.string()),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getUserById(ctx, args.userId);
    assertRole(user.role, ["platform_admin", "supervisor"]);
    assertPlatformAccess(user, args.platformId);

    const calls = await ctx.db
      .query("calls")
      .withIndex("by_platform_id", (q) => q.eq("platformId", args.platformId))
      .filter((q) =>
        q.and(
          args.restaurantId ? q.eq(q.field("restaurantId"), args.restaurantId) : q.eq(q.field("platformId"), args.platformId),
          args.branchId ? q.eq(q.field("branchId"), args.branchId) : q.eq(q.field("platformId"), args.platformId),
          args.startDate ? q.gte(q.field("callStartTime"), args.startDate) : q.eq(q.field("platformId"), args.platformId),
          args.endDate ? q.lte(q.field("callStartTime"), args.endDate) : q.eq(q.field("platformId"), args.platformId)
        )
      )
      .collect();

    const orders = await ctx.db
      .query("orders")
      .withIndex("by_platform_id", (q) => q.eq("platformId", args.platformId))
      .filter((q) =>
        q.and(
          args.restaurantId ? q.eq(q.field("restaurantId"), args.restaurantId) : q.eq(q.field("platformId"), args.platformId),
          args.branchId ? q.eq(q.field("branchId"), args.branchId) : q.eq(q.field("platformId"), args.platformId),
          args.startDate ? q.gte(q.field("orderPlacementTime"), args.startDate) : q.eq(q.field("platformId"), args.platformId),
          args.endDate ? q.lte(q.field("orderPlacementTime"), args.endDate) : q.eq(q.field("platformId"), args.platformId)
        )
      )
      .collect();

    return {
      calls: calls.map((call) => ({
        callId: call.callId,
        restaurantId: call.restaurantId ?? "",
        branchId: call.branchId ?? "",
        status: call.status ?? "",
        orderId: call.orderId ?? "",
        phoneNumber: call.phoneNumber ?? "",
        callStartTime: call.callStartTime ?? null,
      })),
      orders: orders.map((order) => ({
        orderId: order.orderId,
        restaurantId: order.restaurantId,
        branchId: order.branchId ?? "",
        status: order.status,
        totalAmount: order.totalAmount ?? null,
        paymentStatus: order.paymentStatus ?? "",
        orderPlacementTime: order.orderPlacementTime ?? null,
      })),
    };
  },
});
