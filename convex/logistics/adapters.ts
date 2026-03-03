import { query } from "../_generated/server";
import { v } from "convex/values";
import { verticalValidator } from "../shared/validators";

/**
 * Read-only compatibility adapter: maps a Restaurant record to an Organization-shaped object.
 * Returns null if the restaurant is not found.
 *
 * Requirements: 18.1, 18.6
 */
export const getOrganizationFromRestaurant = query({
  args: { restaurantId: v.string() },
  handler: async (ctx, args) => {
    const restaurant = await ctx.db
      .query("restaurants")
      .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.restaurantId))
      .first();

    if (!restaurant) {
      return null;
    }

    return {
      organizationId: restaurant.restaurantId,
      platformId: restaurant.platformId,
      vertical: "restaurant" as const,
      name: restaurant.name,
      settings: {},
      createdAt: restaurant.createdAt,
      _adapted: true as const,
    };
  },
});

/**
 * Read-only compatibility adapter: maps a Branch record to a Location-shaped object.
 * Returns null if the branch is not found.
 *
 * Requirements: 18.2
 */
export const getLocationFromBranch = query({
  args: { branchId: v.string() },
  handler: async (ctx, args) => {
    const branch = await ctx.db
      .query("branches")
      .withIndex("by_branch_id", (q) => q.eq("branchId", args.branchId))
      .first();

    if (!branch) {
      return null;
    }

    // Look up the restaurant to get the organizationId mapping
    const restaurant = await ctx.db
      .query("restaurants")
      .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", branch.restaurantId))
      .first();

    return {
      locationId: branch.branchId,
      organizationId: branch.restaurantId,
      name: branch.name,
      address: branch.address,
      city: "",
      state: "",
      geo: { lat: 0, lng: 0 },
      isActive: branch.isActive,
      operatingHours: branch.operatingHours,
      createdAt: branch.createdAt,
      _adapted: true as const,
      _sourceRestaurantPlatformId: restaurant?.platformId ?? null,
    };
  },
});

/**
 * Read-only adapter: merges native Organization records with adapted Restaurant records.
 * When vertical is undefined or "restaurant", restaurants are adapted and included.
 * When vertical is "logistics", only native organizations with that vertical are returned.
 *
 * Requirements: 18.3, 18.4, 18.5
 */
export const listOrganizationsWithAdapted = query({
  args: {
    platformId: v.string(),
    vertical: v.optional(verticalValidator),
  },
  handler: async (ctx, args) => {
    // Fetch native organizations filtered by platformId
    const nativeOrgs = await ctx.db
      .query("organizations")
      .withIndex("by_platform_id", (q) => q.eq("platformId", args.platformId))
      .collect();

    // Apply vertical filter to native orgs if specified
    const filteredNative = args.vertical
      ? nativeOrgs.filter((org) => org.vertical === args.vertical)
      : nativeOrgs;

    // If vertical is explicitly "logistics", no restaurant adaptation needed
    if (args.vertical === "logistics") {
      return filteredNative;
    }

    // Adapt restaurant records when vertical is undefined or "restaurant"
    const restaurants = await ctx.db
      .query("restaurants")
      .withIndex("by_platform_id", (q) => q.eq("platformId", args.platformId))
      .collect();

    const adaptedOrgs = restaurants.map((restaurant) => ({
      organizationId: restaurant.restaurantId,
      platformId: restaurant.platformId,
      vertical: "restaurant" as const,
      name: restaurant.name,
      settings: {},
      createdAt: restaurant.createdAt,
      _adapted: true as const,
    }));

    return [...filteredNative, ...adaptedOrgs];
  },
});
