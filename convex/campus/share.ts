/**
 * Feature: dinee-campus (Task 20.1) — Share_Service Convex service.
 *
 * Thin Convex wrapper around the pure, property-tested slug/share/share-card/
 * call-clip core in `./logic/share.ts` and the access gate in `./logic/access.ts`.
 * This module owns persistence (Convex db + file storage) and authorization;
 * every decision (slug uniqueness, share-format/share-card assembly, the access
 * gate, and the call-clip recording+consent gate) is delegated to the pure
 * functions so the correctness properties stay directly testable.
 *
 * Exposed functions (design → `convex/campus/share.ts`):
 *   - generateCallLink   (mutation) assigns the unique Call_Link slug across all
 *                        agents; retryable, and transitions a
 *                        `publish_pending_link`/`link_failed` agent to
 *                        `published` on success (Req 7.1, 7.2, 7.9)
 *   - resolveCallLink    (query)    slug (+ optional Private_Link token) → gated
 *                        public profile + Call_Link (Req 7.6–7.9, 6.10, 6.11)
 *   - getShareFormats    (query)    copy-link, QR, SMS, IG/TikTok/Snapchat,
 *                        embed card — each link-bearing format embeds the
 *                        Call_Link (Req 7.3, 7.4, 7.5)
 *   - getShareCard       (query)    IG/TikTok/Snapchat Share_Card: name, campus
 *                        tag, agent type, "AI voice agent" label, Call_Link,
 *                        reusing the share-format assembly (Req 15.14)
 *   - generateCallClip   (action)   gated on recording + caller consent; writes
 *                        `campusCallClips` with the "AI voice agent" label +
 *                        attribution, else declines `clip_unavailable`
 *                        (Req 15.12, 15.13)
 *   - recordShare        (mutation) appends a `share` analytics event (Req 9.1)
 */

import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "../_generated/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { getCurrentUserRecord } from "../shared/ownership";

import {
  slugifyName,
  slugDisambiguator,
  buildCallLink,
  assembleShareFormats,
  assembleShareCard,
  decideCallClip,
  type ShareAgent,
  type ShareFormats,
  type ShareCard,
} from "./logic/share";
import {
  getAccessibleProfile,
  type AccessDenialCode,
  type CampusAgentRecord,
  type PrivateLinkRecord,
  type PublicProfileProjection,
} from "./logic/access";

type AnyCtx = QueryCtx | MutationCtx;

// ---------------------------------------------------------------------------
// Small internal helpers
// ---------------------------------------------------------------------------

/** The platform base URL used to build absolute Call_Links (Req 7.1, 7.6). */
function platformBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined) ??
    "https://dinee.app"
  ).replace(/\/+$/, "");
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

/** Loads a Campus_Agent by its Call_Link `slug`, or null when absent. */
async function getAgentBySlug(
  ctx: AnyCtx,
  slug: string
): Promise<Doc<"campusAgents"> | null> {
  return await ctx.db
    .query("campusAgents")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .first();
}

/**
 * Resolves the authenticated caller and the requested Campus_Agent, asserting
 * the caller owns the agent. Throws (fail-closed) on missing auth, unknown
 * agent, or a non-owner. `ownerId` may hold either the auth row id (`_id`) or
 * the app `userId`, so both are accepted (matches the schema comment and the
 * Knowledge_Store convention).
 */
async function requireOwnedAgent(
  ctx: AnyCtx,
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

/** Resolves the Private_Link token records for an agent (Req 6.10). */
async function resolvePrivateLinks(
  ctx: AnyCtx,
  agentId: string
): Promise<PrivateLinkRecord[]> {
  const rows = await ctx.db
    .query("campusPrivateLinks")
    .withIndex("by_agent_id", (q) => q.eq("agentId", agentId))
    .collect();
  return rows.map((r) => ({
    token: r.token,
    agentId: r.agentId,
    status: r.status,
  }));
}

/** Projects a stored agent row into the access-gate + projection record. */
function agentToRecord(agent: Doc<"campusAgents">): CampusAgentRecord {
  return {
    agentId: agent.agentId,
    ownerId: agent.ownerId,
    status: agent.status,
    visibility: agent.visibility,
    name: agent.name,
    creatorDisplayName: agent.creatorDisplayName,
    campusTag: agent.campusTag,
    agentType: agent.agentType,
    description: agent.description,
    previewPrompts: agent.previewPrompts,
    remixEnabled: agent.remixEnabled,
  };
}

/** Projects a stored agent row into the pure share-format identity shape. */
function agentToShareAgent(agent: Doc<"campusAgents">): ShareAgent {
  return {
    name: agent.name,
    campusTag: agent.campusTag ?? "",
    agentType: agent.agentType,
    slug: agent.slug,
  };
}

/**
 * Resolves the requester id to hand the access gate. When the authenticated
 * user owns `agent`, returns the agent's `ownerId` so the gate's owner check
 * matches regardless of whether ownership was recorded as the auth `_id` or the
 * app `userId`; otherwise returns the user's `_id` (a non-owner) or `null` when
 * anonymous. Pure w.r.t. the db (only reads the current identity).
 */
async function resolveRequesterId(
  ctx: AnyCtx,
  agent: Doc<"campusAgents"> | null
): Promise<string | null> {
  const user = await getCurrentUserRecord(ctx);
  if (!user) {
    return null;
  }
  if (
    agent &&
    (agent.ownerId === user._id ||
      (Boolean(user.userId) && agent.ownerId === user.userId))
  ) {
    return agent.ownerId;
  }
  return user._id as unknown as string;
}

/**
 * Assigns a Call_Link slug that is unique across all Campus_Agents (Req 6.8,
 * 7.1), reusing the pure slug helpers. Prefers the clean name base; on collision
 * appends a deterministic id-derived token; then an incrementing counter. The
 * current agent is excluded so re-publishing keeps a stable slug.
 */
async function assignUniqueSlug(
  ctx: MutationCtx,
  agent: Doc<"campusAgents">
): Promise<string> {
  const taken = async (candidate: string): Promise<boolean> => {
    const existing = await getAgentBySlug(ctx, candidate);
    return existing !== null && existing.agentId !== agent.agentId;
  };

  const base = slugifyName(agent.name);
  if (!(await taken(base))) {
    return base;
  }
  const disambiguated = `${base}-${slugDisambiguator(agent.agentId)}`;
  if (!(await taken(disambiguated))) {
    return disambiguated;
  }
  let counter = 2;
  let candidate = `${disambiguated}-${counter}`;
  while (await taken(candidate)) {
    counter += 1;
    candidate = `${disambiguated}-${counter}`;
  }
  return candidate;
}

/**
 * Runs the access gate for a slug/agentId (+ optional Private_Link token) and,
 * on a grant, returns the raw agent row alongside the bounded public
 * projection. On a denial NO agent content is returned (Req 6.6, 6.7). Shared by
 * `resolveCallLink`, `getShareFormats`, and `getShareCard` so access and
 * disclosure never diverge.
 */
async function gateAgentAccess(
  ctx: AnyCtx,
  args: { slug?: string; agentId?: string; token?: string }
): Promise<
  | { granted: true; agent: Doc<"campusAgents">; profile: PublicProfileProjection }
  | { granted: false; denial: AccessDenialCode }
> {
  let agent: Doc<"campusAgents"> | null = null;
  if (args.agentId) {
    agent = await getAgentById(ctx, args.agentId);
  } else if (args.slug) {
    agent = await getAgentBySlug(ctx, args.slug);
  }

  const privateLinks = agent ? await resolvePrivateLinks(ctx, agent.agentId) : [];
  const requesterId = await resolveRequesterId(ctx, agent);

  const result = getAccessibleProfile({
    agent: agent ? agentToRecord(agent) : null,
    requesterId,
    token: args.token,
    privateLinks,
  });
  if (!result.granted) {
    return result;
  }
  // `granted` implies `agent` is non-null (the gate returns `invalid` otherwise).
  return { granted: true, agent: agent!, profile: result.profile };
}

// ---------------------------------------------------------------------------
// generateCallLink — unique slug + link_failed → published (Req 7.1, 7.2, 7.9)
// ---------------------------------------------------------------------------

/** Discriminated outcome of `generateCallLink`. */
type GenerateCallLinkResult =
  | {
      status: "call_link_ready";
      agentId: string;
      slug: string;
      callLink: string;
      publishState: Doc<"campusAgents">["status"];
    }
  | { status: "call_link_failed"; agentId: string };

/**
 * Assigns the unique Call_Link slug for an owned Campus_Agent (Req 7.1). This is
 * the retryable Call_Link step of the Publish_State machine: when the agent is
 * awaiting a link (`publish_pending_link`) or a previous attempt failed
 * (`link_failed`), a successful slug assignment transitions it to `published`
 * (discoverable + callable) and stamps `publishedAt` (Req 7.2, 7.9). For an
 * already-`published` agent the slug is (re)assigned without changing state; the
 * current agent is excluded from the uniqueness check so its slug stays stable.
 * On failure the agent is moved to `link_failed` (not discoverable/callable) and
 * `call_link_failed` is returned so the caller can retry.
 */
export const generateCallLink = mutation({
  args: { agentId: v.string() },
  handler: async (ctx, args): Promise<GenerateCallLinkResult> => {
    const { agent } = await requireOwnedAgent(ctx, args.agentId);
    if (agent.status === "deleted") {
      throw new Error("Agent has been deleted");
    }

    let slug: string;
    try {
      slug = await assignUniqueSlug(ctx, agent);
    } catch {
      await ctx.db.patch(agent._id, {
        status: "link_failed",
        updatedAt: Date.now(),
      });
      return { status: "call_link_failed", agentId: agent.agentId };
    }

    const now = Date.now();
    // A successful Call_Link transitions an agent awaiting/failed on its link to
    // published (Req 7.2, 7.9). Other states keep their status (slug refresh).
    const shouldPublish =
      agent.status === "publish_pending_link" || agent.status === "link_failed";
    if (shouldPublish) {
      await ctx.db.patch(agent._id, {
        slug,
        status: "published",
        publishedAt: agent.publishedAt ?? now,
        updatedAt: now,
      });
    } else {
      await ctx.db.patch(agent._id, { slug, updatedAt: now });
    }

    return {
      status: "call_link_ready",
      agentId: agent.agentId,
      slug,
      callLink: buildCallLink(slug, platformBaseUrl()),
      publishState: shouldPublish ? "published" : agent.status,
    };
  },
});

// ---------------------------------------------------------------------------
// resolveCallLink — gated slug → profile (Req 7.6–7.9, 6.10, 6.11)
// ---------------------------------------------------------------------------

/**
 * Resolves a Call_Link `slug` (with an optional Private_Link `token`) to its
 * public profile through the access gate (Req 7.6–7.9, 6.10, 6.11). Content is
 * served only for a `published` agent that is public, owned by the requester, or
 * accessed with a valid, non-revoked Private_Link token; every other case
 * withholds all content and returns a denial (`invalid` / `unavailable` /
 * `access_denied`) with no agent fields disclosed. On a grant the response
 * carries the bounded public projection plus the absolute Call_Link.
 */
export const resolveCallLink = query({
  args: { slug: v.string(), token: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const gate = await gateAgentAccess(ctx, {
      slug: args.slug,
      token: args.token,
    });
    if (!gate.granted) {
      return { granted: false as const, denial: gate.denial };
    }
    return {
      granted: true as const,
      profile: gate.profile,
      callLink: buildCallLink(gate.agent.slug, platformBaseUrl()),
    };
  },
});

// ---------------------------------------------------------------------------
// getShareFormats — copy/QR/SMS/social/embed (Req 7.3, 7.4, 7.5)
// ---------------------------------------------------------------------------

/**
 * Returns the full share-format set for a Campus_Agent (Req 7.3, 7.4): the
 * copy-link action, QR payload, SMS/iMessage body, Instagram/TikTok/Snapchat
 * social formats, and the embeddable card — every link-bearing format embeds the
 * Call_Link (supporting the copy-link confirmation of Req 7.5). Gated identically
 * to the profile: formats are produced only when access is granted; otherwise a
 * denial is returned with no content. Resolvable by `slug` or public `agentId`.
 */
export const getShareFormats = query({
  args: {
    slug: v.optional(v.string()),
    agentId: v.optional(v.string()),
    token: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args
  ): Promise<
    | { available: true; formats: ShareFormats }
    | { available: false; denial: AccessDenialCode }
  > => {
    const gate = await gateAgentAccess(ctx, args);
    if (!gate.granted) {
      return { available: false, denial: gate.denial };
    }
    return {
      available: true,
      formats: assembleShareFormats(
        agentToShareAgent(gate.agent),
        platformBaseUrl()
      ),
    };
  },
});

// ---------------------------------------------------------------------------
// getShareCard — IG/TikTok/Snapchat Share_Card (Req 15.14)
// ---------------------------------------------------------------------------

/**
 * Returns the Share_Card in Instagram, TikTok, and Snapchat formats for a
 * Campus_Agent (Req 15.14). Each variant contains the agent name, campus tag,
 * agent type, the visible "AI voice agent" label, and the Call_Link, reusing the
 * same social-format assembly as `getShareFormats` so the card stays consistent
 * with the other share formats (Req 7.3). Gated identically to the profile.
 */
export const getShareCard = query({
  args: {
    slug: v.optional(v.string()),
    agentId: v.optional(v.string()),
    token: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args
  ): Promise<
    | { available: true; card: ShareCard }
    | { available: false; denial: AccessDenialCode }
  > => {
    const gate = await gateAgentAccess(ctx, args);
    if (!gate.granted) {
      return { available: false, denial: gate.denial };
    }
    return {
      available: true,
      card: assembleShareCard(agentToShareAgent(gate.agent), platformBaseUrl()),
    };
  },
});

// ---------------------------------------------------------------------------
// generateCallClip — recording + consent gate (Req 15.12, 15.13)
// ---------------------------------------------------------------------------

/**
 * Owner-gated context for the Call_Clip gate, resolved in the default runtime so
 * the `generateCallClip` action can read it via `ctx.runQuery` (identity
 * propagates). Resolves the source call and its owning Campus_Agent, and exposes
 * the recorded flag. `calls.recordingEnabled` is the per-call snapshot that
 * already reflects the Caller's acknowledgement of the notice (a declined notice
 * forces it `false`, per Privacy_Controls), so it captures both the recorded and
 * consent conditions of the clip gate (Req 15.12).
 */
export const getCallClipContext = internalQuery({
  args: { callId: v.string() },
  handler: async (ctx, args) => {
    const call = await ctx.db
      .query("calls")
      .withIndex("by_call_and_order_id", (q) => q.eq("callId", args.callId))
      .first();
    if (!call) {
      throw new Error("Call not found");
    }
    if (!call.campusAgentId) {
      throw new Error("Call is not a Campus_Agent call");
    }
    const { agent } = await requireOwnedAgent(ctx, call.campusAgentId);
    return {
      callId: call.callId,
      agentId: agent.agentId,
      agentName: agent.name,
      recorded: call.recordingEnabled === true,
    };
  },
});

/**
 * Persists a produced Call_Clip row and returns its id. Owner-gated (identity
 * propagates from the calling action). The row carries the "AI voice agent"
 * label and attribution to the Campus_Agent (Req 15.12).
 */
export const persistCallClip = internalMutation({
  args: {
    callId: v.string(),
    agentId: v.string(),
    storageId: v.string(),
    label: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOwnedAgent(ctx, args.agentId);
    const clipId = `CLIP_${crypto.randomUUID()}`;
    await ctx.db.insert("campusCallClips", {
      clipId,
      agentId: args.agentId,
      callId: args.callId,
      storageId: args.storageId,
      label: args.label,
      createdAt: Date.now(),
    });
    return { clipId };
  },
});

/** Discriminated outcome of `generateCallClip`. */
type GenerateCallClipResult =
  | {
      produced: true;
      clipId: string;
      agentId: string;
      callId: string;
      label: string;
    }
  | { produced: false; reason: "clip_unavailable"; message: string };

/**
 * Produces a Call_Clip from a completed call, gated on recording + caller
 * consent (Req 15.12, 15.13). The clip media must already be uploaded to Convex
 * storage (via a storage upload URL); the caller passes its `storageId`. The
 * recording+consent decision is delegated to the pure `decideCallClip`, driven
 * by the source call's `recordingEnabled` snapshot (which already reflects the
 * Caller's per-call acknowledgement). When produced, the clip is persisted with
 * the "AI voice agent" label and attribution to the Campus_Agent; when the call
 * was not recorded or the notice was declined, the just-uploaded blob is deleted
 * and `clip_unavailable` is returned indicating clips are available only for
 * recorded calls.
 */
export const generateCallClip = action({
  args: { callId: v.string(), storageId: v.id("_storage") },
  handler: async (ctx, args): Promise<GenerateCallClipResult> => {
    const context = await ctx.runQuery(
      internal.campus.share.getCallClipContext,
      { callId: args.callId }
    );

    const decision = decideCallClip({
      callId: context.callId,
      agentId: context.agentId,
      agentName: context.agentName,
      // `recorded` is the per-call snapshot: true only when recording was on AND
      // the Caller acknowledged the notice (a decline forces it false), so it
      // satisfies both conditions of the clip gate (Req 15.12).
      recordingEnabled: context.recorded,
      callerAcknowledgedRecording: context.recorded,
    });

    if (!decision.produced) {
      // No clip may be produced: drop the orphaned upload so nothing is stored.
      await ctx.storage.delete(args.storageId);
      return {
        produced: false,
        reason: decision.reason,
        message: decision.message,
      };
    }

    const { clipId } = await ctx.runMutation(
      internal.campus.share.persistCallClip,
      {
        callId: context.callId,
        agentId: context.agentId,
        storageId: args.storageId,
        label: decision.clip.label,
      }
    );

    return {
      produced: true,
      clipId,
      agentId: context.agentId,
      callId: context.callId,
      label: decision.clip.label,
    };
  },
});

// ---------------------------------------------------------------------------
// recordShare — share analytics event (Req 9.1)
// ---------------------------------------------------------------------------

/**
 * Appends a `share` analytics event for a Campus_Agent (Req 9.1), the raw signal
 * the Analytics_Aggregator rolls into the agent's share count. Recorded only for
 * a `published` agent — a share of an unavailable agent's Call_Link is not
 * counted (Req 7.9) — and returns `{ ok: false }` with the reason otherwise.
 */
export const recordShare = mutation({
  args: { agentId: v.string() },
  handler: async (ctx, args) => {
    const agent = await getAgentById(ctx, args.agentId);
    if (!agent) {
      return { ok: false as const, reason: "not_found" as const };
    }
    if (agent.status !== "published") {
      return { ok: false as const, reason: "unavailable" as const };
    }
    await ctx.db.insert("campusEvents", {
      agentId: agent.agentId,
      type: "share",
      createdAt: Date.now(),
    });
    return { ok: true as const };
  },
});
