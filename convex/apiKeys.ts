import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { assertInternalCaller } from "./shared/internalAuth";
import { requirePlatformAdmin } from "./shared/ownership";

/**
 * API Keys CRUD Operations
 *
 * This module provides functions for managing API keys for partner applications.
 *
 * SECURITY: these functions gate the partner-API auth backbone (key hashes,
 * scopes). They are NOT tenant-scoped session calls, so:
 *  - the two used by the partner-API middleware at request time
 *    (`getApiKeyByHash`, `updateApiKeyLastUsed`) require the forwarded internal
 *    secret (INTERNAL_API_KEY), matching the server-to-server pattern in
 *    `convex/internal.ts`; a raw Convex call without the secret is rejected.
 *  - the management/read functions require a platform-admin session.
 * Previously all of these were public and unauthenticated, which exposed key
 * hashes and allowed anyone to mint/revoke partner keys.
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
    await requirePlatformAdmin(ctx);
    const apiKey = await ctx.db
      .query("apiKeys")
      .withIndex("by_key_id", (q) => q.eq("keyId", args.keyId))
      .first();
    return apiKey;
  },
});

/**
 * Get an API key by its hash (for validation). Called by the partner-API
 * middleware at request time (server-to-server) — requires the internal secret.
 */
export const getApiKeyByHash = query({
  args: {
    keyHash: v.string(),
    internalSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertInternalCaller(args.internalSecret);
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
    await requirePlatformAdmin(ctx);
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
    await requirePlatformAdmin(ctx);
    const apiKeys = await ctx.db
      .query("apiKeys")
      .withIndex("by_partner_id", (q) => q.eq("partnerId", args.partnerId))
      .collect();
    return apiKeys.filter((k) => k.status === "active");
  },
});

/**
 * Get all API keys (admin panel).
 */
export const getAllApiKeys = query({
  args: {},
  handler: async (ctx) => {
    await requirePlatformAdmin(ctx);
    const apiKeys = await ctx.db.query("apiKeys").collect();
    return apiKeys;
  },
});

/**
 * Get all active API keys (admin panel).
 */
export const getAllActiveApiKeys = query({
  args: {},
  handler: async (ctx) => {
    await requirePlatformAdmin(ctx);
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
    await requirePlatformAdmin(ctx);
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
    await requirePlatformAdmin(ctx);
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
    internalSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Called by the partner-API middleware (server-to-server) on each request.
    assertInternalCaller(args.internalSecret);
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
    await requirePlatformAdmin(ctx);
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
    await requirePlatformAdmin(ctx);
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
