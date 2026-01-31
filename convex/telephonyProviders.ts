import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const createTelephonyProvider = mutation({
  args: {
    providerId: v.string(),
    platformId: v.optional(v.string()),
    name: v.string(),
    type: v.union(v.literal("twilio"), v.literal("local"), v.literal("other")),
    priority: v.number(),
    isActive: v.boolean(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("telephonyProviders")
      .withIndex("by_provider_id", (q) => q.eq("providerId", args.providerId))
      .first();

    if (existing) {
      throw new Error("Provider already exists");
    }

    const id = await ctx.db.insert("telephonyProviders", {
      ...args,
      createdAt: Date.now(),
    });

    return id;
  },
});

export const listTelephonyProviders = query({
  args: { platformId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (args.platformId) {
      return ctx.db
        .query("telephonyProviders")
        .withIndex("by_platform_id", (q) => q.eq("platformId", args.platformId))
        .order("desc")
        .collect();
    }

    return ctx.db.query("telephonyProviders").order("desc").collect();
  },
});

export const updateTelephonyProvider = mutation({
  args: {
    providerId: v.string(),
    name: v.optional(v.string()),
    type: v.optional(v.union(v.literal("twilio"), v.literal("local"), v.literal("other"))),
    priority: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const provider = await ctx.db
      .query("telephonyProviders")
      .withIndex("by_provider_id", (q) => q.eq("providerId", args.providerId))
      .first();

    if (!provider) {
      throw new Error("Provider not found");
    }

    const updates: {
      name?: string;
      type?: "twilio" | "local" | "other";
      priority?: number;
      isActive?: boolean;
      notes?: string;
    } = {};

    if (args.name !== undefined) updates.name = args.name;
    if (args.type !== undefined) updates.type = args.type;
    if (args.priority !== undefined) updates.priority = args.priority;
    if (args.isActive !== undefined) updates.isActive = args.isActive;
    if (args.notes !== undefined) updates.notes = args.notes;

    await ctx.db.patch(provider._id, updates);
    return provider._id;
  },
});

export const deleteTelephonyProvider = mutation({
  args: { providerId: v.string() },
  handler: async (ctx, args) => {
    const provider = await ctx.db
      .query("telephonyProviders")
      .withIndex("by_provider_id", (q) => q.eq("providerId", args.providerId))
      .first();

    if (!provider) {
      throw new Error("Provider not found");
    }

    await ctx.db.delete(provider._id);
    return provider._id;
  },
});
