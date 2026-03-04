import { mutation, query } from "../_generated/server";
import { v } from "convex/values";

/**
 * Create a new location with atomic check-and-insert.
 * Validates organizationId references an existing organization.
 * Returns 409 Conflict if locationId already exists.
 *
 * Requirements: 3.3, 3.4, 20.1, 20.2, 20.3
 */
export const createLocation = mutation({
  args: {
    locationId: v.string(),
    organizationId: v.string(),
    name: v.string(),
    address: v.string(),
    city: v.string(),
    state: v.string(),
    geo: v.object({ lat: v.number(), lng: v.number() }),
    isActive: v.boolean(),
    operatingHours: v.object({}),
    phoneNumber: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Atomic check: query by_location_id index for uniqueness
    const existing = await ctx.db
      .query("locations")
      .withIndex("by_location_id", (q) => q.eq("locationId", args.locationId))
      .first();

    if (existing) {
      throw new Error("409: locationId already exists");
    }

    // Validate organizationId references an existing organization
    const organization = await ctx.db
      .query("organizations")
      .withIndex("by_organization_id", (q) => q.eq("organizationId", args.organizationId))
      .first();

    if (!organization) {
      throw new Error(`Organization not found: ${args.organizationId}`);
    }

    // Insert the location
    const docId = await ctx.db.insert("locations", {
      locationId: args.locationId,
      organizationId: args.organizationId,
      name: args.name,
      address: args.address,
      city: args.city,
      state: args.state,
      geo: args.geo,
      isActive: args.isActive,
      operatingHours: args.operatingHours,
      phoneNumber: args.phoneNumber,
      createdAt: Date.now(),
    });

    return { locationId: args.locationId, docId };
  },
});

/**
 * Get a single location by locationId.
 *
 * Requirements: 3.7, 20.2
 */
export const getLocation = query({
  args: { locationId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("locations")
      .withIndex("by_location_id", (q) => q.eq("locationId", args.locationId))
      .first();
  },
});

/**
 * List locations with optional filtering by organizationId, city, and state.
 *
 * Requirements: 3.5, 3.7, 20.3
 */
export const listLocations = query({
  args: {
    organizationId: v.optional(v.string()),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Filter by city and state using composite index
    if (args.city && args.state) {
      const byCityState = await ctx.db
        .query("locations")
        .withIndex("by_city_state", (q) => q.eq("city", args.city!).eq("state", args.state!))
        .collect();
      // If organizationId also provided, filter further
      if (args.organizationId) {
        return byCityState.filter((loc) => loc.organizationId === args.organizationId);
      }
      return byCityState;
    }

    // Filter by city only using composite index (partial match)
    if (args.city) {
      const byCity = await ctx.db
        .query("locations")
        .withIndex("by_city_state", (q) => q.eq("city", args.city!))
        .collect();
      if (args.organizationId) {
        return byCity.filter((loc) => loc.organizationId === args.organizationId);
      }
      return byCity;
    }

    // Filter by organizationId using index
    if (args.organizationId) {
      const byOrg = await ctx.db
        .query("locations")
        .withIndex("by_organization_id", (q) => q.eq("organizationId", args.organizationId!))
        .collect();
      // If state also provided, filter further
      if (args.state) {
        return byOrg.filter((loc) => loc.state === args.state);
      }
      return byOrg;
    }

    // State only — no dedicated index, filter from full table
    if (args.state) {
      const all = await ctx.db.query("locations").collect();
      return all.filter((loc) => loc.state === args.state);
    }

    // No filters — return all
    return await ctx.db.query("locations").collect();
  },
});
