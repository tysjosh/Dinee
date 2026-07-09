/**
 * Feature: dinee-campus (Task 8 gap-fix) — call-rating persistence.
 *
 * The thin Convex layer that persists a Caller's post-call rating for a
 * Campus_Agent, wrapping the pure rating validator in
 * `convex/campus/logic/validation.ts`. This closes the runtime gap where the
 * `CallExperience` surface captured a 1–5 rating in the UI but had no mutation
 * to store it, leaving `campusRatings` empty and the Analytics_Dashboard's
 * average-rating with no data source.
 *
 * Covered behaviors:
 *   - 8.10: a valid integer rating 1..5 is associated with the completed call
 *     (recorded on `campusRatings`, keyed to the `callId`).
 *   - 8.11: a rating that is not an integer 1..5 is rejected with an indication
 *     that the rating must be an integer from 1 to 5.
 *
 * Callers may be anonymous (any person can call a published agent and rate the
 * call), so no authentication is required — mirroring `submitReport`. The rating
 * is idempotent per call: re-submitting for the same `callId` updates the
 * existing row rather than inserting a duplicate, so a Caller's rating counts
 * once toward the agent's average.
 */

import { v } from "convex/values";
import { mutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import { isValidCallRating, RATING_MIN, RATING_MAX } from "./logic/validation";

/** Discriminated outcome of `submitRating`. */
type SubmitRatingResult =
  | { ok: true; rating: number }
  | { ok: false; reason: "invalid_rating"; min: number; max: number }
  | { ok: false; reason: "agent_mismatch" };

/** Loads a `calls` row by its `callId`, or null when absent. */
async function getCallByCallId(ctx: MutationCtx, callId: string) {
  return await ctx.db
    .query("calls")
    .withIndex("by_call_and_order_id", (q) => q.eq("callId", callId))
    .first();
}

/**
 * Records a Caller's rating for a completed Campus_Agent call (Req 8.10, 8.11).
 *
 * The rating is validated by the pure {@link isValidCallRating}: a value that is
 * not an integer from 1 to 5 inclusive is rejected with `invalid_rating`
 * (Req 8.11) and nothing is written. A valid rating is associated with the
 * completed call by its `callId`. The `calls` row is written server-side by the
 * Voice_Runtime, so a not-yet-present row is not an error; when the row exists
 * and carries a `campusAgentId`, that id must match the supplied `agentId` so a
 * rating cannot be attributed to the wrong agent (Req 8.10). Idempotent per
 * `callId`: an existing rating for
 * the same call is updated in place (each Caller's call counts once toward the
 * average), otherwise a new `campusRatings` row is inserted.
 */
export const submitRating = mutation({
  args: {
    agentId: v.string(),
    callId: v.string(),
    rating: v.number(),
  },
  handler: async (ctx, args): Promise<SubmitRatingResult> => {
    // Req 8.11: reject anything that is not an integer 1..5, writing nothing.
    if (!isValidCallRating(args.rating)) {
      return {
        ok: false,
        reason: "invalid_rating",
        min: RATING_MIN,
        max: RATING_MAX,
      };
    }

    // Req 8.10: associate the rating with the call via `callId`. The `calls`
    // row itself is written server-side by the Voice_Runtime (ws-server) media
    // path, which may lag or use a different call identifier than the browser's
    // post-call screen, so a missing row is NOT an error — the rating is still
    // recorded and associated by `callId`. When the row IS present, guard
    // against attributing the rating to the wrong agent.
    const call = await getCallByCallId(ctx, args.callId);
    if (
      call &&
      typeof call.campusAgentId === "string" &&
      call.campusAgentId.length > 0 &&
      call.campusAgentId !== args.agentId
    ) {
      return { ok: false, reason: "agent_mismatch" };
    }

    const now = Date.now();

    // Idempotent per call: update an existing rating rather than duplicating it
    // so a Caller's call counts once toward the agent's average.
    const existing = await ctx.db
      .query("campusRatings")
      .withIndex("by_call_id", (q) => q.eq("callId", args.callId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { rating: args.rating, createdAt: now });
    } else {
      await ctx.db.insert("campusRatings", {
        agentId: args.agentId,
        callId: args.callId,
        rating: args.rating,
        createdAt: now,
      });
    }

    return { ok: true, rating: args.rating };
  },
});
