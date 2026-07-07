import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { requireTenantAccessOrInternal, requirePlatformAdmin } from "./shared/ownership";

// Call/transcript data is tenant-scoped. These functions serve the dashboard
// (session) and server routes (partner API, forwards the internal secret). The
// voice runtime writes call data via the secret-guarded internal.upsertCallData
// / addTranscript, not these functions.

/** Resolve a branchId to its owning restaurantId for tenant checks. */
async function branchRestaurantId(ctx: QueryCtx, branchId: string): Promise<string> {
  const branch = await ctx.db
    .query("branches")
    .withIndex("by_branch_id", (q) => q.eq("branchId", branchId))
    .first();
  return branch?.restaurantId ?? "";
}

/** Resolve a callId to its owning restaurantId for tenant checks. */
async function callRestaurantId(ctx: QueryCtx, callId: string): Promise<string> {
  const call = await ctx.db
    .query("calls")
    .withIndex("by_call_and_order_id", (q) => q.eq("callId", callId))
    .first();
  return call?.restaurantId ?? "";
}

/**
 * Update call with ASR confidence data
 * 
 * @requirements 16.4 - Log ASR confidence scores for Nigerian English transcriptions
 * @requirements 16.5 - Store languageDetected in calls table
 */
export const updateCallASRData = mutation({
  args: {
    callId: v.string(),
    asrConfidence: v.number(),
    languageDetected: v.string(),
    fallbackTriggered: v.boolean(),
    internalSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Find the call by callId using index (O(1) instead of full-table scan)
    const call = await ctx.db
      .query("calls")
      .withIndex("by_call_and_order_id", (q) => q.eq("callId", args.callId))
      .first();

    if (!call) {
      console.error(`[updateCallASRData] Call not found: ${args.callId}`);
      return null;
    }

    await requireTenantAccessOrInternal(ctx, call.restaurantId ?? "", args.internalSecret);

    // Update the call with ASR data
    await ctx.db.patch(call._id, {
      asrConfidence: args.asrConfidence,
      languageDetected: args.languageDetected,
      fallbackTriggered: args.fallbackTriggered,
    });

    console.log(
      `[updateCallASRData] Updated call ${args.callId}: ` +
      `confidence=${(args.asrConfidence * 100).toFixed(1)}%, ` +
      `language=${args.languageDetected}, ` +
      `fallbackTriggered=${args.fallbackTriggered}`
    );

    return call._id;
  },
});
/**
 * Get a single call by callId
 * Used by authorization utility to resolve call → restaurantId
 */
export const getCallByCallId = query({
  args: { callId: v.string(), internalSecret: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const call = await ctx.db
      .query("calls")
      .withIndex("by_call_and_order_id", (q) => q.eq("callId", args.callId))
      .first();
    await requireTenantAccessOrInternal(ctx, call?.restaurantId ?? "", args.internalSecret);
    return call ?? null;
  },
});




export const getCallsByRestaurant = query({
  args: { restaurantId: v.string(), internalSecret: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireTenantAccessOrInternal(ctx, args.restaurantId, args.internalSecret);
    const calls = await ctx.db
      .query("calls")
      .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.restaurantId))
      .order("desc")
      .collect();

    return calls;
  },
});

// Get calls by branch
export const getCallsByBranch = query({
  args: { branchId: v.string(), internalSecret: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireTenantAccessOrInternal(
      ctx,
      await branchRestaurantId(ctx, args.branchId),
      args.internalSecret
    );
    const calls = await ctx.db
      .query("calls")
      .withIndex("by_branch_id", (q) => q.eq("branchId", args.branchId))
      .order("desc")
      .collect();

    return calls;
  },
});

export const getActiveCallsByRestaurant = query({
  args: { restaurantId: v.string(), internalSecret: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireTenantAccessOrInternal(ctx, args.restaurantId, args.internalSecret);
    const calls = await ctx.db
      .query("calls")
      .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.restaurantId))
      .filter((q) => q.eq(q.field("status"), "active"))
      .order("desc")
      .collect();

    return calls;
  },
});

// Get active calls by branch
export const getActiveCallsByBranch = query({
  args: { branchId: v.string(), internalSecret: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireTenantAccessOrInternal(
      ctx,
      await branchRestaurantId(ctx, args.branchId),
      args.internalSecret
    );
    const calls = await ctx.db
      .query("calls")
      .withIndex("by_branch_id", (q) => q.eq("branchId", args.branchId))
      .filter((q) => q.eq(q.field("status"), "active"))
      .order("desc")
      .collect();

    return calls;
  },
});

export const getPastCallsByRestaurant = query({
  args: { restaurantId: v.string(), internalSecret: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireTenantAccessOrInternal(ctx, args.restaurantId, args.internalSecret);
    const calls = await ctx.db
      .query("calls")
      .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.restaurantId))
      .filter((q) => q.eq(q.field("status"), "completed"))
      .order("desc")
      .collect();

    return calls;
  },
});

// Get past calls by branch
export const getPastCallsByBranch = query({
  args: { branchId: v.string(), internalSecret: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireTenantAccessOrInternal(
      ctx,
      await branchRestaurantId(ctx, args.branchId),
      args.internalSecret
    );
    const calls = await ctx.db
      .query("calls")
      .withIndex("by_branch_id", (q) => q.eq("branchId", args.branchId))
      .filter((q) => q.eq(q.field("status"), "completed"))
      .order("desc")
      .collect();

    return calls;
  },
});

export const getTranscriptsByCallId = query({
  args: { callId: v.string(), internalSecret: v.optional(v.string()) },
  handler: async (ctx, args) => {
    // Transcripts are call content (PII) — scope to the owning tenant.
    await requireTenantAccessOrInternal(
      ctx,
      await callRestaurantId(ctx, args.callId),
      args.internalSecret
    );
    const transcripts = await ctx.db
      .query("transcripts")
      .withIndex("by_call_id", (q) => q.eq("callId", args.callId))
      .order("asc")
      .collect();

    return transcripts;
  },
});

export const updateCall = mutation({
  args: {
    callId: v.id("calls"),
    branchId: v.optional(v.string()),
    duration: v.optional(v.number()),
    callEndTime: v.optional(v.number()),
    status: v.optional(v.union(v.literal("active"), v.literal("completed"))),
    transcript: v.optional(v.string()),
    liveTranscript: v.optional(v.string()),
    orderId: v.optional(v.string()),
    sentiment: v.optional(v.union(
      v.literal("positive"),
      v.literal("neutral"),
      v.literal("negative")
    )),
    reason: v.optional(v.string()),
    asrConfidence: v.optional(v.number()),
    languageDetected: v.optional(v.string()),
    fallbackTriggered: v.optional(v.boolean()),
    internalSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { callId, internalSecret, ...updates } = args;

    const existing = await ctx.db.get(callId);
    await requireTenantAccessOrInternal(ctx, existing?.restaurantId ?? "", internalSecret);

    await ctx.db.patch(callId, updates);
    return callId;
  },
});


/**
 * Get calls with low ASR confidence (below threshold)
 * 
 * @requirements 16.4 - Log ASR confidence scores for Nigerian English transcriptions
 * @requirements 16.5 - Track calls where confidence fell below 70%
 */
export const getCallsWithLowConfidence = query({
  args: { 
    restaurantId: v.string(),
    confidenceThreshold: v.optional(v.number()),
    internalSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireTenantAccessOrInternal(ctx, args.restaurantId, args.internalSecret);
    const threshold = args.confidenceThreshold ?? 0.7; // Default 70% threshold per requirement 16.5
    
    const calls = await ctx.db
      .query("calls")
      .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.restaurantId))
      .collect();

    // Filter calls with ASR confidence below threshold
    return calls.filter((call) => {
      if (call.asrConfidence === undefined || call.asrConfidence === null) {
        return false;
      }
      return call.asrConfidence < threshold;
    });
  },
});

/**
 * Get ASR metrics for a restaurant
 * 
 * @requirements 16.4 - Log ASR confidence scores for Nigerian English transcriptions
 */
export const getASRMetrics = query({
  args: { restaurantId: v.string(), internalSecret: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireTenantAccessOrInternal(ctx, args.restaurantId, args.internalSecret);
    const calls = await ctx.db
      .query("calls")
      .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.restaurantId))
      .collect();

    // Filter calls with ASR confidence data
    const callsWithConfidence = calls.filter(
      (call) => call.asrConfidence !== undefined && call.asrConfidence !== null
    );

    if (callsWithConfidence.length === 0) {
      return {
        totalCalls: calls.length,
        callsWithASRData: 0,
        averageConfidence: 0,
        fallbackRate: 0,
        languageBreakdown: {},
      };
    }

    // Calculate average confidence
    const totalConfidence = callsWithConfidence.reduce(
      (sum, call) => sum + (call.asrConfidence || 0),
      0
    );
    const averageConfidence = totalConfidence / callsWithConfidence.length;

    // Calculate fallback rate
    const fallbackCount = callsWithConfidence.filter(
      (call) => call.fallbackTriggered === true
    ).length;
    const fallbackRate = fallbackCount / callsWithConfidence.length;

    // Calculate language breakdown
    const languageBreakdown: Record<string, { count: number; avgConfidence: number }> = {};
    
    for (const call of callsWithConfidence) {
      const lang = call.languageDetected || "unknown";
      if (!languageBreakdown[lang]) {
        languageBreakdown[lang] = { count: 0, avgConfidence: 0 };
      }
      languageBreakdown[lang].count++;
      languageBreakdown[lang].avgConfidence += call.asrConfidence || 0;
    }

    // Calculate average confidence per language
    for (const lang of Object.keys(languageBreakdown)) {
      languageBreakdown[lang].avgConfidence /= languageBreakdown[lang].count;
    }

    return {
      totalCalls: calls.length,
      callsWithASRData: callsWithConfidence.length,
      averageConfidence,
      fallbackRate,
      languageBreakdown,
    };
  },
});
