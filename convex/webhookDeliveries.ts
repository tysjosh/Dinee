import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * Webhook Deliveries CRUD Operations
 * 
 * This module provides functions for tracking webhook delivery attempts
 * and their status.
 * 
 * @requirements 21.6 - Retry failed deliveries up to 5 times with exponential backoff
 * @requirements 21.7 - Partner dashboard displays webhook delivery status
 */

// ============================================================================
// Queries
// ============================================================================

/**
 * Get a webhook delivery by its ID
 */
export const getWebhookDeliveryById = query({
  args: {
    deliveryId: v.string(),
  },
  handler: async (ctx, args) => {
    const delivery = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_delivery_id", (q) => q.eq("deliveryId", args.deliveryId))
      .first();
    return delivery;
  },
});

/**
 * Get all webhook deliveries for a subscription
 */
export const getWebhookDeliveriesBySubscriptionId = query({
  args: {
    subscriptionId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const deliveries = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_subscription_id", (q) => q.eq("subscriptionId", args.subscriptionId))
      .collect();
    
    // Sort by createdAt descending
    deliveries.sort((a, b) => b.createdAt - a.createdAt);
    
    // Apply limit if specified
    if (args.limit) {
      return deliveries.slice(0, args.limit);
    }
    
    return deliveries;
  },
});

/**
 * Get failed webhook deliveries (for retry processing)
 */
export const getFailedWebhookDeliveries = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const deliveries = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_success", (q) => q.eq("success", false))
      .collect();
    
    // Filter to only include deliveries that should be retried
    const now = Date.now();
    const retriableDeliveries = deliveries.filter(
      (d) => d.attemptCount < 5 && (!d.nextRetryAt || d.nextRetryAt <= now)
    );
    
    // Sort by nextRetryAt ascending
    retriableDeliveries.sort((a, b) => (a.nextRetryAt || 0) - (b.nextRetryAt || 0));
    
    // Apply limit if specified
    if (args.limit) {
      return retriableDeliveries.slice(0, args.limit);
    }
    
    return retriableDeliveries;
  },
});

/**
 * Get webhook delivery statistics for a partner
 */
export const getWebhookDeliveryStats = query({
  args: {
    partnerId: v.string(),
    startTime: v.optional(v.number()),
    endTime: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // First get all subscriptions for this partner
    const subscriptions = await ctx.db
      .query("webhookSubscriptions")
      .withIndex("by_partner_id", (q) => q.eq("partnerId", args.partnerId))
      .collect();
    
    const subscriptionIds = subscriptions.map((s) => s.subscriptionId);
    
    // Get all deliveries for these subscriptions
    const allDeliveries = await ctx.db.query("webhookDeliveries").collect();
    
    let deliveries = allDeliveries.filter((d) => 
      subscriptionIds.includes(d.subscriptionId)
    );
    
    // Filter by time range if specified
    if (args.startTime) {
      deliveries = deliveries.filter((d) => d.createdAt >= args.startTime!);
    }
    if (args.endTime) {
      deliveries = deliveries.filter((d) => d.createdAt <= args.endTime!);
    }
    
    // Calculate statistics
    const totalDeliveries = deliveries.length;
    const successfulDeliveries = deliveries.filter((d) => d.success).length;
    const failedDeliveries = totalDeliveries - successfulDeliveries;
    
    // Group by event type
    const deliveriesByEventType: Record<string, number> = {};
    for (const delivery of deliveries) {
      deliveriesByEventType[delivery.eventType] = 
        (deliveriesByEventType[delivery.eventType] || 0) + 1;
    }
    
    return {
      totalDeliveries,
      successfulDeliveries,
      failedDeliveries,
      successRate: totalDeliveries > 0 
        ? (successfulDeliveries / totalDeliveries) * 100 
        : 0,
      deliveriesByEventType,
    };
  },
});

/**
 * Get recent webhook deliveries for a partner (for dashboard)
 */
export const getRecentWebhookDeliveries = query({
  args: {
    partnerId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // First get all subscriptions for this partner
    const subscriptions = await ctx.db
      .query("webhookSubscriptions")
      .withIndex("by_partner_id", (q) => q.eq("partnerId", args.partnerId))
      .collect();
    
    const subscriptionIds = subscriptions.map((s) => s.subscriptionId);
    
    // Get all deliveries for these subscriptions
    const allDeliveries = await ctx.db.query("webhookDeliveries").collect();
    
    const deliveries = allDeliveries.filter((d) => 
      subscriptionIds.includes(d.subscriptionId)
    );
    
    // Sort by createdAt descending
    deliveries.sort((a, b) => b.createdAt - a.createdAt);
    
    // Apply limit (default 50)
    const limit = args.limit || 50;
    return deliveries.slice(0, limit);
  },
});

// ============================================================================
// Mutations
// ============================================================================

/**
 * Create a new webhook delivery record
 */
export const createWebhookDelivery = mutation({
  args: {
    deliveryId: v.string(),
    subscriptionId: v.string(),
    eventType: v.string(),
    payload: v.string(),
    statusCode: v.optional(v.number()),
    responseBody: v.optional(v.string()),
    attemptCount: v.number(),
    success: v.boolean(),
    error: v.optional(v.string()),
    nextRetryAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const id = await ctx.db.insert("webhookDeliveries", {
      deliveryId: args.deliveryId,
      subscriptionId: args.subscriptionId,
      eventType: args.eventType,
      payload: args.payload,
      statusCode: args.statusCode,
      responseBody: args.responseBody,
      attemptCount: args.attemptCount,
      success: args.success,
      error: args.error,
      nextRetryAt: args.nextRetryAt,
      createdAt: now,
      lastAttemptAt: now,
    });

    return id;
  },
});

/**
 * Update a webhook delivery after a retry attempt
 */
export const updateWebhookDeliveryAttempt = mutation({
  args: {
    deliveryId: v.string(),
    statusCode: v.optional(v.number()),
    responseBody: v.optional(v.string()),
    attemptCount: v.number(),
    success: v.boolean(),
    error: v.optional(v.string()),
    nextRetryAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const delivery = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_delivery_id", (q) => q.eq("deliveryId", args.deliveryId))
      .first();

    if (!delivery) {
      throw new Error(`Webhook delivery not found: ${args.deliveryId}`);
    }

    await ctx.db.patch(delivery._id, {
      statusCode: args.statusCode,
      responseBody: args.responseBody,
      attemptCount: args.attemptCount,
      success: args.success,
      error: args.error,
      nextRetryAt: args.nextRetryAt,
      lastAttemptAt: Date.now(),
    });

    return delivery._id;
  },
});

/**
 * Delete old webhook deliveries (for cleanup)
 */
export const deleteOldWebhookDeliveries = mutation({
  args: {
    olderThanDays: v.number(),
  },
  handler: async (ctx, args) => {
    const cutoffTime = Date.now() - args.olderThanDays * 24 * 60 * 60 * 1000;
    
    const deliveries = await ctx.db.query("webhookDeliveries").collect();
    const oldDeliveries = deliveries.filter((d) => d.createdAt < cutoffTime);
    
    for (const delivery of oldDeliveries) {
      await ctx.db.delete(delivery._id);
    }
    
    return oldDeliveries.length;
  },
});
