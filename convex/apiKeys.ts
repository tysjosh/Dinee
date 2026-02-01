import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * API Keys CRUD Operations
 * 
 * This module provides functions for managing API keys for partner applications.
 * 
 * @requirements 21.3 - API key management for partners in the dashboard
 */

// ============================================================================
// Queries
// ============================================================================

/**
 * Get an API key by its key ID
 */
export const getApiKeyByKeyId = query({
  args: {
    keyId: v.string(),
  },
  handler: async (ctx, args) => {
    const apiKey = await ctx.db
      .query("apiKeys")
      .withIndex("by_key_id", (q) => q.eq("keyId", args.keyId))
      .first();
    return apiKey;
  },
});

/**
 * Get an API key by its hash (for validation)
 */
export const getApiKeyByHash = query({
  args: {
    keyHash: v.string(),
  },
  handler: async (ctx, args) => {
    const apiKey = await ctx.db
      .query("apiKeys")
      .withIndex("by_key_hash", (q) => q.eq("keyHash", args.keyHash))
      .first();
    return apiKey;
  },
});

/**
 * Get all API keys for a partner
 */
export const getApiKeysByPartnerId = query({
  args: {
    partnerId: v.string(),
  },
  handler: async (ctx, args) => {
    const apiKeys = await ctx.db
      .query("apiKeys")
      .withIndex("by_partner_id", (q) => q.eq("partnerId", args.partnerId))
      .collect();
    return apiKeys;
  },
});

/**
 * Get all active API keys for a partner
 */
export const getActiveApiKeysByPartnerId = query({
  args: {
    partnerId: v.string(),
  },
  handler: async (ctx, args) => {
    const apiKeys = await ctx.db
      .query("apiKeys")
      .withIndex("by_partner_id", (q) => q.eq("partnerId", args.partnerId))
      .collect();
    return apiKeys.filter((k) => k.status === "active");
  },
});

/**
 * Get all API keys (for validation purposes)
 */
export const getAllApiKeys = query({
  args: {},
  handler: async (ctx) => {
    const apiKeys = await ctx.db.query("apiKeys").collect();
    return apiKeys;
  },
});

/**
 * Get all active API keys (for validation purposes)
 */
export const getAllActiveApiKeys = query({
  args: {},
  handler: async (ctx) => {
    const apiKeys = await ctx.db.query("apiKeys").collect();
    return apiKeys.filter((k) => k.status === "active");
  },
});

// ============================================================================
// Mutations
// ============================================================================

/**
 * Create a new API key
 */
export const createApiKey = mutation({
  args: {
    keyId: v.string(),
    keyHash: v.string(),
    keyPrefix: v.string(),
    name: v.string(),
    partnerId: v.string(),
    scopes: v.array(v.string()),
    rateLimitOverride: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    ipWhitelist: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("apiKeys", {
      keyId: args.keyId,
      keyHash: args.keyHash,
      keyPrefix: args.keyPrefix,
      name: args.name,
      partnerId: args.partnerId,
      status: "active",
      scopes: args.scopes,
      rateLimitOverride: args.rateLimitOverride,
      createdAt: Date.now(),
      expiresAt: args.expiresAt,
      ipWhitelist: args.ipWhitelist,
    });

    return id;
  },
});

/**
 * Update an API key
 */
export const updateApiKey = mutation({
  args: {
    keyId: v.string(),
    name: v.optional(v.string()),
    scopes: v.optional(v.array(v.string())),
    rateLimitOverride: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    ipWhitelist: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const apiKey = await ctx.db
      .query("apiKeys")
      .withIndex("by_key_id", (q) => q.eq("keyId", args.keyId))
      .first();

    if (!apiKey) {
      throw new Error(`API key not found: ${args.keyId}`);
    }

    const updates: Record<string, unknown> = {};
    if (args.name !== undefined) updates.name = args.name;
    if (args.scopes !== undefined) updates.scopes = args.scopes;
    if (args.rateLimitOverride !== undefined) updates.rateLimitOverride = args.rateLimitOverride;
    if (args.expiresAt !== undefined) updates.expiresAt = args.expiresAt;
    if (args.ipWhitelist !== undefined) updates.ipWhitelist = args.ipWhitelist;

    await ctx.db.patch(apiKey._id, updates);
    return apiKey._id;
  },
});

/**
 * Update last used timestamp for an API key
 */
export const updateApiKeyLastUsed = mutation({
  args: {
    keyId: v.string(),
  },
  handler: async (ctx, args) => {
    const apiKey = await ctx.db
      .query("apiKeys")
      .withIndex("by_key_id", (q) => q.eq("keyId", args.keyId))
      .first();

    if (!apiKey) {
      throw new Error(`API key not found: ${args.keyId}`);
    }

    await ctx.db.patch(apiKey._id, { lastUsedAt: Date.now() });
    return apiKey._id;
  },
});

/**
 * Revoke an API key
 */
export const revokeApiKey = mutation({
  args: {
    keyId: v.string(),
  },
  handler: async (ctx, args) => {
    const apiKey = await ctx.db
      .query("apiKeys")
      .withIndex("by_key_id", (q) => q.eq("keyId", args.keyId))
      .first();

    if (!apiKey) {
      throw new Error(`API key not found: ${args.keyId}`);
    }

    await ctx.db.patch(apiKey._id, { status: "revoked" });
    return apiKey._id;
  },
});

/**
 * Delete an API key (use with caution)
 */
export const deleteApiKey = mutation({
  args: {
    keyId: v.string(),
  },
  handler: async (ctx, args) => {
    const apiKey = await ctx.db
      .query("apiKeys")
      .withIndex("by_key_id", (q) => q.eq("keyId", args.keyId))
      .first();

    if (!apiKey) {
      throw new Error(`API key not found: ${args.keyId}`);
    }

    await ctx.db.delete(apiKey._id);
    return true;
  },
});
