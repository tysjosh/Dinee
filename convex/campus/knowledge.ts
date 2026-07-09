/**
 * Feature: dinee-campus (Task 19.1) — Knowledge_Store Convex service.
 *
 * Thin Convex wrapper around the pure, property-tested acceptance/association
 * core in `./logic/knowledge.ts` and the layered document-upload gate in
 * `./logic/usage.ts`. This module owns persistence (Convex db + file storage)
 * and authorization; all decision logic is delegated to the pure functions so
 * the 40 correctness properties stay directly testable.
 *
 * Exposed functions (design → `convex/campus/knowledge.ts`):
 *   - addSource            (mutation) typed instructions / faq / link / event /
 *                          club / course sources (Req 5.1, 5.2, 5.3)
 *   - generateUploadUrl    (mutation) owner-gated Convex storage upload URL
 *   - uploadDocument       (action)   validate type → layered size limits →
 *                          upload-count gate (Usage_Meter) → store + persist,
 *                          else reject and retain existing content (Req 5.6,
 *                          5.7, 13.1)
 *   - listSources          (query)    owner-gated list for an agent (Req 5.2)
 *   - deleteSource         (mutation) owner-gated privacy delete (Req 12.2)
 *   - getGroundingContext  (query)    approved sources only, consumed by the
 *                          Voice_Runtime at call time (Req 5.4)
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
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { getCurrentUserRecord } from "../shared/ownership";
import {
  associateSource,
  evaluateKnowledgeSource,
  type KnowledgeSubmission,
} from "./logic/knowledge";
import { canUploadDocument } from "./logic/usage";
import { resolveOwnerTier } from "./usage";

type AnyCtx = QueryCtx | MutationCtx;

// ---------------------------------------------------------------------------
// Shared validators
// ---------------------------------------------------------------------------

/** Non-document Knowledge_Source kinds accepted by `addSource` (Req 5.1). */
const textSourceKind = v.union(
  v.literal("instructions"),
  v.literal("faq"),
  v.literal("link"),
  v.literal("event"),
  v.literal("club"),
  v.literal("course")
);

const faqEntryArg = v.object({
  question: v.string(),
  answer: v.string(),
});

// ---------------------------------------------------------------------------
// Helpers (auth / ownership / usage bookkeeping)
// ---------------------------------------------------------------------------

/**
 * Resolves the authenticated caller and the requested Campus_Agent, asserting
 * the caller owns the agent. Throws (fail-closed) on missing auth, unknown
 * agent, or a non-owner. `ownerId` may hold either the auth row id (`_id`) or
 * the app `userId`, so both are accepted (matches the schema comment).
 */
async function requireOwnedAgent(
  ctx: AnyCtx,
  agentId: string
): Promise<{ user: Doc<"users">; agent: Doc<"campusAgents"> }> {
  const user = await getCurrentUserRecord(ctx);
  if (!user) {
    throw new Error("Unauthorized: authentication required");
  }
  const agent = await ctx.db
    .query("campusAgents")
    .withIndex("by_agent_id", (q) => q.eq("agentId", agentId))
    .first();
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

/** The calendar-month period key (`YYYY-MM`, UTC) for a timestamp (Req 13.1). */
function periodKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 7);
}

/** Reads the owner's document-upload count for the current calendar month. */
async function monthlyUploadCount(
  ctx: AnyCtx,
  ownerId: string,
  period: string
): Promise<number> {
  const row = await ctx.db
    .query("campusUsage")
    .withIndex("by_owner_and_period", (q) =>
      q.eq("ownerId", ownerId).eq("period", period)
    )
    .first();
  return row?.documentUploadsUsed ?? 0;
}

/** Increments the owner's monthly document-upload counter by one (upsert). */
async function incrementUploadCount(
  ctx: MutationCtx,
  ownerId: string,
  nowMs: number
): Promise<void> {
  const period = periodKey(nowMs);
  const existing = await ctx.db
    .query("campusUsage")
    .withIndex("by_owner_and_period", (q) =>
      q.eq("ownerId", ownerId).eq("period", period)
    )
    .first();
  if (existing) {
    await ctx.db.patch(existing._id, {
      documentUploadsUsed: existing.documentUploadsUsed + 1,
      updatedAt: nowMs,
    });
    return;
  }
  await ctx.db.insert("campusUsage", {
    ownerId,
    period,
    callMinutesUsed: 0,
    documentUploadsUsed: 1,
    agentCount: 0,
    updatedAt: nowMs,
  });
}

/** Generates a stable public source id. */
function newSourceId(): string {
  return `SRC_${crypto.randomUUID()}`;
}

// ---------------------------------------------------------------------------
// addSource — typed instructions / faq / link / event / club / course
// (Req 5.1, 5.2, 5.3)
// ---------------------------------------------------------------------------

/**
 * Validates a non-document Knowledge_Source against its type limits (Req 5.1)
 * via the pure `evaluateKnowledgeSource`, and — iff accepted — persists it
 * associated with the owning Campus_Agent (Req 5.2), returning the new source
 * id so the client can confirm availability (Req 5.3). On rejection nothing is
 * written (previously stored content is left unchanged) and the specific
 * violated-limit reason is returned.
 */
export const addSource = mutation({
  args: {
    agentId: v.string(),
    kind: textSourceKind,
    textContent: v.optional(v.string()),
    faqEntries: v.optional(v.array(faqEntryArg)),
  },
  handler: async (ctx, args) => {
    const { agent } = await requireOwnedAgent(ctx, args.agentId);

    const submission: KnowledgeSubmission = {
      sourceId: newSourceId(),
      kind: args.kind,
      textContent: args.textContent,
      faqEntries: args.faqEntries,
    };

    const result = evaluateKnowledgeSource(
      submission,
      await resolveOwnerTier(ctx, agent.ownerId)
    );
    if (!result.accepted) {
      // Reject; leave previously stored content unchanged (Req 5.6 analog).
      return { ok: false as const, reason: result.reason };
    }

    // Associate with the owning agent (Req 5.2) via the pure projection.
    const stored = associateSource(submission, agent.agentId);
    await ctx.db.insert("campusKnowledgeSources", {
      sourceId: stored.sourceId,
      agentId: stored.agentId,
      kind: stored.kind,
      textContent: stored.textContent,
      faqEntries: stored.faqEntries ? [...stored.faqEntries] : undefined,
      moderationStatus: "pending",
      createdAt: Date.now(),
    });

    return { ok: true as const, sourceId: stored.sourceId };
  },
});

// ---------------------------------------------------------------------------
// Document upload — URL + gated action (Req 5.6, 5.7, 13.1)
// ---------------------------------------------------------------------------

/**
 * Returns a short-lived Convex storage upload URL for the owner to upload a
 * document directly. Owner-gated: only the Campus_Agent's owner may request
 * one. The subsequent `uploadDocument` action validates and persists (or
 * rejects and deletes the orphaned blob).
 */
export const generateUploadUrl = mutation({
  args: { agentId: v.string() },
  handler: async (ctx, args) => {
    await requireOwnedAgent(ctx, args.agentId);
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Owner-gated context for the document-upload gate, resolved in the default
 * runtime so the `"use node"`-free `uploadDocument` action can read it via
 * `ctx.runQuery` (which propagates the caller's identity).
 */
export const getUploadContext = internalQuery({
  args: { agentId: v.string() },
  handler: async (ctx, args) => {
    const { agent } = await requireOwnedAgent(ctx, args.agentId);
    const tier = await resolveOwnerTier(ctx, agent.ownerId);
    const uploadCount = await monthlyUploadCount(
      ctx,
      agent.ownerId,
      periodKey(Date.now())
    );
    return { ownerId: agent.ownerId, tier, uploadCount };
  },
});

/**
 * Persists an accepted document source and increments the owner's monthly
 * upload count, atomically in the default runtime. Owner-gated (identity
 * propagates from the calling action).
 */
export const persistDocumentSource = internalMutation({
  args: {
    agentId: v.string(),
    storageId: v.string(),
    fileName: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
  },
  handler: async (ctx, args) => {
    const { agent } = await requireOwnedAgent(ctx, args.agentId);
    const now = Date.now();
    const sourceId = newSourceId();

    await ctx.db.insert("campusKnowledgeSources", {
      sourceId,
      agentId: agent.agentId,
      kind: "document",
      storageId: args.storageId,
      fileMeta: {
        fileName: args.fileName,
        sizeBytes: args.sizeBytes,
        mimeType: args.mimeType,
      },
      moderationStatus: "pending",
      createdAt: now,
    });

    await incrementUploadCount(ctx, agent.ownerId, now);
    return { sourceId };
  },
});

/** Discriminated outcome of `uploadDocument` (annotated to break inference). */
type UploadDocumentResult =
  | { ok: true; sourceId: string; perTierSizeLimitBytes: number }
  | {
      ok: false;
      reason: "usage_limit";
      limit: number;
      upgradeOption: true;
      perTierSizeLimitBytes: number;
    }
  | {
      ok: false;
      reason: "document_too_large_platform";
      limitBytes: number;
      perTierSizeLimitBytes: number;
    }
  | {
      ok: false;
      reason: "document_too_large_tier";
      limitBytes: number;
      upgradeOption: true;
      perTierSizeLimitBytes: number;
    };

/**
 * Validates and stores an uploaded document (Req 5.6, 5.7, 13.1). The file must
 * already be uploaded to Convex storage (via `generateUploadUrl`); the caller
 * passes its `storageId` plus metadata. Decisioning is delegated to the pure
 * `canUploadDocument`, which enforces, in order: (1) the 20 MB platform maximum,
 * (2) the per-tier per-document limit (free tier: 10 MB), (3) the monthly
 * upload-count Usage_Limit. On any rejection the just-uploaded blob is deleted
 * so previously stored content is retained unchanged, and the specific reason
 * (with the applicable limit) is returned. On acceptance the source is
 * persisted and the upload count is incremented.
 */
export const uploadDocument = action({
  args: {
    agentId: v.string(),
    storageId: v.id("_storage"),
    fileName: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
  },
  handler: async (ctx, args): Promise<UploadDocumentResult> => {
    const context = await ctx.runQuery(internal.campus.knowledge.getUploadContext, {
      agentId: args.agentId,
    });

    const decision = canUploadDocument(
      context.uploadCount,
      args.sizeBytes,
      context.tier
    );

    if (!decision.allowed) {
      // Retain existing content unchanged: drop the orphaned upload (Req 5.6, 5.7).
      await ctx.storage.delete(args.storageId);
      return { ok: false, ...decision };
    }

    const { sourceId } = await ctx.runMutation(
      internal.campus.knowledge.persistDocumentSource,
      {
        agentId: args.agentId,
        storageId: args.storageId,
        fileName: args.fileName,
        mimeType: args.mimeType,
        sizeBytes: args.sizeBytes,
      }
    );

    return {
      ok: true,
      sourceId,
      perTierSizeLimitBytes: decision.perTierSizeLimitBytes,
    };
  },
});

// ---------------------------------------------------------------------------
// listSources — owner-gated (Req 5.2)
// ---------------------------------------------------------------------------

/**
 * Lists the Knowledge_Sources associated with an owned Campus_Agent in
 * insertion order (Req 5.2). Owner-gated; document byte content is not
 * returned, only metadata.
 */
export const listSources = query({
  args: { agentId: v.string() },
  handler: async (ctx, args) => {
    const { agent } = await requireOwnedAgent(ctx, args.agentId);
    const sources = await ctx.db
      .query("campusKnowledgeSources")
      .withIndex("by_agent_id", (q) => q.eq("agentId", agent.agentId))
      .collect();

    return sources.map((source) => ({
      sourceId: source.sourceId,
      kind: source.kind,
      textContent: source.textContent,
      faqEntries: source.faqEntries,
      fileMeta: source.fileMeta,
      moderationStatus: source.moderationStatus,
      createdAt: source.createdAt,
    }));
  },
});

// ---------------------------------------------------------------------------
// deleteSource — owner-gated privacy delete (Req 12.2)
// ---------------------------------------------------------------------------

/**
 * Deletes a single Knowledge_Source owned by the caller (Req 12.2). Verifies
 * the caller owns the source's Campus_Agent, removes any stored document blob,
 * then deletes the row. Returns `{ ok: false }` when the source does not exist.
 */
export const deleteSource = mutation({
  args: { sourceId: v.string() },
  handler: async (ctx, args) => {
    const source = await ctx.db
      .query("campusKnowledgeSources")
      .withIndex("by_source_id", (q) => q.eq("sourceId", args.sourceId))
      .first();
    if (!source) {
      return { ok: false as const, reason: "not_found" as const };
    }

    // Authorize against the owning agent.
    await requireOwnedAgent(ctx, source.agentId);

    if (source.storageId) {
      await ctx.storage.delete(source.storageId as Id<"_storage">);
    }
    await ctx.db.delete(source._id);
    return { ok: true as const };
  },
});

// ---------------------------------------------------------------------------
// getGroundingContext — approved sources only (Req 5.4)
// ---------------------------------------------------------------------------

/**
 * Returns the approved Knowledge_Sources grounding a Campus_Agent, consumed by
 * the Voice_Runtime at call time (Req 5.4). Only `approved` sources are
 * returned — `pending` and `flagged` sources are excluded so unscreened or
 * flagged content never grounds a live conversation (Req 11.7, 11.8). Readable
 * for a `published` agent (live grounding) or by the owner (test calls);
 * withheld otherwise so unpublished knowledge is not disclosed.
 */
/** A single approved Knowledge_Source projection used for live grounding. */
export interface ApprovedGroundingSource {
  sourceId: string;
  kind: Doc<"campusKnowledgeSources">["kind"];
  textContent?: string;
  faqEntries?: Doc<"campusKnowledgeSources">["faqEntries"];
  fileMeta?: Doc<"campusKnowledgeSources">["fileMeta"];
}

/** The result of resolving an agent's approved grounding context (Req 5.4). */
export type GroundingContextResult =
  | { available: false; sources: ApprovedGroundingSource[] }
  | { available: true; sources: ApprovedGroundingSource[] };

/**
 * Resolves the approved Knowledge_Sources grounding a Campus_Agent (Req 5.4),
 * shared by the public `getGroundingContext` query and the Voice_Runtime session
 * service (`convex/campus/session.ts`) so both apply the identical
 * approved-only + access-gating rules. Only `approved` sources are returned —
 * `pending`/`flagged` sources are excluded so unscreened or flagged content
 * never grounds a live conversation (Req 11.7, 11.8). Readable for a
 * `published` agent (live grounding) or by the owner (test calls); withheld
 * otherwise so unpublished knowledge is not disclosed.
 */
export async function resolveGroundingContext(
  ctx: AnyCtx,
  agentId: string
): Promise<GroundingContextResult> {
  const agent = await ctx.db
    .query("campusAgents")
    .withIndex("by_agent_id", (q) => q.eq("agentId", agentId))
    .first();
  if (!agent) {
    return { available: false, sources: [] };
  }

  const isPublished = agent.status === "published";
  if (!isPublished) {
    const user = await getCurrentUserRecord(ctx);
    const isOwner =
      user !== null &&
      (agent.ownerId === user._id ||
        (Boolean(user.userId) && agent.ownerId === user.userId));
    if (!isOwner) {
      return { available: false, sources: [] };
    }
  }

  const sources = await ctx.db
    .query("campusKnowledgeSources")
    .withIndex("by_agent_id", (q) => q.eq("agentId", agent.agentId))
    .collect();

  const approved: ApprovedGroundingSource[] = sources
    .filter((source) => source.moderationStatus === "approved")
    .map((source) => ({
      sourceId: source.sourceId,
      kind: source.kind,
      textContent: source.textContent,
      faqEntries: source.faqEntries,
      fileMeta: source.fileMeta,
    }));

  return { available: true, sources: approved };
}

export const getGroundingContext = query({
  args: { agentId: v.string() },
  handler: async (ctx, args) => resolveGroundingContext(ctx, args.agentId),
});
