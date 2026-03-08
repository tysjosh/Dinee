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

/**
 * Unified phone number lookup that checks provisioned numbers first,
 * then falls back to direct branch/location phone number fields.
 *
 * Lookup order:
 * 1. Check `phoneNumbers` table by `by_phone_number` index
 *    - If found and status is "assigned", resolve to branch or location
 * 2. Fall back to branch `by_phone_number` index (legacy/shared number flow)
 * 3. Fall back to location `by_phone_number` index
 *
 * Requirements: 11.1, 11.2, 11.3
 */
export const getEntityByPhoneNumber = query({
  args: { phoneNumber: v.string() },
  handler: async (ctx, args) => {
    // 1. Check the phoneNumbers table for a provisioned number
    const provisionedNumber = await ctx.db
      .query("phoneNumbers")
      .withIndex("by_phone_number", (q) => q.eq("phoneNumber", args.phoneNumber))
      .first();

    if (provisionedNumber && provisionedNumber.status === "assigned" && provisionedNumber.assignedToId) {
      if (provisionedNumber.assignedToType === "branch") {
        const branch = await ctx.db
          .query("branches")
          .withIndex("by_branch_id", (q) => q.eq("branchId", provisionedNumber.assignedToId!))
          .first();

        if (branch) {
          const restaurant = await ctx.db
            .query("restaurants")
            .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", branch.restaurantId))
            .first();

          return {
            type: "branch" as const,
            branchId: branch.branchId,
            restaurantId: branch.restaurantId,
            platformId: restaurant?.platformId ?? null,
            vertical: "restaurant" as const,
            phoneNumberId: provisionedNumber.numberId,
            provider: provisionedNumber.provider,
          };
        }
      }

      if (provisionedNumber.assignedToType === "location") {
        const location = await ctx.db
          .query("locations")
          .withIndex("by_location_id", (q) => q.eq("locationId", provisionedNumber.assignedToId!))
          .first();

        if (location) {
          const organization = await ctx.db
            .query("organizations")
            .withIndex("by_organization_id", (q) => q.eq("organizationId", location.organizationId))
            .first();

          return {
            type: "location" as const,
            locationId: location.locationId,
            organizationId: location.organizationId,
            platformId: organization?.platformId ?? null,
            vertical: (organization?.vertical ?? "logistics") as "restaurant" | "logistics",
            phoneNumberId: provisionedNumber.numberId,
            provider: provisionedNumber.provider,
          };
        }
      }
    }

    // 2. Fall back to branch lookup by phone number (legacy/shared number flow)
    const branch = await ctx.db
      .query("branches")
      .withIndex("by_phone_number", (q) => q.eq("phoneNumber", args.phoneNumber))
      .first();

    if (branch) {
      const restaurant = await ctx.db
        .query("restaurants")
        .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", branch.restaurantId))
        .first();

      return {
        type: "branch" as const,
        branchId: branch.branchId,
        restaurantId: branch.restaurantId,
        platformId: restaurant?.platformId ?? null,
        vertical: "restaurant" as const,
        phoneNumberId: null,
        provider: null,
      };
    }

    // 3. Fall back to location lookup by phone number
    const location = await ctx.db
      .query("locations")
      .withIndex("by_phone_number", (q) => q.eq("phoneNumber", args.phoneNumber))
      .first();

    if (location) {
      const organization = await ctx.db
        .query("organizations")
        .withIndex("by_organization_id", (q) => q.eq("organizationId", location.organizationId))
        .first();

      return {
        type: "location" as const,
        locationId: location.locationId,
        organizationId: location.organizationId,
        platformId: organization?.platformId ?? null,
        vertical: (organization?.vertical ?? "logistics") as "restaurant" | "logistics",
        phoneNumberId: null,
        provider: null,
      };
    }

    return null;
  },
});

