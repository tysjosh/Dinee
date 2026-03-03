import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { riderStatusValidator } from "../shared/validators";

/**
 * Create a new rider with atomic check-and-insert.
 * Returns 409 Conflict if riderId already exists.
 *
 * Requirements: 5.1, 5.2, 5.5, 20.1, 20.2, 20.3
 */
export const createRider = mutation({
  args: {
    riderId: v.string(),
    organizationId: v.string(),
    name: v.string(),
    phone: v.string(),
    vehicleType: v.string(),
    status: riderStatusValidator,
    lastLocation: v.optional(
      v.object({
        lat: v.number(),
        lng: v.number(),
        updatedAt: v.number(),
      })
    ),
    isActive: v.boolean(),
  },
  handler: async (ctx, args) => {
    // Atomic check: query by_rider_id index for uniqueness
    const existing = await ctx.db
      .query("riders")
      .withIndex("by_rider_id", (q) => q.eq("riderId", args.riderId))
      .first();

    if (existing) {
      throw new Error("409: riderId already exists");
    }

    // Insert the rider
    const docId = await ctx.db.insert("riders", {
      riderId: args.riderId,
      organizationId: args.organizationId,
      name: args.name,
      phone: args.phone,
      vehicleType: args.vehicleType,
      status: args.status,
      lastLocation: args.lastLocation,
      isActive: args.isActive,
    });

    return { riderId: args.riderId, docId };
  },
});

/**
 * Update rider status and optional location heartbeat.
 *
 * Requirements: 5.3, 5.4
 */
export const updateRiderStatus = mutation({
  args: {
    riderId: v.string(),
    status: riderStatusValidator,
    location: v.optional(
      v.object({
        lat: v.number(),
        lng: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const rider = await ctx.db
      .query("riders")
      .withIndex("by_rider_id", (q) => q.eq("riderId", args.riderId))
      .first();

    if (!rider) {
      throw new Error(`Rider not found: ${args.riderId}`);
    }

    const updates: Record<string, unknown> = {
      status: args.status,
    };

    if (args.location) {
      updates.lastLocation = {
        lat: args.location.lat,
        lng: args.location.lng,
        updatedAt: Date.now(),
      };
    }

    await ctx.db.patch(rider._id, updates);

    return { riderId: args.riderId, status: args.status };
  },
});

/**
 * Get a single rider by riderId.
 *
 * Requirements: 5.6, 20.2
 */
export const getRider = query({
  args: { riderId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("riders")
      .withIndex("by_rider_id", (q) => q.eq("riderId", args.riderId))
      .first();
  },
});

/**
 * List riders with optional filtering by organizationId and status.
 *
 * Requirements: 5.6, 20.3
 */
export const listRiders = query({
  args: {
    organizationId: v.optional(v.string()),
    status: v.optional(riderStatusValidator),
  },
  handler: async (ctx, args) => {
    // Filter by organizationId + status
    if (args.organizationId && args.status) {
      const byOrg = await ctx.db
        .query("riders")
        .withIndex("by_organization_id", (q) =>
          q.eq("organizationId", args.organizationId!)
        )
        .collect();
      return byOrg.filter((rider) => rider.status === args.status);
    }

    if (args.organizationId) {
      return await ctx.db
        .query("riders")
        .withIndex("by_organization_id", (q) =>
          q.eq("organizationId", args.organizationId!)
        )
        .collect();
    }

    if (args.status) {
      return await ctx.db
        .query("riders")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .collect();
    }

    // No filters — return all
    return await ctx.db.query("riders").collect();
  },
});
