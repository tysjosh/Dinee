/**
 * Feature: dinee-campus (Task 39.1) — Social_Service Convex service.
 *
 * Thin Convex wrapper around the pure, property-tested social core in
 * `./logic/social.ts` (distinct-saver counting + the remix transform) and the
 * shared access gate in `./logic/access.ts`. This module owns persistence
 * (`campusSaves`, `campusAgents`, `campusEvents`) and authorization; every
 * decision (the private-agent access gate, distinct-saver counting, and the
 * remix transform) is delegated to the pure functions so the same rules the
 * property tests exercise are the rules enforced at runtime.
 *
 * Exposed functions (design → `convex/campus/social.ts`):
 *   - saveAgent    (mutation) idempotent per `(agentId, callerKey)`; inserts a
 *                  `campusSaves` row when absent; access-gated for private
 *                  agents (Req 15.1, 15.4)
 *   - unsaveAgent  (mutation) idempotent; removes the `(agentId, callerKey)`
 *                  row when present (Req 15.2)
 *   - getSaveCount (query)    distinct savers = count of `campusSaves` rows for
 *                  the agent, each Caller counted at most once (Req 15.3)
 *   - isSaved      (query)    whether the current Caller saves the agent
 *   - remixAgent   (mutation) creates a remixed `draft` copying only the
 *                  configurable fields, excluding private data, recording
 *                  `remixSourceAgentId`, and incrementing the source's
 *                  `remixCount` by 1 — gated on `remixEnabled` + private-source
 *                  authorization (Req 15.5–15.9)
 *
 * Engagement timeline: a `save` row is appended to `campusEvents` when a new
 * save is recorded, and a `remix` row when a remix succeeds, feeding the
 * Analytics_Aggregator's save/remix count (Req 9.1). The `campusEvents` schema
 * models no `unsave` type — the authoritative distinct-saver ledger is
 * `campusSaves`, not the event log (the count is derived from the ledger, per
 * the design), so an unsave removes the ledger row without emitting an event.
 *
 * Save identity: saves/unsaves are per-Caller and require authentication. The
 * `callerKey` is a stable, hashed identity derived from the authenticated
 * user (matching `campusSaves.callerKey`), so a given Caller counts at most
 * once regardless of how many times they save (Req 15.3).
 */

import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { getCurrentUserRecord } from "../shared/ownership";
import { sha256Hex } from "../tokenHash";

import {
  computeSaveCount,
  isSavedBy,
  remixAgent as remixTransform,
  type RemixSourceAgent,
} from "./logic/social";
import {
  evaluateAccess,
  type AccessDenialCode,
  type AgentAccessView,
  type PrivateLinkRecord,
} from "./logic/access";

type AnyCtx = QueryCtx | MutationCtx;

// ---------------------------------------------------------------------------
// Small internal helpers
// ---------------------------------------------------------------------------

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

/** Resolves the Private_Link token records for an agent (Req 6.10, 15.4). */
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

/** Projects a stored agent row into the minimal access-gate view. */
function agentToAccessView(agent: Doc<"campusAgents">): AgentAccessView {
  return {
    agentId: agent.agentId,
    ownerId: agent.ownerId,
    status: agent.status,
    visibility: agent.visibility,
  };
}

/**
 * Resolves the requester id to hand the access gate / remix authorization.
 * When the authenticated user owns `agent`, returns the agent's `ownerId` so
 * the owner check matches regardless of whether ownership was recorded as the
 * auth `_id` or the app `userId`; otherwise returns the user's `_id` (a
 * non-owner). Mirrors the Share_Service convention so the gate never diverges.
 */
function resolveRequesterId(
  user: Doc<"users">,
  agent: Doc<"campusAgents"> | null
): string {
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
 * Derives the stable, hashed caller identity recorded in `campusSaves`
 * (Req 15.3). Keyed off the authenticated user's id so the same Caller always
 * maps to the same `callerKey` and is therefore counted at most once.
 */
async function deriveCallerKey(user: Doc<"users">): Promise<string> {
  return await sha256Hex(`campus_saver:${user._id as unknown as string}`);
}

/** Counts the distinct savers of an agent from the `campusSaves` ledger. */
async function countSavers(ctx: AnyCtx, agentId: string): Promise<number> {
  const rows = await ctx.db
    .query("campusSaves")
    .withIndex("by_agent_id", (q) => q.eq("agentId", agentId))
    .collect();
  const savers = new Set<string>(rows.map((r) => r.callerKey));
  return computeSaveCount(savers);
}

/** Generates a stable, unique public id for a remixed Campus_Agent draft. */
function generateAgentId(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 20; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// ---------------------------------------------------------------------------
// saveAgent — idempotent, access-gated for private agents (Req 15.1, 15.4)
// ---------------------------------------------------------------------------

/** Discriminated outcome of `saveAgent`. */
type SaveAgentResult =
  | { saved: true; saveCount: number }
  | { saved: false; denial: AccessDenialCode };

/**
 * Records the authenticated Caller's save of a Campus_Agent (Req 15.1). The
 * save is gated by the shared access rule (Req 15.4): it is granted only when
 * the agent is reachable per {@link evaluateAccess} — published, and either
 * public, owned by the requester, or accessed with a valid, non-revoked
 * Private_Link token. On a grant the `(agentId, callerKey)` row is inserted iff
 * absent, so repeated saves never inflate the count (idempotent, Req 15.3), and
 * a `save` engagement event is appended only on the state change. On a denial
 * (e.g. a private agent by a non-owner without a valid token) the save ledger
 * is left unchanged and the denial code is returned (Req 15.4).
 */
export const saveAgent = mutation({
  args: { agentId: v.string(), token: v.optional(v.string()) },
  handler: async (ctx, args): Promise<SaveAgentResult> => {
    const user = await getCurrentUserRecord(ctx);
    if (!user) {
      throw new Error("Unauthorized: authentication required");
    }

    const agent = await getAgentById(ctx, args.agentId);
    const privateLinks = agent
      ? await resolvePrivateLinks(ctx, agent.agentId)
      : [];
    const decision = evaluateAccess({
      agent: agent ? agentToAccessView(agent) : null,
      requesterId: resolveRequesterId(user, agent),
      token: args.token,
      privateLinks,
    });
    if (!decision.granted) {
      // Rejected — leave the save ledger unchanged (Req 15.4).
      return { saved: false, denial: decision.denial };
    }

    // `granted` implies `agent` is non-null (the gate returns `invalid` otherwise).
    const resolvedAgent = agent!;
    const callerKey = await deriveCallerKey(user);
    const existing = await ctx.db
      .query("campusSaves")
      .withIndex("by_agent_and_caller", (q) =>
        q.eq("agentId", resolvedAgent.agentId).eq("callerKey", callerKey)
      )
      .first();

    if (!existing) {
      const now = Date.now();
      await ctx.db.insert("campusSaves", {
        agentId: resolvedAgent.agentId,
        callerKey,
        createdAt: now,
      });
      // Engagement timeline (Req 9.1). The count itself is derived from the
      // `campusSaves` ledger, not this event.
      await ctx.db.insert("campusEvents", {
        agentId: resolvedAgent.agentId,
        type: "save",
        callerKey,
        createdAt: now,
      });
    }

    return { saved: true, saveCount: await countSavers(ctx, resolvedAgent.agentId) };
  },
});

// ---------------------------------------------------------------------------
// unsaveAgent — idempotent (Req 15.2)
// ---------------------------------------------------------------------------

/**
 * Removes the authenticated Caller's save of a Campus_Agent (Req 15.2).
 * Idempotent: the `(agentId, callerKey)` row is deleted iff present, so
 * repeated unsaves never change the count (Req 15.3). Unsaving needs no access
 * check — a Caller only ever removes their own membership. No engagement event
 * is emitted (the `campusEvents` schema models no `unsave` type; the
 * authoritative ledger is `campusSaves`).
 */
export const unsaveAgent = mutation({
  args: { agentId: v.string() },
  handler: async (ctx, args): Promise<{ saved: false; saveCount: number }> => {
    const user = await getCurrentUserRecord(ctx);
    if (!user) {
      throw new Error("Unauthorized: authentication required");
    }

    const callerKey = await deriveCallerKey(user);
    const existing = await ctx.db
      .query("campusSaves")
      .withIndex("by_agent_and_caller", (q) =>
        q.eq("agentId", args.agentId).eq("callerKey", callerKey)
      )
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
    }

    return { saved: false, saveCount: await countSavers(ctx, args.agentId) };
  },
});

// ---------------------------------------------------------------------------
// getSaveCount — distinct savers (Req 15.3)
// ---------------------------------------------------------------------------

/**
 * Returns a Campus_Agent's save count: the number of DISTINCT Callers currently
 * in the `campusSaves` ledger, counting each Caller at most once (Req 15.3).
 * Public — anyone viewing the profile can see the count. Delegates the count to
 * the pure {@link computeSaveCount}.
 */
export const getSaveCount = query({
  args: { agentId: v.string() },
  handler: async (ctx, args): Promise<{ count: number }> => {
    return { count: await countSavers(ctx, args.agentId) };
  },
});

// ---------------------------------------------------------------------------
// isSaved — current Caller's membership
// ---------------------------------------------------------------------------

/**
 * Whether the current Caller saves the agent. Returns `false` for an
 * unauthenticated viewer (an anonymous Caller has no membership) rather than
 * throwing, so the Agent_Profile_Page can query it unconditionally. Delegates
 * the membership test to the pure {@link isSavedBy}.
 */
export const isSaved = query({
  args: { agentId: v.string() },
  handler: async (ctx, args): Promise<{ saved: boolean }> => {
    const user = await getCurrentUserRecord(ctx);
    if (!user) {
      return { saved: false };
    }
    const callerKey = await deriveCallerKey(user);
    const existing = await ctx.db
      .query("campusSaves")
      .withIndex("by_agent_and_caller", (q) =>
        q.eq("agentId", args.agentId).eq("callerKey", callerKey)
      )
      .first();
    const savers = new Set<string>(existing ? [callerKey] : []);
    return { saved: isSavedBy(savers, callerKey) };
  },
});

// ---------------------------------------------------------------------------
// remixAgent — remix transform (Req 15.5–15.9)
// ---------------------------------------------------------------------------

/** Discriminated outcome of `remixAgent`. */
type RemixAgentResult =
  | {
      success: true;
      draftAgentId: string;
      remixSourceAgentId: string;
      sourceRemixCount: number;
    }
  | { success: false; denial: "remix_disabled" | "access_denied" };

/**
 * Remixes a source Campus_Agent into a new `draft` owned by the authenticated
 * Student_Creator (Req 15.5–15.9). Permission is enforced first via the pure
 * transform: the source's `remixEnabled` must be true (else `remix_disabled`,
 * Req 15.8) and, for a private source, the caller must be the owner or present
 * a valid Private_Link token (else `access_denied`, Req 15.9). A source that is
 * out of circulation (deleted / blocked / removed) is never remixable and is
 * denied `access_denied`.
 *
 * On success the new draft copies ONLY the configurable fields — agent type,
 * personality/tone, and preview prompts — and EXCLUDES the source's private
 * data (uploaded documents/knowledge sources, call history, analytics, creator
 * contact link, monetization link, voice-clone consent artifact) by
 * construction, since the pure transform reads only the configurable fields
 * (Req 15.5). It records `remixSourceAgentId` (Req 15.6), increments the
 * source's `remixCount` by exactly 1 (Req 15.7), and appends a `remix`
 * engagement event on the source (Req 9.1). The draft starts in the `draft`
 * Publish_State and must go through the normal publish flow.
 */
export const remixAgent = mutation({
  args: { sourceAgentId: v.string(), token: v.optional(v.string()) },
  handler: async (ctx, args): Promise<RemixAgentResult> => {
    const user = await getCurrentUserRecord(ctx);
    if (!user) {
      throw new Error("Unauthorized: authentication required");
    }

    const source = await getAgentById(ctx, args.sourceAgentId);
    // A missing source, or one out of circulation, cannot be remixed (Req 15.9,
    // 12.3): withhold with the same `access_denied` as an unauthorized request.
    if (
      !source ||
      source.status === "deleted" ||
      source.status === "blocked" ||
      source.status === "removed"
    ) {
      return { success: false, denial: "access_denied" };
    }

    const remixingUserId = resolveRequesterId(user, source);
    const privateLinks = await resolvePrivateLinks(ctx, source.agentId);

    const sourceView: RemixSourceAgent = {
      agentId: source.agentId,
      ownerId: source.ownerId,
      visibility: source.visibility,
      remixEnabled: source.remixEnabled,
      remixCount: source.remixCount,
      agentType: source.agentType,
      personalityTone: source.personalityTone,
      previewPrompts: source.previewPrompts,
      // Declared so the transform can be shown to EXCLUDE them; never copied.
      creatorContactLink: source.creatorContactLink,
      monetizationLink: source.monetizationLink,
    };

    const result = remixTransform({
      source: sourceView,
      remixingUserId,
      token: args.token,
      privateLinks,
    });
    if (!result.success) {
      return { success: false, denial: result.denial };
    }

    const now = Date.now();
    const newAgentId = generateAgentId();
    await ctx.db.insert("campusAgents", {
      agentId: newAgentId,
      slug: "",
      ownerId: remixingUserId,
      // Only the configurable fields are copied from the source; identity
      // fields are left empty for the remixing creator to complete.
      name: "",
      agentType: result.draft.agentType,
      voiceId: "",
      personalityTone: result.draft.personalityTone,
      description: "",
      creatorDisplayName: user.campusDisplayName ?? "",
      previewPrompts: result.draft.previewPrompts,
      visibility: "public",
      status: "draft",
      representsRealPerson: false,
      remixSourceAgentId: result.draft.remixSourceAgentId,
      createdAt: now,
      updatedAt: now,
    });

    // Increment the source's remix count by exactly 1 (Req 15.7).
    await ctx.db.patch(source._id, {
      remixCount: result.sourceRemixCount,
      updatedAt: now,
    });

    // Engagement timeline for the source agent (Req 9.1).
    await ctx.db.insert("campusEvents", {
      agentId: source.agentId,
      type: "remix",
      createdAt: now,
    });

    return {
      success: true,
      draftAgentId: newAgentId,
      remixSourceAgentId: result.draft.remixSourceAgentId,
      sourceRemixCount: result.sourceRemixCount,
    };
  },
});
