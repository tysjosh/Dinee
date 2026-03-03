import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { verticalValidator } from "../shared/validators";

/**
 * Create a new organization with atomic check-and-insert.
 * Validates platformId exists and vertical is in platform's enabledVerticals.
 * Returns 409 Conflict if organizationId already exists.
 *
 * Requirements: 2.3, 2.4, 2.5, 20.1, 20.2, 20.3
 */
export const createOrganization = mutation({
  args: {
    organizationId: v.string(),
    platformId: v.string(),
    vertical: verticalValidator,
    name: v.string(),
    settings: v.object({}),
  },
  handler: async (ctx, args) => {
    // Atomic check: query by_organization_id index for uniqueness
    const existing = await ctx.db
      .query("organizations")
      .withIndex("by_organization_id", (q) => q.eq("organizationId", args.organizationId))
      .first();

    if (existing) {
      throw new Error("409: organizationId already exists");
    }

    // Validate platformId references an existing platform
    const platform = await ctx.db
      .query("platforms")
      .withIndex("by_platform_id", (q) => q.eq("platformId", args.platformId))
      .first();

    if (!platform) {
      throw new Error(`Platform not found: ${args.platformId}`);
    }

    // Validate vertical is in platform's enabledVerticals
    const enabledVerticals = platform.enabledVerticals ?? [];
    if (!enabledVerticals.includes(args.vertical)) {
      throw new Error(
        `Vertical "${args.vertical}" is not enabled for platform ${args.platformId}`
      );
    }

    // Insert the organization
    const docId = await ctx.db.insert("organizations", {
      organizationId: args.organizationId,
      platformId: args.platformId,
      vertical: args.vertical,
      name: args.name,
      settings: args.settings,
      createdAt: Date.now(),
    });

    return { organizationId: args.organizationId, docId };
  },
});

/**
 * Get a single organization by organizationId.
 *
 * Requirements: 2.7, 20.2
 */
export const getOrganization = query({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("organizations")
      .withIndex("by_organization_id", (q) => q.eq("organizationId", args.organizationId))
      .first();
  },
});

/**
 * List organizations with optional filtering by platformId and vertical.
 *
 * Requirements: 2.6, 2.7, 20.3
 */
export const listOrganizations = query({
  args: {
    platformId: v.optional(v.string()),
    vertical: v.optional(verticalValidator),
  },
  handler: async (ctx, args) => {
    // Filter by platformId using index
    if (args.platformId && args.vertical) {
      const byPlatform = await ctx.db
        .query("organizations")
        .withIndex("by_platform_id", (q) => q.eq("platformId", args.platformId!))
        .collect();
      return byPlatform.filter((org) => org.vertical === args.vertical);
    }

    if (args.platformId) {
      return await ctx.db
        .query("organizations")
        .withIndex("by_platform_id", (q) => q.eq("platformId", args.platformId!))
        .collect();
    }

    if (args.vertical) {
      return await ctx.db
        .query("organizations")
        .withIndex("by_vertical", (q) => q.eq("vertical", args.vertical!))
        .collect();
    }

    // No filters — return all
    return await ctx.db.query("organizations").collect();
  },
});
