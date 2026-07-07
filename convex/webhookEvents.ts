import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * Webhook Events CRUD Operations
 * 
 * This module provides functions for logging and managing webhook events
 * from payment providers (Paystack, Flutterwave) and WhatsApp.
 * 
 * Requirements: 8.4 (Paystack webhook endpoint), 9.2 (Flutterwave webhook endpoint)
 */

// Provider type for webhook events
const providerValidator = v.union(
  v.literal("paystack"),
  v.literal("flutterwave"),
  v.literal("whatsapp"),
  v.literal("stripe")
);

/**
 * Create a new webhook event record
 * Used when receiving webhooks from payment providers or WhatsApp
 */
export const createWebhookEvent = mutation({
  args: {
    eventId: v.string(),
    provider: providerValidator,
    eventType: v.string(),
    payload: v.string(),
    signature: v.optional(v.string()),
    verified: v.boolean(),
    processed: v.boolean(),
    orderId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const webhookEventId = await ctx.db.insert("webhookEvents", {
      eventId: args.eventId,
      provider: args.provider,
      eventType: args.eventType,
      payload: args.payload,
      signature: args.signature,
      verified: args.verified,
      processed: args.processed,
      orderId: args.orderId,
      createdAt: Date.now(),
    });
    return webhookEventId;
  },
});

/**
 * Atomic webhook event insertion with idempotency check.
 * Checks-and-inserts in a single Convex transaction (Convex mutations are
 * serialized per document, eliminating TOCTOU race).
 * Returns { inserted: false, alreadyProcessed } if the event already exists,
 * or { inserted: true, id } on successful insert.
 *
 * Supports optional logistics fields (shipmentId, resourceType, resourceId)
 * for polymorphic webhook events across restaurant and logistics verticals.
 */
export const atomicInsertWebhookEvent = mutation({
  args: {
    eventId: v.string(),
    provider: providerValidator,
    eventType: v.string(),
    payload: v.string(),
    signature: v.optional(v.string()),
    verified: v.boolean(),
    processed: v.boolean(),
    orderId: v.optional(v.string()),
    // Logistics vertical: polymorphic webhook event fields
    shipmentId: v.optional(v.string()),
    resourceType: v.optional(v.union(v.literal("order"), v.literal("shipment"))),
    resourceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Check within the same transaction — atomic
    const existing = await ctx.db
      .query("webhookEvents")
      .withIndex("by_event_id", (q) => q.eq("eventId", args.eventId))
      .first();

    if (existing) {
      return { inserted: false as const, alreadyProcessed: existing.processed };
    }

    const id = await ctx.db.insert("webhookEvents", {
      ...args,
      createdAt: Date.now(),
    });
    return { inserted: true as const, id };
  },
});



/**
 * Get a webhook event by its eventId
 * Used to check if a webhook has already been processed (idempotency)
 */
export const getWebhookEventByEventId = query({
  args: {
    eventId: v.string(),
  },
  handler: async (ctx, args) => {
    const webhookEvent = await ctx.db
      .query("webhookEvents")
      .withIndex("by_event_id", (q) => q.eq("eventId", args.eventId))
      .first();
    return webhookEvent;
  },
});

/**
 * Get all webhook events for a specific order
 * Used to track payment and messaging events for an order
 */
export const getWebhookEventsByOrderId = query({
  args: {
    orderId: v.string(),
  },
  handler: async (ctx, args) => {
    const webhookEvents = await ctx.db
      .query("webhookEvents")
      .withIndex("by_order_id", (q) => q.eq("orderId", args.orderId))
      .collect();
    return webhookEvents;
  },
});

/**
 * Mark a webhook event as processed
 * Used after successfully handling a webhook event
 */
export const markWebhookEventAsProcessed = mutation({
  args: {
    eventId: v.string(),
    orderId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const webhookEvent = await ctx.db
      .query("webhookEvents")
      .withIndex("by_event_id", (q) => q.eq("eventId", args.eventId))
      .first();

    if (!webhookEvent) {
      throw new Error(`Webhook event not found: ${args.eventId}`);
    }

    await ctx.db.patch(webhookEvent._id, {
      processed: true,
      // Update orderId if provided (may be determined during processing)
      ...(args.orderId !== undefined && { orderId: args.orderId }),
    });

    return webhookEvent._id;
  },
});

/**
 * Update webhook event verification status
 * Used when signature verification is performed after initial logging
 */
export const updateWebhookEventVerification = mutation({
  args: {
    eventId: v.string(),
    verified: v.boolean(),
  },
  handler: async (ctx, args) => {
    const webhookEvent = await ctx.db
      .query("webhookEvents")
      .withIndex("by_event_id", (q) => q.eq("eventId", args.eventId))
      .first();

    if (!webhookEvent) {
      throw new Error(`Webhook event not found: ${args.eventId}`);
    }

    await ctx.db.patch(webhookEvent._id, {
      verified: args.verified,
    });

    return webhookEvent._id;
  },
});

/**
 * Get unprocessed webhook events by provider
 * Used for retry logic or monitoring failed webhooks
 */
export const getUnprocessedWebhookEvents = query({
  args: {
    provider: v.optional(providerValidator),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Bounded scan: read the newest N events (there is no index on `processed`,
    // and unprocessed events are effectively always recent), then filter — so
    // this never loads the whole table as it grows.
    const MAX_SCAN = 2000;
    const recent = await ctx.db.query("webhookEvents").order("desc").take(MAX_SCAN);

    let filteredEvents = recent.filter((event) => !event.processed);

    // Filter by provider if specified
    if (args.provider) {
      filteredEvents = filteredEvents.filter(
        (event) => event.provider === args.provider
      );
    }

    // `recent` is already newest-first from the desc take.
    // Apply limit if specified
    if (args.limit) {
      filteredEvents = filteredEvents.slice(0, args.limit);
    }

    return filteredEvents;
  },
});

/**
 * Get webhook events by provider within a time range
 * Used for analytics and monitoring
 */
export const getWebhookEventsByProvider = query({
  args: {
    provider: providerValidator,
    startTime: v.optional(v.number()),
    endTime: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Bounded scan of the newest N events, then filter by provider/time range.
    const MAX_SCAN = 2000;
    const recent = await ctx.db.query("webhookEvents").order("desc").take(MAX_SCAN);

    let filteredEvents = recent.filter(
      (event) => event.provider === args.provider
    );
    
    // Filter by time range if specified
    if (args.startTime) {
      filteredEvents = filteredEvents.filter(
        (event) => event.createdAt >= args.startTime!
      );
    }
    if (args.endTime) {
      filteredEvents = filteredEvents.filter(
        (event) => event.createdAt <= args.endTime!
      );
    }
    
    // `recent` is already newest-first from the desc take.
    // Apply limit if specified
    if (args.limit) {
      filteredEvents = filteredEvents.slice(0, args.limit);
    }
    
    return filteredEvents;
  },
});

/**
 * Check if a webhook event has already been processed (idempotency check)
 * Returns true if the event exists and has been processed
 */
export const isWebhookEventProcessed = query({
  args: {
    eventId: v.string(),
  },
  handler: async (ctx, args) => {
    const webhookEvent = await ctx.db
      .query("webhookEvents")
      .withIndex("by_event_id", (q) => q.eq("eventId", args.eventId))
      .first();
    
    return webhookEvent?.processed ?? false;
  },
});
