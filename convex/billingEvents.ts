/**
 * Billing events storage and usage aggregation queries.
 *
 * Requirements: REQ-5.1, REQ-5.3
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { verticalValidator } from "./shared/validators";

const eventTypeValidator = v.union(
  v.literal("call_completed"),
  v.literal("order_placed")
);

/**
 * Creates a billing event record.
 */
export const createBillingEvent = mutation({
  args: {
    eventId: v.string(),
    businessId: v.string(),
    vertical: verticalValidator,
    eventType: eventTypeValidator,
    durationSeconds: v.optional(v.number()),
    outcome: v.optional(v.string()),
    sourcePlatform: v.optional(v.string()),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("billingEvents", args);
    return { success: true, eventId: args.eventId };
  },
});

/**
 * Returns per-business usage totals for a billing period.
 * Validates: REQ-5.3
 */
export const getUsageSummary = query({
  args: {
    businessId: v.string(),
    periodStart: v.number(),
    periodEnd: v.number(),
  },
  handler: async (ctx, args) => {
    const events = await ctx.db
      .query("billingEvents")
      .withIndex("by_business_id", (q) => q.eq("businessId", args.businessId))
      .collect();

    const filtered = events.filter(
      (e) => e.createdAt >= args.periodStart && e.createdAt < args.periodEnd
    );

    let totalCalls = 0;
    let totalSeconds = 0;
    const outcomesByType: Record<string, number> = {};

    for (const event of filtered) {
      if (event.eventType === "call_completed") {
        totalCalls++;
        totalSeconds += event.durationSeconds ?? 0;
      }

      if (event.outcome) {
        outcomesByType[event.outcome] = (outcomesByType[event.outcome] ?? 0) + 1;
      }
    }

    return {
      totalCalls,
      totalMinutes: Math.round((totalSeconds / 60) * 100) / 100,
      outcomesByType,
    };
  },
});

/**
 * Returns aggregate usage across all businesses in a vertical for a billing period.
 */
export const getUsageSummaryByVertical = query({
  args: {
    vertical: verticalValidator,
    periodStart: v.number(),
    periodEnd: v.number(),
  },
  handler: async (ctx, args) => {
    const events = await ctx.db
      .query("billingEvents")
      .withIndex("by_vertical", (q) => q.eq("vertical", args.vertical))
      .collect();

    const filtered = events.filter(
      (e) => e.createdAt >= args.periodStart && e.createdAt < args.periodEnd
    );

    let totalCalls = 0;
    let totalSeconds = 0;
    const outcomesByType: Record<string, number> = {};

    for (const event of filtered) {
      if (event.eventType === "call_completed") {
        totalCalls++;
        totalSeconds += event.durationSeconds ?? 0;
      }

      if (event.outcome) {
        outcomesByType[event.outcome] = (outcomesByType[event.outcome] ?? 0) + 1;
      }
    }

    return {
      totalCalls,
      totalMinutes: Math.round((totalSeconds / 60) * 100) / 100,
      outcomesByType,
    };
  },
});
