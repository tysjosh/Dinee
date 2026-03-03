import { internalMutation, mutation, query } from "../_generated/server";
import { v } from "convex/values";

/**
 * Look up an idempotency key scoped to a partner.
 * Uses the `by_key_and_partner` index for efficient lookup.
 *
 * Requirements: 21.1, 21.2, 21.3, 21.4
 */
export const checkIdempotencyKey = query({
  args: {
    key: v.string(),
    partnerId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("idempotencyKeys")
      .withIndex("by_key_and_partner", (q) =>
        q.eq("key", args.key).eq("partnerId", args.partnerId)
      )
      .first();
  },
});

/**
 * Store an idempotency key record after a successful mutation.
 * Keys expire after 24 hours (86400000 ms).
 *
 * Requirements: 21.2, 21.5
 */
export const storeIdempotencyKey = mutation({
  args: {
    key: v.string(),
    partnerId: v.string(),
    requestHash: v.string(),
    responseStatus: v.number(),
    responseBody: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const TTL_MS = 86_400_000; // 24 hours

    await ctx.db.insert("idempotencyKeys", {
      key: args.key,
      partnerId: args.partnerId,
      requestHash: args.requestHash,
      responseStatus: args.responseStatus,
      responseBody: args.responseBody,
      createdAt: now,
      expiresAt: now + TTL_MS,
    });
  },
});


/**
 * Internal mutation to delete expired idempotency keys in batches.
 * Queries the `by_expires_at` index for records where expiresAt < now,
 * deletes up to BATCH_SIZE per invocation to stay within Convex limits.
 *
 * Returns the number of deleted records.
 *
 * Requirements: 21.5
 */
export const cleanupExpiredKeys = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const BATCH_SIZE = 100;

    const expired = await ctx.db
      .query("idempotencyKeys")
      .withIndex("by_expires_at", (q) => q.lt("expiresAt", now))
      .take(BATCH_SIZE);

    for (const record of expired) {
      await ctx.db.delete(record._id);
    }

    return { deleted: expired.length };
  },
});
