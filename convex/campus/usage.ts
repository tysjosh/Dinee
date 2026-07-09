/**
 * Feature: dinee-campus (Task 24.1) — Usage_Meter Convex service.
 *
 * The thin Convex layer that wraps the pure, property-tested Usage_Meter gates
 * in `./logic/usage.ts` with the persistence (`campusUsage`), agent counting
 * (`campusAgents`), and — critically — the real account-tier resolution read
 * from the existing `subscriptions` table. Every non-trivial decision is
 * delegated to the pure functions so the same rules the property tests exercise
 * (Property 33 usage gates, Property 34 near-limit) are the rules enforced at
 * runtime.
 *
 * Exposed functions (design → `convex/campus/usage.ts`):
 *   - `getUsage`         (query)    — current calendar-month counts vs. the
 *     owner's tier limits, plus the per-dimension near-limit warnings
 *     (Req 13.1, 13.2).
 *   - `canCreateAgent`   (query)    — agent-count gate for the authenticated
 *     owner (Req 4.5).
 *   - `canUploadDocument`(query)    — layered document-size + upload-count gate
 *     for the authenticated owner (Req 5.7, 13.1).
 *   - `canStartCall`     (query)    — call-minutes gate for a Campus_Agent's
 *     owning account, read before a Caller starts a conversation (Req 13.6,
 *     13.7).
 *   - `recordCallMinutes`(mutation) — increments the owning account's
 *     calendar-month call-minutes usage when a call ends (Req 13.6, 13.7).
 *
 * Tier + upgrades. Limits are derived from the owner's `subscriptions` tier via
 * {@link resolveOwnerTier}: an account with an `active`/`trialing` subscription
 * is treated as `paid` (concrete paid quotas are provisioned from the
 * subscription), otherwise the strict free-tier limits apply (free: 1 agent, 5
 * document uploads, 30 call minutes / calendar month). Upgrades flow through the
 * EXISTING checkout + webhook path — this service performs no billing itself; it
 * only READS the subscription the webhook maintains, so on payment confirmation
 * `getUsage` reflects the new tier without any Campus-specific billing code
 * (Req 13.4, 13.5).
 */

import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";

import type { AccountTier } from "./logic/knowledge";
import {
  canCreateAgent as evaluateCreateAgentGate,
  canUploadDocument as evaluateUploadGate,
  canStartCall as evaluateCallStartGate,
  resolveTierLimits,
  nearLimitDimensions,
  type UsageSnapshot,
} from "./logic/usage";

type AnyCtx = QueryCtx | MutationCtx;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Resolves the authenticated user's id, or throws when unauthenticated. */
async function requireUserId(ctx: AnyCtx): Promise<string> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Unauthorized: authentication required");
  }
  return userId as unknown as string;
}

/** The calendar-month period key (`YYYY-MM`, UTC) for a timestamp (Req 13.1). */
function periodKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 7);
}

/** Loads a Campus_Agent by its public `agentId`, or null when absent. */
async function getAgentById(
  ctx: AnyCtx,
  agentId: string
): Promise<Doc<"campusAgents"> | null> {
  return await ctx.db
    .query("campusAgents")
    .withIndex("by_agent_id", (q) => q.eq("agentId", agentId))
    .first();
}

/** Reads an owner's usage row for a calendar-month period, or null when absent. */
async function getUsageRow(
  ctx: AnyCtx,
  ownerId: string,
  period: string
): Promise<Doc<"campusUsage"> | null> {
  return await ctx.db
    .query("campusUsage")
    .withIndex("by_owner_and_period", (q) =>
      q.eq("ownerId", ownerId).eq("period", period)
    )
    .first();
}

/**
 * Counts the Campus_Agents an owner currently holds, excluding deleted ones
 * (the live source of truth for the agent-count Usage_Limit, Req 4.5).
 */
async function countOwnedAgents(ctx: AnyCtx, ownerId: string): Promise<number> {
  const owned = await ctx.db
    .query("campusAgents")
    .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
    .collect();
  return owned.filter((a) => a.status !== "deleted").length;
}

/**
 * Resolves the owning Student_Creator's account tier from the EXISTING
 * `subscriptions` table (Req 13.1, 13.4). This is the single tier-resolution
 * seam reused by the Creation_Service and Knowledge_Store so all Campus gates
 * agree on the owner's tier.
 *
 * `ownerId` (as stored on `campusAgents.ownerId` / `campusUsage.ownerId`) may
 * hold either the auth row id (`users._id`) or the app `userId`, so the owner's
 * user record is resolved by either, and every id/tenant key that could carry a
 * subscription (`restaurantId` on `subscriptions` is a generic account key) is
 * checked. The account is `paid` iff any matching subscription is currently
 * `active` or `trialing`; otherwise the strict free tier applies. Because this
 * only reads the subscription the billing webhook maintains, an upgrade
 * confirmed through the existing checkout + webhook path raises the tier here
 * with no Campus-specific billing code (Req 13.4, 13.5).
 */
export async function resolveOwnerTier(
  ctx: AnyCtx,
  ownerId: string
): Promise<AccountTier> {
  const accountKeys = new Set<string>([ownerId]);

  // Resolve the owner's user record whether ownerId is a users._id or userId.
  const normalized = ctx.db.normalizeId("users", ownerId);
  let userDoc: Doc<"users"> | null = normalized ? await ctx.db.get(normalized) : null;
  if (!userDoc) {
    userDoc = await ctx.db
      .query("users")
      .withIndex("by_user_id", (q) => q.eq("userId", ownerId))
      .first();
  }
  if (userDoc) {
    accountKeys.add(userDoc._id);
    if (userDoc.userId) accountKeys.add(userDoc.userId);
    if (userDoc.tenantId) accountKeys.add(userDoc.tenantId);
  }

  for (const key of accountKeys) {
    const subs = await ctx.db
      .query("subscriptions")
      .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", key))
      .collect();
    const hasPaid = subs.some(
      (s) => s.status === "active" || s.status === "trialing"
    );
    if (hasPaid) {
      return "paid";
    }
  }
  return "free";
}

// ---------------------------------------------------------------------------
// getUsage — calendar-month counts vs. tier limits (Req 13.1, 13.2)
// ---------------------------------------------------------------------------

/**
 * Returns the authenticated owner's current calendar-month usage across all
 * metered dimensions (agents counted live, document uploads and call minutes
 * from the monthly `campusUsage` row), the applicable tier limits, and the set
 * of dimensions currently in the near-limit band (≥ 80% of and below the limit)
 * (Req 13.1, 13.2). Agent count is always the live count from `campusAgents`;
 * the monthly counters default to zero before the first metered action.
 */
export const getUsage = query({
  args: {},
  handler: async (ctx) => {
    const ownerId = await requireUserId(ctx);
    const tier = await resolveOwnerTier(ctx, ownerId);
    const limits = resolveTierLimits(tier);
    const period = periodKey(Date.now());

    const usageRow = await getUsageRow(ctx, ownerId, period);
    const usage: UsageSnapshot = {
      agents: await countOwnedAgents(ctx, ownerId),
      documentUploads: usageRow?.documentUploadsUsed ?? 0,
      callMinutes: usageRow?.callMinutesUsed ?? 0,
    };

    return {
      tier,
      period,
      usage,
      limits,
      nearLimit: nearLimitDimensions(usage, tier),
    };
  },
});

// ---------------------------------------------------------------------------
// canCreateAgent — agent-count gate (Req 4.5)
// ---------------------------------------------------------------------------

/**
 * Decides whether the authenticated owner may create another Campus_Agent
 * (Req 4.5). Permitted iff the live (non-deleted) agent count is strictly below
 * the tier's agent limit; otherwise blocked with the applicable limit and an
 * upgrade option, delegated to the pure gate.
 */
export const canCreateAgent = query({
  args: {},
  handler: async (ctx) => {
    const ownerId = await requireUserId(ctx);
    const tier = await resolveOwnerTier(ctx, ownerId);
    const agentCount = await countOwnedAgents(ctx, ownerId);
    return evaluateCreateAgentGate(agentCount, tier);
  },
});

// ---------------------------------------------------------------------------
// canUploadDocument — layered size + upload-count gate (Req 5.7, 13.1)
// ---------------------------------------------------------------------------

/**
 * Decides whether the authenticated owner may upload a document of the given
 * size (Req 5.7, 13.1). Delegates to the pure `canUploadDocument`, which
 * enforces, in order: the 20 MB platform maximum, the per-tier per-document
 * limit (free tier: 10 MB), then the monthly upload-count Usage_Limit. The
 * applicable per-tier size limit is returned on every outcome so the client can
 * surface the correct bound before uploading.
 */
export const canUploadDocument = query({
  args: { sizeBytes: v.number() },
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const tier = await resolveOwnerTier(ctx, ownerId);
    const period = periodKey(Date.now());
    const usageRow = await getUsageRow(ctx, ownerId, period);
    const uploadCount = usageRow?.documentUploadsUsed ?? 0;
    return evaluateUploadGate(uploadCount, args.sizeBytes, tier);
  },
});

// ---------------------------------------------------------------------------
// canStartCall — call-minutes gate (Req 13.6, 13.7)
// ---------------------------------------------------------------------------

/** Discriminated outcome of `canStartCall` (annotated to break inference). */
type CanStartCallResult =
  | { allowed: true }
  | { allowed: false; reason: "agent_not_found" }
  | {
      allowed: false;
      reason: "call_minutes_exhausted";
      limit: number;
      unavailable: true;
    };

/**
 * Decides whether a Caller may start a voice conversation with a Campus_Agent,
 * gated on the OWNING account's calendar-month call-minutes usage (Req 13.6,
 * 13.7). Resolved by the agent's public id (the Caller need not own the agent).
 * Permitted iff the owner's call-minutes usage is strictly below the tier
 * limit; when exhausted the pure gate declines with a "temporarily unavailable"
 * indication and no configuration/data is touched. An unknown agent is declined
 * with `agent_not_found`.
 */
export const canStartCall = query({
  args: { agentId: v.string() },
  handler: async (ctx, args): Promise<CanStartCallResult> => {
    const agent = await getAgentById(ctx, args.agentId);
    if (!agent) {
      return { allowed: false, reason: "agent_not_found" };
    }
    const tier = await resolveOwnerTier(ctx, agent.ownerId);
    const period = periodKey(Date.now());
    const usageRow = await getUsageRow(ctx, agent.ownerId, period);
    const callMinutesUsed = usageRow?.callMinutesUsed ?? 0;
    return evaluateCallStartGate(callMinutesUsed, tier);
  },
});

// ---------------------------------------------------------------------------
// recordCallMinutes — increment monthly usage on call end (Req 13.6, 13.7)
// ---------------------------------------------------------------------------

/**
 * Increments a Campus_Agent's OWNING account calendar-month call-minutes usage
 * when a call ends (Req 13.6, 13.7). Called by the Voice_Runtime with the
 * completed call's billable minutes; negative values are clamped to zero so a
 * bad input can never decrement the meter. Upserts the owner's monthly
 * `campusUsage` row and returns the new call-minutes total for the period.
 */
export const recordCallMinutes = mutation({
  args: { agentId: v.string(), minutes: v.number() },
  handler: async (ctx, args) => {
    const agent = await getAgentById(ctx, args.agentId);
    if (!agent) {
      throw new Error("Agent not found");
    }
    const minutes = Number.isFinite(args.minutes) ? Math.max(0, args.minutes) : 0;
    const now = Date.now();
    const period = periodKey(now);

    const existing = await getUsageRow(ctx, agent.ownerId, period);
    if (existing) {
      const callMinutesUsed = existing.callMinutesUsed + minutes;
      await ctx.db.patch(existing._id, { callMinutesUsed, updatedAt: now });
      return { ok: true as const, period, callMinutesUsed };
    }

    await ctx.db.insert("campusUsage", {
      ownerId: agent.ownerId,
      period,
      callMinutesUsed: minutes,
      documentUploadsUsed: 0,
      agentCount: 0,
      updatedAt: now,
    });
    return { ok: true as const, period, callMinutesUsed: minutes };
  },
});
