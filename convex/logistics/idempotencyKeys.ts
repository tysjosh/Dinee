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

    // Upsert: finalize the "pending" reservation created by
    // reserveIdempotencyKey (patch in place) rather than inserting a duplicate.
    // Falls back to insert for callers that store without reserving first.
    const existing = await ctx.db
      .query("idempotencyKeys")
      .withIndex("by_key_and_partner", (q) =>
        q.eq("key", args.key).eq("partnerId", args.partnerId)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        requestHash: args.requestHash,
        responseStatus: args.responseStatus,
        responseBody: args.responseBody,
        status: args.status ?? "success",
        expiresAt: now + TTL_MS,
      });
      return;
    }

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
 * Atomically reserve an idempotency key BEFORE the caller runs any side
 * effects. The check-and-insert happens inside a single Convex mutation
 * transaction, so two concurrent requests with the same (key, partnerId) can
 * never both proceed — Convex's optimistic concurrency serializes them and the
 * loser observes the winner's reservation.
 *
 * Outcomes:
 *  - "reserved":    key was free (or a prior "failed" attempt) — a "pending"
 *                   record is written and the caller MUST proceed, then finalize
 *                   via storeIdempotencyKey (success) / failed state.
 *  - "in_progress": a "pending" record with the same request hash exists — a
 *                   concurrent duplicate is mid-flight; caller should return 409.
 *  - "replay":      a "success" record with the same hash exists — caller
 *                   returns the stored response.
 *  - "mismatch":    a record with a different request hash exists — 422.
 *
 * Requirements: 21.1–21.4, 3.8, 3.9, and Req 8 (atomic check-and-insert).
 */
export const reserveIdempotencyKey = mutation({
  args: {
    key: v.string(),
    partnerId: v.string(),
    requestHash: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const TTL_MS = 86_400_000; // 24 hours

    const existing = await ctx.db
      .query("idempotencyKeys")
      .withIndex("by_key_and_partner", (q) =>
        q.eq("key", args.key).eq("partnerId", args.partnerId)
      )
      .first();

    if (!existing) {
      await ctx.db.insert("idempotencyKeys", {
        key: args.key,
        partnerId: args.partnerId,
        requestHash: args.requestHash,
        responseStatus: 0,
        responseBody: "",
        status: "pending",
        createdAt: now,
        expiresAt: now + TTL_MS,
      });
      return { outcome: "reserved" as const };
    }

    const status = existing.status ?? "success";

    // A prior attempt failed — allow re-execution by re-reserving.
    if (status === "failed") {
      await ctx.db.patch(existing._id, {
        requestHash: args.requestHash,
        responseStatus: 0,
        responseBody: "",
        status: "pending",
        expiresAt: now + TTL_MS,
      });
      return { outcome: "reserved" as const };
    }

    // Another request holds the reservation and hasn't finalized yet.
    if (status === "pending") {
      return {
        outcome:
          existing.requestHash === args.requestHash
            ? ("in_progress" as const)
            : ("mismatch" as const),
      };
    }

    // status === "success"
    if (existing.requestHash === args.requestHash) {
      return {
        outcome: "replay" as const,
        responseStatus: existing.responseStatus,
        responseBody: existing.responseBody,
      };
    }

    return { outcome: "mismatch" as const };
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
