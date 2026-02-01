import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * Webhook Subscriptions CRUD Operations
 * 
 * This module provides functions for managing webhook subscriptions
 * for partner applications.
 * 
 * @requirements 21.5 - Webhook delivery for events
 * @requirements 21.7 - Partner dashboard displays webhook delivery status
 */

// ============================================================================
// Queries
// ============================================================================

/**
 * Get a webhook subscription by its ID
 */
export const getWebhookSubscriptionById = query({
  args: {
    subscriptionId: v.string(),
  },
  handler: async (ctx, args) => {
    const subscription = await ctx.db
      .query("webhookSubscriptions")
      .withIndex("by_subscription_id", (q) => q.eq("subscriptionId", args.subscriptionId))
      .first();
    return subscription;
  },
});

/**
 * Get all webhook subscriptions for a partner
 */
export const getWebhookSubscriptionsByPartnerId = query({
  args: {
    partnerId: v.string(),
  },
  handler: async (ctx, args) => {
    const subscriptions = await ctx.db
      .query("webhookSubscriptions")
      .withIndex("by_partner_id", (q) => q.eq("partnerId", args.partnerId))
      .collect();
    return subscriptions;
  },
});

/**
 * Get all active webhook subscriptions for a partner
 */
export const getActiveWebhookSubscriptionsByPartnerId = query({
  args: {
    partnerId: v.string(),
  },
  handler: async (ctx, args) => {
    const subscriptions = await ctx.db
      .query("webhookSubscriptions")
      .withIndex("by_partner_id", (q) => q.eq("partnerId", args.partnerId))
      .collect();
    return subscriptions.filter((s) => s.isActive);
  },
});

/**
 * Get all active webhook subscriptions (for event dispatching)
 */
export const getAllActiveWebhookSubscriptions = query({
  args: {},
  handler: async (ctx) => {
    const subscriptions = await ctx.db.query("webhookSubscriptions").collect();
    return subscriptions.filter((s) => s.isActive);
  },
});

/**
 * Get webhook subscriptions by event type
 */
export const getWebhookSubscriptionsByEventType = query({
  args: {
    eventType: v.string(),
  },
  handler: async (ctx, args) => {
    const subscriptions = await ctx.db.query("webhookSubscriptions").collect();
    return subscriptions.filter(
      (s) => s.isActive && s.events.includes(args.eventType)
    );
  },
});

// ============================================================================
// Mutations
// ============================================================================

/**
 * Create a new webhook subscription
 */
export const createWebhookSubscription = mutation({
  args: {
    subscriptionId: v.string(),
    partnerId: v.string(),
    url: v.string(),
    events: v.array(v.string()),
    secret: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const id = await ctx.db.insert("webhookSubscriptions", {
      subscriptionId: args.subscriptionId,
      partnerId: args.partnerId,
      url: args.url,
      events: args.events,
      secret: args.secret,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    return id;
  },
});

/**
 * Update a webhook subscription
 */
export const updateWebhookSubscription = mutation({
  args: {
    subscriptionId: v.string(),
    url: v.optional(v.string()),
    events: v.optional(v.array(v.string())),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const subscription = await ctx.db
      .query("webhookSubscriptions")
      .withIndex("by_subscription_id", (q) => q.eq("subscriptionId", args.subscriptionId))
      .first();

    if (!subscription) {
      throw new Error(`Webhook subscription not found: ${args.subscriptionId}`);
    }

    const updates: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.url !== undefined) updates.url = args.url;
    if (args.events !== undefined) updates.events = args.events;
    if (args.isActive !== undefined) updates.isActive = args.isActive;

    await ctx.db.patch(subscription._id, updates);
    return subscription._id;
  },
});

/**
 * Deactivate a webhook subscription
 */
export const deactivateWebhookSubscription = mutation({
  args: {
    subscriptionId: v.string(),
  },
  handler: async (ctx, args) => {
    const subscription = await ctx.db
      .query("webhookSubscriptions")
      .withIndex("by_subscription_id", (q) => q.eq("subscriptionId", args.subscriptionId))
      .first();

    if (!subscription) {
      throw new Error(`Webhook subscription not found: ${args.subscriptionId}`);
    }

    await ctx.db.patch(subscription._id, { 
      isActive: false, 
      updatedAt: Date.now() 
    });
    return subscription._id;
  },
});

/**
 * Delete a webhook subscription
 */
export const deleteWebhookSubscription = mutation({
  args: {
    subscriptionId: v.string(),
  },
  handler: async (ctx, args) => {
    const subscription = await ctx.db
      .query("webhookSubscriptions")
      .withIndex("by_subscription_id", (q) => q.eq("subscriptionId", args.subscriptionId))
      .first();

    if (!subscription) {
      throw new Error(`Webhook subscription not found: ${args.subscriptionId}`);
    }

    await ctx.db.delete(subscription._id);
    return true;
  },
});
