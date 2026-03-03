import { internalMutation, mutation, query } from "../_generated/server";
import { v } from "convex/values";

/**
 * Look up an idempotency key scoped to a partner.
 * Uses the `by_key_and_partner` index for efficient lookup.
 * Returns the `status` field, defaulting to "success" for backward compatibility
 * with records created before the status field was added.
 *
 * Requirements: 21.1, 21.2, 21.3, 21.4
 * Req 3.8, 3.9: Returns status to enable failed-state recovery
 */
export const checkIdempotencyKey = query({
  args: {
    key: v.string(),
    partnerId: v.string(),
  },
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query("idempotencyKeys")
      .withIndex("by_key_and_partner", (q) =>
        q.eq("key", args.key).eq("partnerId", args.partnerId)
      )
      .first();

    if (!record) return null;

    // Default missing status to "success" for backward compatibility (Req 7.5)
    return {
      ...record,
      status: record.status ?? ("success" as const),
    };
  },
});

/**
 * Store an idempotency key record after a mutation completes.
 * Keys expire after 24 hours (86400000 ms).
 * The `status` field tracks whether the mutation succeeded or failed,
 * enabling failed-state recovery on retry (Req 3.8, 3.9).
 *
 * Requirements: 21.2, 21.5, 3.3, 3.8, 3.9
 */
export const storeIdempotencyKey = mutation({
  args: {
    key: v.string(),
    partnerId: v.string(),
    requestHash: v.string(),
    responseStatus: v.number(),
    responseBody: v.string(),
    // Req 3.8, 3.9: "success" for completed mutations, "failed" for mutations
    // that errored after partial side effects. Defaults to "success" if omitted.
    status: v.optional(v.union(v.literal("success"), v.literal("failed"))),
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
      status: args.status ?? "success",
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
