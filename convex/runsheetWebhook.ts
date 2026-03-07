import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Check if a webhook event has already been processed (deduplication).
 * Returns the existing record if found, null otherwise.
 *
 * Requirements: 8.7
 */
export const checkDeduplication = query({
  args: {
    eventId: v.string(),
    provider: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("webhookDeduplication")
      .withIndex("by_event_and_provider", (q) =>
        q.eq("eventId", args.eventId).eq("provider", args.provider)
      )
      .first();
  },
});

/**
 * Record a processed webhook event for deduplication.
 * TTL set to 7 days for cleanup.
 *
 * Requirements: 8.7
 */
export const recordDeduplication = mutation({
  args: {
    eventId: v.string(),
    provider: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    await ctx.db.insert("webhookDeduplication", {
      eventId: args.eventId,
      provider: args.provider,
      processedAt: now,
      expiresAt: now + sevenDaysMs,
    });
  },
});

/**
 * Look up a shipment by shipmentId and update its deliveryStatus.
 * Creates a ShipmentEvent audit log entry with actorType "system".
 * Returns null if shipment not found.
 *
 * Requirements: 8.3, 8.5
 */
export const updateShipmentFromWebhook = mutation({
  args: {
    shipmentId: v.string(),
    deliveryStatus: v.string(),
    eventId: v.string(),
    eventType: v.string(),
    payload: v.string(),
  },
  handler: async (ctx, args) => {
    const shipment = await ctx.db
      .query("shipments")
      .withIndex("by_shipment_id", (q) => q.eq("shipmentId", args.shipmentId))
      .first();

    if (!shipment) {
      return { found: false };
    }

    const now = Date.now();

    await ctx.db.patch(shipment._id, {
      deliveryStatus: args.deliveryStatus as "created" | "assigned" | "picked_up" | "in_transit" | "delivered" | "failed" | "cancelled",
      updatedAt: now,
    });

    await ctx.db.insert("shipmentEvents", {
      eventId: args.eventId,
      shipmentId: args.shipmentId,
      eventType: args.eventType,
      actorType: "system",
      actorId: "runsheet_webhook",
      payload: args.payload,
      createdAt: now,
    });

    return { found: true };
  },
});

/**
 * Look up a shipment by shipmentId and update its assignedRiderId.
 * Creates a ShipmentEvent audit log entry with actorType "system".
 * Returns null if shipment not found.
 *
 * Requirements: 8.4, 8.5
 */
export const updateRiderFromWebhook = mutation({
  args: {
    shipmentId: v.string(),
    riderId: v.string(),
    eventId: v.string(),
    payload: v.string(),
  },
  handler: async (ctx, args) => {
    const shipment = await ctx.db
      .query("shipments")
      .withIndex("by_shipment_id", (q) => q.eq("shipmentId", args.shipmentId))
      .first();

    if (!shipment) {
      return { found: false };
    }

    const now = Date.now();

    await ctx.db.patch(shipment._id, {
      assignedRiderId: args.riderId,
      updatedAt: now,
    });

    await ctx.db.insert("shipmentEvents", {
      eventId: args.eventId,
      shipmentId: args.shipmentId,
      eventType: "rider_assignment",
      actorType: "system",
      actorId: "runsheet_webhook",
      payload: args.payload,
      createdAt: now,
    });

    return { found: true };
  },
});

/**
 * Increment the failure count on a business's Runsheet integration status.
 * Used when a webhook references an unmatched shipmentId.
 *
 * Requirements: 8.6
 */
export const incrementRunsheetFailureCount = mutation({
  args: {
    businessId: v.string(),
  },
  handler: async (ctx, args) => {
    const business = await ctx.db
      .query("restaurants")
      .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.businessId))
      .first();

    if (!business || !business.integrations?.runsheet) {
      return;
    }

    const currentCount = business.integrations.runsheet.failureCount ?? 0;

    await ctx.db.patch(business._id, {
      integrations: {
        ...business.integrations,
        runsheet: {
          ...business.integrations.runsheet,
          failureCount: currentCount + 1,
        },
      },
    });
  },
});
