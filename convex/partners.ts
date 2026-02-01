import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * Partners CRUD Operations
 * 
 * This module provides functions for managing partner organizations
 * that integrate with the platform via the Partner API.
 * 
 * @requirements 21.3 - API key management for partners
 */

// ============================================================================
// Queries
// ============================================================================

/**
 * Get a partner by their partner ID
 */
export const getPartnerByPartnerId = query({
  args: {
    partnerId: v.string(),
  },
  handler: async (ctx, args) => {
    const partner = await ctx.db
      .query("partners")
      .withIndex("by_partner_id", (q) => q.eq("partnerId", args.partnerId))
      .first();
    return partner;
  },
});

/**
 * Get a partner by email
 */
export const getPartnerByEmail = query({
  args: {
    email: v.string(),
  },
  handler: async (ctx, args) => {
    const partner = await ctx.db
      .query("partners")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();
    return partner;
  },
});

/**
 * Get all partners for a platform
 */
export const getPartnersByPlatformId = query({
  args: {
    platformId: v.string(),
  },
  handler: async (ctx, args) => {
    const partners = await ctx.db
      .query("partners")
      .withIndex("by_platform_id", (q) => q.eq("platformId", args.platformId))
      .collect();
    return partners;
  },
});

/**
 * Get all active partners for a platform
 */
export const getActivePartnersByPlatformId = query({
  args: {
    platformId: v.string(),
  },
  handler: async (ctx, args) => {
    const partners = await ctx.db
      .query("partners")
      .withIndex("by_platform_id", (q) => q.eq("platformId", args.platformId))
      .collect();
    return partners.filter((p) => p.isActive);
  },
});

// ============================================================================
// Mutations
// ============================================================================

/**
 * Create a new partner
 */
export const createPartner = mutation({
  args: {
    partnerId: v.string(),
    name: v.string(),
    email: v.string(),
    platformId: v.string(),
    restaurantIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    // Check if partner with this email already exists
    const existingPartner = await ctx.db
      .query("partners")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();

    if (existingPartner) {
      throw new Error(`Partner with email ${args.email} already exists`);
    }

    const id = await ctx.db.insert("partners", {
      partnerId: args.partnerId,
      name: args.name,
      email: args.email,
      isActive: true,
      platformId: args.platformId,
      restaurantIds: args.restaurantIds,
      createdAt: Date.now(),
    });

    return id;
  },
});

/**
 * Update a partner
 */
export const updatePartner = mutation({
  args: {
    partnerId: v.string(),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
    restaurantIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const partner = await ctx.db
      .query("partners")
      .withIndex("by_partner_id", (q) => q.eq("partnerId", args.partnerId))
      .first();

    if (!partner) {
      throw new Error(`Partner not found: ${args.partnerId}`);
    }

    const updates: Record<string, unknown> = {};
    if (args.name !== undefined) updates.name = args.name;
    if (args.email !== undefined) updates.email = args.email;
    if (args.isActive !== undefined) updates.isActive = args.isActive;
    if (args.restaurantIds !== undefined) updates.restaurantIds = args.restaurantIds;

    await ctx.db.patch(partner._id, updates);
    return partner._id;
  },
});

/**
 * Deactivate a partner
 */
export const deactivatePartner = mutation({
  args: {
    partnerId: v.string(),
  },
  handler: async (ctx, args) => {
    const partner = await ctx.db
      .query("partners")
      .withIndex("by_partner_id", (q) => q.eq("partnerId", args.partnerId))
      .first();

    if (!partner) {
      throw new Error(`Partner not found: ${args.partnerId}`);
    }

    await ctx.db.patch(partner._id, { isActive: false });
    return partner._id;
  },
});

/**
 * Delete a partner (use with caution)
 */
export const deletePartner = mutation({
  args: {
    partnerId: v.string(),
  },
  handler: async (ctx, args) => {
    const partner = await ctx.db
      .query("partners")
      .withIndex("by_partner_id", (q) => q.eq("partnerId", args.partnerId))
      .first();

    if (!partner) {
      throw new Error(`Partner not found: ${args.partnerId}`);
    }

    await ctx.db.delete(partner._id);
    return true;
  },
});
