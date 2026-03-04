/**
 * Phone number lookup queries for call routing.
 *
 * Resolves an inbound phone number (the "To" number) to either a restaurant
 * branch or a logistics location, enabling conversation-type-based routing.
 *
 * Requirements: 11.3 — phone-number-to-organization lookup
 */

import { query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Look up a branch by its phone number.
 * Returns the branch + its restaurant's platformId for vertical resolution.
 */
export const getBranchByPhoneNumber = query({
  args: { phoneNumber: v.string() },
  handler: async (ctx, args) => {
    const branch = await ctx.db
      .query("branches")
      .withIndex("by_phone_number", (q) => q.eq("phoneNumber", args.phoneNumber))
      .first();

    if (!branch) return null;

    // Resolve restaurant to get platformId
    const restaurant = await ctx.db
      .query("restaurants")
      .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", branch.restaurantId))
      .first();

    return {
      branchId: branch.branchId,
      restaurantId: branch.restaurantId,
      platformId: restaurant?.platformId ?? null,
      vertical: "restaurant" as const,
    };
  },
});

/**
 * Look up a logistics location by its phone number.
 * Returns the location + its organization's vertical for routing.
 */
export const getLocationByPhoneNumber = query({
  args: { phoneNumber: v.string() },
  handler: async (ctx, args) => {
    const location = await ctx.db
      .query("locations")
      .withIndex("by_phone_number", (q) => q.eq("phoneNumber", args.phoneNumber))
      .first();

    if (!location) return null;

    // Resolve organization to get vertical
    const organization = await ctx.db
      .query("organizations")
      .withIndex("by_organization_id", (q) => q.eq("organizationId", location.organizationId))
      .first();

    return {
      locationId: location.locationId,
      organizationId: location.organizationId,
      platformId: organization?.platformId ?? null,
      vertical: (organization?.vertical ?? "logistics") as "restaurant" | "logistics",
    };
  },
});
