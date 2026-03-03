import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { actorTypeValidator } from "../shared/validators";

/**
 * Create a new shipment event with atomic check-and-insert.
 * Returns 409 Conflict if eventId already exists for the given shipment.
 * This is the only write operation — the module is append-only.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 20.1
 */
export const createShipmentEvent = mutation({
  args: {
    eventId: v.string(),
    shipmentId: v.string(),
    eventType: v.string(),
    actorType: actorTypeValidator,
    actorId: v.string(),
    payload: v.string(),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    // Atomic check: query by_shipment_id index and filter by eventId for uniqueness
    const existingEvents = await ctx.db
      .query("shipmentEvents")
      .withIndex("by_shipment_id", (q) => q.eq("shipmentId", args.shipmentId))
      .collect();

    const duplicate = existingEvents.find((e) => e.eventId === args.eventId);

    if (duplicate) {
      throw new Error("409: eventId already exists");
    }

    // Insert the shipment event
    const docId = await ctx.db.insert("shipmentEvents", {
      eventId: args.eventId,
      shipmentId: args.shipmentId,
      eventType: args.eventType,
      actorType: args.actorType,
      actorId: args.actorId,
      payload: args.payload,
      createdAt: args.createdAt,
    });

    return { eventId: args.eventId, docId };
  },
});

/**
 * List all shipment events for a given shipmentId, ordered by creation time.
 *
 * Requirements: 6.1, 6.2
 */
export const listShipmentEvents = query({
  args: { shipmentId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("shipmentEvents")
      .withIndex("by_shipment_id", (q) => q.eq("shipmentId", args.shipmentId))
      .collect();
  },
});
