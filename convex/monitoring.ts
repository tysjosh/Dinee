import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const recordServiceMetric = mutation({
  args: {
    serviceName: v.string(),
    status: v.union(v.literal("ok"), v.literal("degraded"), v.literal("down")),
    latencyMs: v.number(),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("serviceMetrics", {
      ...args,
      recordedAt: Date.now(),
    });

    return id;
  },
});

export const getRecentServiceMetrics = query({
  args: {
    serviceName: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const metrics = await ctx.db
      .query("serviceMetrics")
      .withIndex("by_service_name", (q) => q.eq("serviceName", args.serviceName))
      .order("desc")
      .take(args.limit ?? 50);

    return metrics;
  },
});

export const getSlaConfig = query({
  args: { serviceName: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("slaConfigs")
      .withIndex("by_service_name", (q) => q.eq("serviceName", args.serviceName))
      .first();
  },
});

export const upsertSlaConfig = mutation({
  args: {
    serviceName: v.string(),
    uptimeTarget: v.number(),
    latencyThresholdMs: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("slaConfigs")
      .withIndex("by_service_name", (q) => q.eq("serviceName", args.serviceName))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        uptimeTarget: args.uptimeTarget,
        latencyThresholdMs: args.latencyThresholdMs,
      });
      return existing._id;
    }

    return ctx.db.insert("slaConfigs", {
      serviceName: args.serviceName,
      uptimeTarget: args.uptimeTarget,
      latencyThresholdMs: args.latencyThresholdMs,
      createdAt: Date.now(),
    });
  },
});
