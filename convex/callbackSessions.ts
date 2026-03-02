import { mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Create a new callback session with 5-minute TTL.
 * Called by /callback route to persist context for the media-stream-callback handoff.
 */
export const createSession = mutation({
  args: {
    sessionId: v.string(),
    phoneNumber: v.string(),
    reason: v.optional(v.string()),
    data: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const id = await ctx.db.insert("callbackSessions", {
      sessionId: args.sessionId,
      phoneNumber: args.phoneNumber,
      reason: args.reason,
      data: args.data,
      isCallback: true,
      createdAt: now,
      expiresAt: now + 300_000, // 5 minutes
      consumed: false,
    });
    return id;
  },
});

/**
 * Atomically read and consume a callback session by sessionId.
 * Returns the session context if found, not expired, and not already consumed.
 * Sets consumed = true to prevent re-use.
 */
export const getAndConsumeSession = mutation({
  args: {
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("callbackSessions")
      .withIndex("by_session_id", (q) => q.eq("sessionId", args.sessionId))
      .unique();

    if (!session) {
      return null;
    }

    // Already consumed or expired
    if (session.consumed || session.expiresAt < Date.now()) {
      return null;
    }

    // Mark as consumed atomically (Convex mutations are serialized per document)
    await ctx.db.patch(session._id, { consumed: true });

    return {
      phoneNumber: session.phoneNumber,
      reason: session.reason,
      data: session.data,
      isCallback: session.isCallback,
    };
  },
});

/**
 * Clean up expired callback sessions.
 * Meant to be called as a scheduled job (e.g., every few minutes).
 */
export const cleanupExpiredSessions = mutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db
      .query("callbackSessions")
      .withIndex("by_expires_at", (q) => q.lt("expiresAt", now))
      .collect();

    for (const session of expired) {
      await ctx.db.delete(session._id);
    }

    return { deleted: expired.length };
  },
});
