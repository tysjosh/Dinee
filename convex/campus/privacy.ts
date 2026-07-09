/**
 * Feature: dinee-campus (Task 23.1) — Privacy_Controls Convex service.
 *
 * The thin Convex layer that wraps the Campus privacy/visibility settings, call
 * history deletion, the Creator_Page visibility setting, and Private_Link
 * management. Every ownership check funnels through {@link requireOwnedAgent}
 * (matching the `Share_Service` / `Safety_Service` convention), Private_Link
 * tokens are minted with the shared CSPRNG token helper so they are unguessable
 * and high-entropy, and every mutation returns a discriminated result object.
 *
 * Exposed functions (design → `convex/campus/privacy.ts`):
 *   - `setVisibility`            (mutation) — set an owned agent's Visibility to
 *     public/private; the change is reflected in Discovery_Service listings
 *     immediately because discovery reads the live `status`/`visibility`
 *     (Req 12.1).
 *   - `setRecordingEnabled`      (mutation) — set whether calls are recorded;
 *     applies only to future calls because the Voice_Runtime snapshots the
 *     setting into the `calls` row at call start (Req 12.5).
 *   - `setSummariesEnabled`      (mutation) — set whether call summaries are
 *     generated; applies only to future calls for the same reason (Req 12.6).
 *   - `deleteCallHistory`        (mutation) — delete an owned agent's recorded
 *     call history (analytics events, ratings, call clips, and the pre-aggregated
 *     daily rollups); a deletion failure retains the data unchanged and returns
 *     `deletion_failed` (Req 12.2, 12.4).
 *   - `setCreatorPageVisibility` (mutation) — set the Student_Creator's
 *     Creator_Page to public/hidden (Req 15.16).
 *   - `issuePrivateLink`         (mutation) — owner-only: mint an active
 *     Private_Link token for a private agent (Req 6.10).
 *   - `rotatePrivateLink`        (mutation) — owner-only: revoke every currently
 *     active token and issue a new active token in one mutation, so a Caller
 *     presenting the previous token is denied while the new token grants access
 *     (Req 6.11, 6.12).
 *   - `revokePrivateLink`        (mutation) — owner-only: set the active
 *     token(s) to revoked so they are denied thereafter (Req 6.12).
 */

import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { getCurrentUserRecord } from "../shared/ownership";
import { generateSecureToken } from "../tokenHash";
import { buildCallLink } from "./logic/share";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** The platform base URL used to build absolute Call_Links (Req 6.10, 7.1). */
function platformBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined) ??
    "https://dinee.app"
  ).replace(/\/+$/, "");
}

/** Loads a Campus_Agent by its public `agentId`, or null when absent. */
async function getAgentById(
  ctx: MutationCtx,
  agentId: string
): Promise<Doc<"campusAgents"> | null> {
  return await ctx.db
    .query("campusAgents")
    .withIndex("by_agent_id", (q) => q.eq("agentId", agentId))
    .first();
}

/**
 * Resolves the authenticated caller and the requested Campus_Agent, asserting
 * the caller owns the agent. Throws (fail-closed) on missing auth, an unknown
 * agent, or a non-owner. `ownerId` may hold either the auth row id (`_id`) or
 * the app `userId`, so both are accepted (matching the Share_Service /
 * Knowledge_Store convention).
 */
async function requireOwnedAgent(
  ctx: MutationCtx,
  agentId: string
): Promise<{ user: Doc<"users">; agent: Doc<"campusAgents"> }> {
  const user = await getCurrentUserRecord(ctx);
  if (!user) {
    throw new Error("Unauthorized: authentication required");
  }
  const agent = await getAgentById(ctx, agentId);
  if (!agent) {
    throw new Error("Agent not found");
  }
  const ownsAgent =
    agent.ownerId === user._id ||
    (Boolean(user.userId) && agent.ownerId === user.userId);
  if (!ownsAgent) {
    throw new Error("Forbidden: you do not own this Campus_Agent");
  }
  return { user, agent };
}

/** Builds an absolute Private_Link URL: the Call_Link plus the access token. */
function buildPrivateLink(slug: string, token: string): string {
  return `${buildCallLink(slug, platformBaseUrl())}?token=${token}`;
}

/**
 * Generates an unguessable, high-entropy Private_Link token (Req 6.10). Reuses
 * the shared CSPRNG token helper (`crypto.getRandomValues`) — 32 random bytes /
 * 64 hex characters — so tokens cannot be guessed or enumerated.
 */
function newPrivateLinkToken(): string {
  return generateSecureToken(32);
}

/** Loads every Private_Link row for an agent (any status). */
async function getPrivateLinks(
  ctx: MutationCtx,
  agentId: string
): Promise<Doc<"campusPrivateLinks">[]> {
  return await ctx.db
    .query("campusPrivateLinks")
    .withIndex("by_agent_id", (q) => q.eq("agentId", agentId))
    .collect();
}

/**
 * Revokes every currently active Private_Link token for an agent, returning the
 * number of tokens revoked. Shared by `rotatePrivateLink` and
 * `revokePrivateLink` so the invalidation semantics stay identical (Req 6.12).
 */
async function revokeActiveTokens(
  ctx: MutationCtx,
  agentId: string
): Promise<number> {
  const active = await ctx.db
    .query("campusPrivateLinks")
    .withIndex("by_agent_and_status", (q) =>
      q.eq("agentId", agentId).eq("status", "active")
    )
    .collect();
  const revokedAt = Date.now();
  for (const link of active) {
    await ctx.db.patch(link._id, { status: "revoked", revokedAt });
  }
  return active.length;
}

/** Inserts a new active Private_Link token row and returns the token. */
async function issueToken(
  ctx: MutationCtx,
  agentId: string
): Promise<string> {
  const token = newPrivateLinkToken();
  await ctx.db.insert("campusPrivateLinks", {
    linkId: `PLK_${crypto.randomUUID()}`,
    agentId,
    token,
    status: "active",
    createdAt: Date.now(),
  });
  return token;
}

// ---------------------------------------------------------------------------
// getAgentSettings — owner-gated read of the current privacy settings
// ---------------------------------------------------------------------------

/** Discriminated outcome of `getAgentSettings`. */
type GetAgentSettingsResult =
  | { authorized: false; error: "unauthorized" }
  | {
      authorized: true;
      settings: {
        agentId: string;
        name: string;
        agentType: Doc<"campusAgents">["agentType"];
        status: Doc<"campusAgents">["status"];
        slug: string;
        visibility: "public" | "private";
        /** Effective recording setting — undefined is treated as off (see session.ts). */
        recordingEnabled: boolean;
        /** Effective summary setting — undefined is treated as off (see session.ts). */
        summariesEnabled: boolean;
        hasMonetizationLink: boolean;
      };
    };

/**
 * Returns the owner-gated privacy settings for a Campus_Agent so the
 * settings/privacy surface can render the current toggle states (visibility,
 * recording, summaries) before the owner changes them (Req 12.1, 12.5, 12.6).
 *
 * Access is granted only to the agent's owner; every other case — anonymous, a
 * non-owner, a missing agent, or a deleted agent — is denied as `unauthorized`
 * and discloses nothing (mirroring the analytics owner-gate). Unlike the
 * owner-only mutations, this read returns a discriminated result rather than
 * throwing so the page can render a graceful unauthorized state. The
 * recording/summary defaults follow the Voice_Runtime convention that an unset
 * value means "off" (`=== true`).
 */
export const getAgentSettings = query({
  args: { agentId: v.string() },
  handler: async (ctx, args): Promise<GetAgentSettingsResult> => {
    const user = await getCurrentUserRecord(ctx);
    if (!user) {
      return { authorized: false, error: "unauthorized" };
    }
    const agent = await ctx.db
      .query("campusAgents")
      .withIndex("by_agent_id", (q) => q.eq("agentId", args.agentId))
      .first();
    if (!agent || agent.status === "deleted") {
      return { authorized: false, error: "unauthorized" };
    }
    const ownsAgent =
      agent.ownerId === user._id ||
      (Boolean(user.userId) && agent.ownerId === user.userId);
    if (!ownsAgent) {
      return { authorized: false, error: "unauthorized" };
    }

    return {
      authorized: true,
      settings: {
        agentId: agent.agentId,
        name: agent.name,
        agentType: agent.agentType,
        status: agent.status,
        slug: agent.slug,
        visibility: agent.visibility,
        recordingEnabled: agent.recordingEnabled === true,
        summariesEnabled: agent.summariesEnabled === true,
        hasMonetizationLink:
          typeof agent.monetizationLink === "string" &&
          agent.monetizationLink.length > 0,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// 12.1 — Visibility
// ---------------------------------------------------------------------------

/**
 * Sets an owned Campus_Agent's Visibility to public or private (Req 12.1).
 * Because the Discovery_Service lists agents from their live `status` +
 * `visibility`, a change here is reflected in discovery on the next read (well
 * within the 5s bound). Owner-only.
 */
export const setVisibility = mutation({
  args: {
    agentId: v.string(),
    visibility: v.union(v.literal("public"), v.literal("private")),
  },
  handler: async (ctx, args) => {
    const { agent } = await requireOwnedAgent(ctx, args.agentId);
    if (agent.status === "deleted") {
      throw new Error("Agent has been deleted");
    }
    await ctx.db.patch(agent._id, {
      visibility: args.visibility,
      updatedAt: Date.now(),
    });
    return {
      ok: true as const,
      agentId: agent.agentId,
      visibility: args.visibility,
    };
  },
});

// ---------------------------------------------------------------------------
// 12.5 / 12.6 — Recording & summary settings (future calls only)
// ---------------------------------------------------------------------------

/**
 * Sets whether calls to an owned Campus_Agent are recorded (Req 12.5). The
 * setting applies only to voice conversations started after the change: the
 * Voice_Runtime snapshots the effective value into the `calls` row at call
 * start, so calls already started retain their snapshot and are unaffected.
 * Owner-only.
 */
export const setRecordingEnabled = mutation({
  args: { agentId: v.string(), enabled: v.boolean() },
  handler: async (ctx, args) => {
    const { agent } = await requireOwnedAgent(ctx, args.agentId);
    if (agent.status === "deleted") {
      throw new Error("Agent has been deleted");
    }
    await ctx.db.patch(agent._id, {
      recordingEnabled: args.enabled,
      updatedAt: Date.now(),
    });
    return {
      ok: true as const,
      agentId: agent.agentId,
      recordingEnabled: args.enabled,
    };
  },
});

/**
 * Sets whether call summaries are generated for an owned Campus_Agent
 * (Req 12.6). As with recording, the setting applies only to voice
 * conversations started after the change because the effective value is
 * snapshotted at call start. Owner-only.
 */
export const setSummariesEnabled = mutation({
  args: { agentId: v.string(), enabled: v.boolean() },
  handler: async (ctx, args) => {
    const { agent } = await requireOwnedAgent(ctx, args.agentId);
    if (agent.status === "deleted") {
      throw new Error("Agent has been deleted");
    }
    await ctx.db.patch(agent._id, {
      summariesEnabled: args.enabled,
      updatedAt: Date.now(),
    });
    return {
      ok: true as const,
      agentId: agent.agentId,
      summariesEnabled: args.enabled,
    };
  },
});

// ---------------------------------------------------------------------------
// 12.2 / 12.4 — Delete call history
// ---------------------------------------------------------------------------

/** Discriminated outcome of `deleteCallHistory`. */
type DeleteCallHistoryResult =
  | {
      ok: true;
      agentId: string;
      deleted: {
        events: number;
        ratings: number;
        clips: number;
        analyticsDaily: number;
      };
    }
  | { ok: false; error: "deletion_failed" };

/**
 * Deletes the recorded call history for an owned Campus_Agent (Req 12.2). The
 * call history is the agent's raw analytics events (`campusEvents`), per-call
 * ratings (`campusRatings`), shareable Call_Clips (`campusCallClips`), and the
 * pre-aggregated daily rollups (`campusAnalyticsDaily`) derived from those
 * calls. Owner-only.
 *
 * If deletion cannot complete, the affected data is retained unchanged and
 * `deletion_failed` is returned (Req 12.4). A Convex mutation is a single
 * transaction, so the reads are performed first and the deletes are the only
 * writes: an error surfaced from a delete rolls the transaction back, leaving
 * every row intact, and the handler reports `deletion_failed` to the caller.
 */
export const deleteCallHistory = mutation({
  args: { agentId: v.string() },
  handler: async (ctx, args): Promise<DeleteCallHistoryResult> => {
    const { agent } = await requireOwnedAgent(ctx, args.agentId);

    // Gather every call-history row up front (reads only).
    const [events, ratings, clips, analyticsDaily] = await Promise.all([
      ctx.db
        .query("campusEvents")
        .withIndex("by_agent_id", (q) => q.eq("agentId", agent.agentId))
        .collect(),
      ctx.db
        .query("campusRatings")
        .withIndex("by_agent_id", (q) => q.eq("agentId", agent.agentId))
        .collect(),
      ctx.db
        .query("campusCallClips")
        .withIndex("by_agent_id", (q) => q.eq("agentId", agent.agentId))
        .collect(),
      ctx.db
        .query("campusAnalyticsDaily")
        .withIndex("by_agent_and_day", (q) => q.eq("agentId", agent.agentId))
        .collect(),
    ]);

    try {
      for (const row of events) await ctx.db.delete(row._id);
      for (const row of ratings) await ctx.db.delete(row._id);
      for (const row of clips) await ctx.db.delete(row._id);
      for (const row of analyticsDaily) await ctx.db.delete(row._id);
    } catch {
      // Deletion did not complete — the transaction rolls back so the affected
      // data is retained unchanged (Req 12.4).
      return { ok: false, error: "deletion_failed" };
    }

    return {
      ok: true,
      agentId: agent.agentId,
      deleted: {
        events: events.length,
        ratings: ratings.length,
        clips: clips.length,
        analyticsDaily: analyticsDaily.length,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// 15.16 — Creator_Page visibility
// ---------------------------------------------------------------------------

/**
 * Sets the authenticated Student_Creator's Creator_Page visibility to public or
 * hidden (Req 15.16). The setting is stored on the user's own record and the
 * Creator_Page gate resolves an absent setting as `hidden`. Requires an
 * authenticated user (each creator controls only their own page).
 */
export const setCreatorPageVisibility = mutation({
  args: {
    visibility: v.union(v.literal("public"), v.literal("hidden")),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserRecord(ctx);
    if (!user) {
      throw new Error("Unauthorized: authentication required");
    }
    await ctx.db.patch(user._id, {
      creatorPageVisibility: args.visibility,
    });
    return { ok: true as const, visibility: args.visibility };
  },
});

// ---------------------------------------------------------------------------
// 6.10 / 6.11 / 6.12 — Private_Link management (owner-only)
// ---------------------------------------------------------------------------

/** Discriminated outcome of `issuePrivateLink`. */
type IssuePrivateLinkResult =
  | {
      ok: true;
      agentId: string;
      token: string;
      privateLink: string;
    }
  | { ok: false; reason: "agent_not_private" };

/**
 * Mints an active Private_Link token for an owned, private Campus_Agent
 * (Req 6.10). A Private_Link only authorizes access to a private agent, so this
 * returns `agent_not_private` when the agent's Visibility is public (a public
 * agent is already accessible to everyone). The returned token is an
 * unguessable, high-entropy value and the response carries the ready-to-share
 * Private_Link (Call_Link + `?token=`). Owner-only.
 */
export const issuePrivateLink = mutation({
  args: { agentId: v.string() },
  handler: async (ctx, args): Promise<IssuePrivateLinkResult> => {
    const { agent } = await requireOwnedAgent(ctx, args.agentId);
    if (agent.status === "deleted") {
      throw new Error("Agent has been deleted");
    }
    if (agent.visibility !== "private") {
      return { ok: false, reason: "agent_not_private" };
    }

    const token = await issueToken(ctx, agent.agentId);
    return {
      ok: true,
      agentId: agent.agentId,
      token,
      privateLink: buildPrivateLink(agent.slug, token),
    };
  },
});

/** Discriminated outcome of `rotatePrivateLink`. */
type RotatePrivateLinkResult =
  | {
      ok: true;
      agentId: string;
      token: string;
      privateLink: string;
      revokedCount: number;
    }
  | { ok: false; reason: "agent_not_private" };

/**
 * Rotates an owned, private Campus_Agent's Private_Link in a single mutation
 * (Req 6.11, 6.12): every currently active token is revoked and a fresh active
 * token is issued. Because the revoke-then-issue happens atomically, a Caller
 * presenting the previous token is denied thereafter while the new token grants
 * access. Returns `agent_not_private` for a public agent. Owner-only.
 */
export const rotatePrivateLink = mutation({
  args: { agentId: v.string() },
  handler: async (ctx, args): Promise<RotatePrivateLinkResult> => {
    const { agent } = await requireOwnedAgent(ctx, args.agentId);
    if (agent.status === "deleted") {
      throw new Error("Agent has been deleted");
    }
    if (agent.visibility !== "private") {
      return { ok: false, reason: "agent_not_private" };
    }

    const revokedCount = await revokeActiveTokens(ctx, agent.agentId);
    const token = await issueToken(ctx, agent.agentId);
    return {
      ok: true,
      agentId: agent.agentId,
      token,
      privateLink: buildPrivateLink(agent.slug, token),
      revokedCount,
    };
  },
});

/**
 * Revokes an owned Campus_Agent's Private_Link token(s) so a Caller presenting
 * a revoked token is denied thereafter (Req 6.12). When a specific `token` is
 * supplied, only that token (which must belong to the agent) is revoked;
 * otherwise every currently active token for the agent is revoked. Owner-only.
 */
export const revokePrivateLink = mutation({
  args: { agentId: v.string(), token: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { agent } = await requireOwnedAgent(ctx, args.agentId);

    if (args.token !== undefined) {
      const links = await getPrivateLinks(ctx, agent.agentId);
      const match = links.find((l) => l.token === args.token);
      if (!match) {
        return { ok: false as const, reason: "token_not_found" as const };
      }
      if (match.status === "active") {
        await ctx.db.patch(match._id, {
          status: "revoked",
          revokedAt: Date.now(),
        });
      }
      return {
        ok: true as const,
        agentId: agent.agentId,
        revokedCount: match.status === "active" ? 1 : 0,
      };
    }

    const revokedCount = await revokeActiveTokens(ctx, agent.agentId);
    return { ok: true as const, agentId: agent.agentId, revokedCount };
  },
});
