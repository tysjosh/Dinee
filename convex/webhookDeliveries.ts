import { v } from "convex/values";
import { mutation, query, internalMutation, internalAction, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";

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


// ============================================================================
// Webhook Retry Cron Scheduler
// Requirements: 20.1, 20.2, 20.3, 20.6, 20.7, 20.8
// ============================================================================

/** Backoff schedule: 30s, 2m, 10m, 1h, 6h */
const BACKOFF_SCHEDULE_MS = [30_000, 120_000, 600_000, 3_600_000, 21_600_000];

/**
 * Internal query to fetch pending webhook deliveries for retry.
 * Queries by_next_retry_at index for deliveries where nextRetryAt <= now and success == false.
 * Batch limit of 50 per tick.
 */
export const getPendingRetries = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    const pending = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_next_retry_at", (q) => q.lte("nextRetryAt", args.now))
      .filter((q) => q.eq(q.field("success"), false))
      .take(50);

    return pending.map((d) => ({
      _id: d._id,
      deliveryId: d.deliveryId,
      subscriptionId: d.subscriptionId,
      eventType: d.eventType,
      payload: d.payload,
      attemptCount: d.attemptCount,
    }));
  },
});

/**
 * Internal mutation to mark a delivery as successful after a retry attempt.
 */
export const markDeliverySuccess = internalMutation({
  args: { id: v.id("webhookDeliveries") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      success: true,
      lastAttemptAt: Date.now(),
    });
  },
});

/**
 * Internal mutation to update a delivery after a failed retry attempt.
 * Increments attemptCount, computes next backoff, or dead-letters if attempts exhausted.
 */
export const markDeliveryFailure = internalMutation({
  args: {
    id: v.id("webhookDeliveries"),
    attemptCount: v.number(),
    error: v.optional(v.string()),
    statusCode: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const newAttemptCount = args.attemptCount + 1;

    // Dead-letter if attemptCount >= 5 (Req 20.3)
    if (newAttemptCount >= 5) {
      await ctx.db.patch(args.id, {
        attemptCount: newAttemptCount,
        lastAttemptAt: Date.now(),
        error: args.error,
        statusCode: args.statusCode,
        nextRetryAt: undefined, // dead-letter
      });
      return;
    }

    // Compute next backoff from schedule
    const nextBackoff = BACKOFF_SCHEDULE_MS[newAttemptCount - 1] ?? BACKOFF_SCHEDULE_MS[BACKOFF_SCHEDULE_MS.length - 1];
    await ctx.db.patch(args.id, {
      attemptCount: newAttemptCount,
      lastAttemptAt: Date.now(),
      error: args.error,
      statusCode: args.statusCode,
      nextRetryAt: Date.now() + nextBackoff,
    });
  },
});

/**
 * Process pending webhook delivery retries.
 * Runs as an internalAction (not mutation) so it can make HTTP fetch calls.
 * Called by the cron job every 60 seconds.
 *
 * Requirements: 20.1, 20.2, 20.3, 20.6, 20.7, 20.8
 */
export const processRetries = internalAction({
  handler: async (ctx) => {
    const now = Date.now();

    // 1. Fetch pending deliveries via internal query
    const pending = await ctx.runQuery(
      internal.webhookDeliveries.getPendingRetries,
      { now }
    );

    if (pending.length === 0) return;

    for (const delivery of pending) {
      // Look up the subscription to get URL and secret
      const subscription = await ctx.runQuery(
        internal.webhookDeliveries.getSubscriptionByIdInternal,
        { subscriptionId: delivery.subscriptionId }
      );

      if (!subscription || !subscription.isActive) {
        console.info(
          `[webhook-retry] Skipping delivery ${delivery.deliveryId}: subscription inactive or not found`
        );
        continue;
      }

      // Attempt delivery via fetch
      let success = false;
      let statusCode: number | undefined;
      let errorMsg: string | undefined;

      try {
        const timestamp = Math.floor(Date.now() / 1000);
        const payloadString = delivery.payload;

        // Compute HMAC-SHA256 signature
        const encoder = new TextEncoder();
        const keyData = encoder.encode(subscription.secret);
        const key = await crypto.subtle.importKey(
          "raw",
          keyData,
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["sign"]
        );
        const signatureData = await crypto.subtle.sign(
          "HMAC",
          key,
          encoder.encode(`${timestamp}.${payloadString}`)
        );
        const signature = Array.from(new Uint8Array(signatureData))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10_000);

        const response = await fetch(subscription.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Webhook-Signature": signature,
            "X-Webhook-Timestamp": timestamp.toString(),
            "User-Agent": "RestaurantPlatform-Webhook/1.0",
          },
          body: payloadString,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        statusCode = response.status;
        success = response.ok;

        if (!success) {
          errorMsg = `HTTP ${response.status}`;
        }
      } catch (err) {
        errorMsg = err instanceof Error ? err.message : String(err);
        if (errorMsg.includes("abort")) {
          statusCode = 408;
          errorMsg = "Request timeout";
        }
      }

      if (success) {
        // On success: set success=true, update lastAttemptAt (Req 20.1)
        await ctx.runMutation(
          internal.webhookDeliveries.markDeliverySuccess,
          { id: delivery._id }
        );
        console.info(
          `[webhook-retry] Delivery ${delivery.deliveryId} succeeded on attempt ${delivery.attemptCount + 1}`
        );
      } else {
        // On failure: increment attemptCount, compute next backoff or dead-letter (Req 20.2, 20.3)
        await ctx.runMutation(
          internal.webhookDeliveries.markDeliveryFailure,
          {
            id: delivery._id,
            attemptCount: delivery.attemptCount,
            error: errorMsg,
            statusCode,
          }
        );
        const newCount = delivery.attemptCount + 1;
        if (newCount >= 5) {
          console.info(
            `[webhook-retry] Delivery ${delivery.deliveryId} dead-lettered after ${newCount} attempts: ${errorMsg}`
          );
        } else {
          console.info(
            `[webhook-retry] Delivery ${delivery.deliveryId} failed attempt ${newCount}: ${errorMsg}`
          );
        }
      }
    }
  },
});

/**
 * Internal query to look up a webhook subscription by subscriptionId.
 * Used by processRetries action to get the URL and secret.
 */
export const getSubscriptionByIdInternal = internalQuery({
  args: { subscriptionId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("webhookSubscriptions")
      .withIndex("by_subscription_id", (q) =>
        q.eq("subscriptionId", args.subscriptionId)
      )
      .first();
  },
});

// ============================================================================
// Dispatch Webhook Event (REQ-6.3)
// Creates delivery records for all matching subscriptions
// ============================================================================

/**
 * Internal mutation to dispatch a webhook event to all matching subscriptions.
 * Queries webhookSubscriptions for active subscriptions whose events array includes eventType.
 * For each match, inserts a webhookDeliveries record for immediate retry by the cron.
 */
export const dispatchWebhookEvent = internalMutation({
  args: {
    eventType: v.string(),
    businessId: v.string(),
    payload: v.string(),
  },
  handler: async (ctx, args) => {
    // Find all active subscriptions that include this event type
    const allSubscriptions = await ctx.db
      .query("webhookSubscriptions")
      .collect();

    const matchingSubscriptions = allSubscriptions.filter(
      (s) => s.isActive && s.events.includes(args.eventType)
    );

    let deliveriesCreated = 0;
    for (const subscription of matchingSubscriptions) {
      const deliveryId = `whd_${args.eventType}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await ctx.db.insert("webhookDeliveries", {
        deliveryId,
        subscriptionId: subscription.subscriptionId,
        eventType: args.eventType,
        payload: args.payload,
        attemptCount: 0,
        success: false,
        nextRetryAt: Date.now(),
        createdAt: Date.now(),
      });
      deliveriesCreated++;
    }

    return deliveriesCreated;
  },
});

// ============================================================================
// Dead-Letter and Stats Queries
// Requirements: 20.4, 20.5
// ============================================================================

/**
 * Retrieve dead-letter webhook deliveries filtered by subscriptionId and time range.
 * Dead-letter = success is false AND attemptCount >= 5 AND nextRetryAt is undefined/null.
 *
 * Requirements: 20.4
 */
export const getDeadLetterDeliveries = query({
  args: {
    subscriptionId: v.string(),
    startTime: v.optional(v.number()),
    endTime: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let deliveries = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_subscription_id", (q) =>
        q.eq("subscriptionId", args.subscriptionId)
      )
      .collect();

    // Filter to dead-letter: success == false, attemptCount >= 5, nextRetryAt is undefined
    deliveries = deliveries.filter(
      (d) =>
        !d.success &&
        d.attemptCount >= 5 &&
        (d.nextRetryAt === undefined || d.nextRetryAt === null)
    );

    // Filter by time range
    if (args.startTime) {
      deliveries = deliveries.filter((d) => d.createdAt >= args.startTime!);
    }
    if (args.endTime) {
      deliveries = deliveries.filter((d) => d.createdAt <= args.endTime!);
    }

    // Sort by createdAt descending
    deliveries.sort((a, b) => b.createdAt - a.createdAt);

    const limit = args.limit ?? 50;
    return deliveries.slice(0, limit);
  },
});

/**
 * Retrieve webhook delivery statistics per partner, including dead-letter count.
 * Returns: total, successful, failed, dead-letter count.
 *
 * Requirements: 20.5
 */
export const getWebhookDeliveryStatsWithDeadLetter = query({
  args: {
    partnerId: v.string(),
    startTime: v.optional(v.number()),
    endTime: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Get all subscriptions for this partner
    const subscriptions = await ctx.db
      .query("webhookSubscriptions")
      .withIndex("by_partner_id", (q) => q.eq("partnerId", args.partnerId))
      .collect();

    const subscriptionIds = new Set(subscriptions.map((s) => s.subscriptionId));

    // Get all deliveries for these subscriptions
    const allDeliveries = await ctx.db.query("webhookDeliveries").collect();
    let deliveries = allDeliveries.filter((d) =>
      subscriptionIds.has(d.subscriptionId)
    );

    // Filter by time range
    if (args.startTime) {
      deliveries = deliveries.filter((d) => d.createdAt >= args.startTime!);
    }
    if (args.endTime) {
      deliveries = deliveries.filter((d) => d.createdAt <= args.endTime!);
    }

    const total = deliveries.length;
    const successful = deliveries.filter((d) => d.success).length;
    const deadLetter = deliveries.filter(
      (d) =>
        !d.success &&
        d.attemptCount >= 5 &&
        (d.nextRetryAt === undefined || d.nextRetryAt === null)
    ).length;
    const failed = total - successful;

    return {
      total,
      successful,
      failed,
      deadLetter,
      successRate: total > 0 ? (successful / total) * 100 : 0,
    };
  },
});
