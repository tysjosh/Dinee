/**
 * Feature: dinee-campus (Task 18.1)
 *
 * Creation_Service — the Convex query/mutation layer for Dinee Campus agent
 * creation, publishing, editing, public-profile access, and deletion. This
 * module is intentionally THIN: every non-trivial decision is delegated to the
 * already-tested pure logic modules under `convex/campus/logic/**` so the same
 * rules the property tests exercise are the rules enforced at runtime.
 *
 * Exposed functions (design §"convex/campus/agents.ts — Creation_Service"):
 *   - `saveDraft`  (Mutation) — upserts a `draft` campusAgent, persisting each
 *     entered field so a returning creator resumes with values retained
 *     (Req 4.3).
 *   - `getDraft`   (Query)    — reconstructs an in-progress creation for the
 *     owner (Req 4.3).
 *   - `publishAgent` (Mutation) — the Publish_State machine (Req 4.2, 4.5, 4.6,
 *     7.2, 7.9, 10.1, 10.2, 11.12).
 *   - `updateAgent` (Mutation) — owner edits any field, including
 *     template-prefilled ones (Req 3.5).
 *   - `getPublicProfile` (Query) — the access gate + public projection
 *     (Req 6.1, 6.6, 6.7, 6.10, 6.11).
 *   - `deleteAgent` (Mutation) — Privacy_Controls circulation delete
 *     (Req 12.2, 12.3).
 *
 * `publishAgent` runs the reused primitives in a defined order so partial
 * failures are recoverable, returning discriminated result objects that always
 * preserve the entered values:
 *   1. validate required fields + a publishable Campus_Tag  → `field_error`
 *   2. usage gate (`Usage_Meter.canCreateAgent`)            → `usage_limit`
 *   3. voice-clone consent gate                             → `consent_required`
 *   4. register with the Voice_Runtime                      → `runtime_registration_failed`
 *   5. set `publish_pending_link` + attach the Campus_Tag
 *   6. generate the unique Call_Link slug                   → `call_link_failed` (status `link_failed`, retryable)
 *   7. transition to `published` + set `publishedAt`
 *
 * The resulting machine is `draft → publish_pending_link → published`, with
 * `publish_pending_link → link_failed` on a Call_Link failure and
 * `link_failed → published` on a successful retry. Only the `published` state
 * is discoverable and callable (Req 4.2, 7.9).
 */

import { mutation, query } from "../_generated/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc } from "../_generated/dataModel";

import {
  validateRequiredFields,
  validateOptionalValues,
  hasPublishableCampusTag,
} from "./logic/validation";
import {
  deserializeDraft,
  serializeDraft,
  type CreationDraft,
} from "./logic/draft";
import {
  getAccessibleProfile,
  applyDelete,
  type CampusAgentRecord,
  type PrivateLinkRecord,
} from "./logic/access";
import { canCreateAgent } from "./logic/usage";
import { evaluateConsentGate, type ConsentRecordView } from "./logic/consent";
import { slugifyName, slugDisambiguator, buildCallLink } from "./logic/share";
import { resolveOwnerTier } from "./usage";

// ---------------------------------------------------------------------------
// Shared validators (mirror the campusAgents schema unions)
// ---------------------------------------------------------------------------

const agentTypeValidator = v.union(
  v.literal("ai_twin"),
  v.literal("study_agent"),
  v.literal("club_agent"),
  v.literal("campus_guide"),
  v.literal("funny_character"),
  v.literal("tutor_agent"),
  v.literal("advice_agent")
);

const visibilityValidator = v.union(v.literal("public"), v.literal("private"));

const optionalFieldsValidator = v.object({
  socialLink: v.optional(v.string()),
  clubName: v.optional(v.string()),
  courseCode: v.optional(v.string()),
  eventDate: v.optional(v.number()),
  contactEmail: v.optional(v.string()),
});

/** The editable creation fields, all optional so a partial draft can be saved. */
const draftFieldArgs = {
  name: v.optional(v.string()),
  agentType: v.optional(agentTypeValidator),
  campusTag: v.optional(v.string()),
  voiceId: v.optional(v.string()),
  personalityTone: v.optional(v.string()),
  description: v.optional(v.string()),
  creatorDisplayName: v.optional(v.string()),
  previewPrompts: v.optional(v.array(v.string())),
  visibility: v.optional(visibilityValidator),
  representsRealPerson: v.optional(v.boolean()),
  remixEnabled: v.optional(v.boolean()),
  recordingEnabled: v.optional(v.boolean()),
  summariesEnabled: v.optional(v.boolean()),
  creatorContactLink: v.optional(v.string()),
  monetizationLink: v.optional(v.string()),
  optional: v.optional(optionalFieldsValidator),
} as const;

// ---------------------------------------------------------------------------
// Small internal helpers
// ---------------------------------------------------------------------------

/** Generates a stable, unique public id for a Campus_Agent. */
function generateAgentId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 20; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/** The platform base URL used to build absolute Call_Links (Req 7.1, 7.6). */
function platformBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined) ??
    "https://dinee.app"
  ).replace(/\/+$/, "");
}

/** Resolves the authenticated user's id, or throws when unauthenticated. */
async function requireUserId(ctx: QueryCtx | MutationCtx): Promise<string> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Unauthorized: authentication required");
  }
  return userId as unknown as string;
}

/** Loads a Campus_Agent by its public `agentId`, or null when absent. */
async function getAgentById(
  ctx: QueryCtx | MutationCtx,
  agentId: string
): Promise<Doc<"campusAgents"> | null> {
  return await ctx.db
    .query("campusAgents")
    .withIndex("by_agent_id", (q) => q.eq("agentId", agentId))
    .first();
}

/** Loads a Campus_Agent by its Call_Link `slug`, or null when absent. */
async function getAgentBySlug(
  ctx: QueryCtx | MutationCtx,
  slug: string
): Promise<Doc<"campusAgents"> | null> {
  return await ctx.db
    .query("campusAgents")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .first();
}

/** Counts the Knowledge_Sources associated with an agent (Req 5.2). */
async function countKnowledgeSources(
  ctx: QueryCtx | MutationCtx,
  agentId: string
): Promise<number> {
  const sources = await ctx.db
    .query("campusKnowledgeSources")
    .withIndex("by_agent_id", (q) => q.eq("agentId", agentId))
    .collect();
  return sources.length;
}

/**
 * The entered field values echoed back on every publish result so no work is
 * lost when publication is blocked (Req 4.6). Derived from the stored draft via
 * the pure draft round-trip so the returned values match exactly what was
 * entered.
 */
function enteredValues(agent: Doc<"campusAgents">): CreationDraft {
  return deserializeDraft(agentToDraft(agent));
}

/** Projects a stored agent row into the pure `CreationDraft` shape. */
function agentToDraft(agent: Doc<"campusAgents">): CreationDraft {
  return {
    name: agent.name,
    agentType: agent.agentType,
    campusTag: agent.campusTag,
    voiceId: agent.voiceId,
    personalityTone: agent.personalityTone,
    description: agent.description,
    creatorDisplayName: agent.creatorDisplayName,
    previewPrompts: agent.previewPrompts,
    visibility: agent.visibility,
    representsRealPerson: agent.representsRealPerson,
    remixEnabled: agent.remixEnabled,
    recordingEnabled: agent.recordingEnabled,
    summariesEnabled: agent.summariesEnabled,
    creatorContactLink: agent.creatorContactLink,
    monetizationLink: agent.monetizationLink,
    optional: agent.optional,
  };
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

/**
 * Registers a Campus_Agent with the Voice_Runtime `campus` pack (publish step
 * 4). Per the pack design the runtime pulls per-call configuration from
 * `campusAgents` + `Knowledge_Store.getGroundingContext` at call time, so
 * registration here verifies the agent carries the minimum runtime
 * configuration (a selected voice and personality). A missing configuration is
 * surfaced as a registration failure so the caller can retry after fixing it,
 * without producing a Call_Link.
 */
function registerAgentWithRuntime(agent: Doc<"campusAgents">): {
  ok: boolean;
} {
  const configured =
    typeof agent.voiceId === "string" &&
    agent.voiceId.length > 0 &&
    typeof agent.personalityTone === "string" &&
    agent.personalityTone.length > 0;
  return { ok: configured };
}

/**
 * Assigns a Call_Link slug that is unique across all Campus_Agents (Req 6.8,
 * 7.1), reusing the pure slug helpers. Prefers the clean name base; on
 * collision appends a deterministic id-derived token; then an incrementing
 * counter. The current agent is excluded so re-publishing keeps a stable slug.
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

// ---------------------------------------------------------------------------
// Draft lifecycle (Req 4.3)
// ---------------------------------------------------------------------------

/**
 * Upserts an in-progress creation draft for the authenticated owner (Req 4.3).
 * When `agentId` refers to an existing draft the owner controls, the provided
 * fields are merged onto it; otherwise a new `draft` agent is created. Each
 * entered field is persisted (normalized via the pure `serializeDraft`) so a
 * creator who leaves and returns resumes with previously entered values
 * retained. Only the fields present in the call are written; omitted fields keep
 * their stored value.
 */
export const saveDraft = mutation({
  args: {
    agentId: v.optional(v.string()),
    ...draftFieldArgs,
  },
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const { agentId, ...fields } = args;

    // Normalize the incoming fields, dropping any that were not entered so an
    // omitted field never clobbers a stored value (pure draft logic).
    const incoming = serializeDraft(fields as CreationDraft);
    const now = Date.now();

    if (agentId) {
      const existing = await getAgentById(ctx, agentId);
      if (!existing) {
        throw new Error("Draft not found");
      }
      if (existing.ownerId !== ownerId) {
        throw new Error("Forbidden: you do not own this draft");
      }
      await ctx.db.patch(existing._id, { ...incoming, updatedAt: now });
      const updated = await ctx.db.get(existing._id);
      return { agentId, draft: enteredValues(updated!) };
    }

    // New draft: fill schema-required fields with empty defaults for anything
    // not yet entered. The real Call_Link slug is assigned only at publish.
    const newAgentId = generateAgentId();
    await ctx.db.insert("campusAgents", {
      agentId: newAgentId,
      slug: "",
      ownerId,
      name: incoming.name ?? "",
      agentType: incoming.agentType ?? "ai_twin",
      campusTag: incoming.campusTag,
      voiceId: incoming.voiceId ?? "",
      personalityTone: incoming.personalityTone ?? "",
      description: incoming.description ?? "",
      creatorDisplayName: incoming.creatorDisplayName ?? "",
      previewPrompts: incoming.previewPrompts ?? [],
      visibility: incoming.visibility ?? "public",
      status: "draft",
      representsRealPerson: incoming.representsRealPerson ?? false,
      remixEnabled: incoming.remixEnabled,
      recordingEnabled: incoming.recordingEnabled,
      summariesEnabled: incoming.summariesEnabled,
      creatorContactLink: incoming.creatorContactLink,
      monetizationLink: incoming.monetizationLink,
      optional: incoming.optional,
      createdAt: now,
      updatedAt: now,
    });
    const created = await getAgentById(ctx, newAgentId);
    return { agentId: newAgentId, draft: enteredValues(created!) };
  },
});

/**
 * Reconstructs an in-progress creation for the authenticated owner (Req 4.3).
 * When `agentId` is provided, returns that draft (owner-gated); otherwise
 * returns the owner's most recently updated draft. The stored fields are
 * rebuilt via the pure `deserializeDraft` so the resumed values match exactly
 * what was entered. Returns `null` when there is no matching draft.
 */
export const getDraft = query({
  args: { agentId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);

    let agent: Doc<"campusAgents"> | null = null;
    if (args.agentId) {
      agent = await getAgentById(ctx, args.agentId);
      if (agent && agent.ownerId !== ownerId) {
        return null;
      }
    } else {
      const owned = await ctx.db
        .query("campusAgents")
        .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
        .collect();
      const drafts = owned
        .filter((a) => a.status === "draft")
        .sort((a, b) => b.updatedAt - a.updatedAt);
      agent = drafts[0] ?? null;
    }

    if (!agent || agent.status === "deleted") {
      return null;
    }
    return {
      agentId: agent.agentId,
      status: agent.status,
      draft: enteredValues(agent),
    };
  },
});

// ---------------------------------------------------------------------------
// Publish (Req 4.2, 4.5, 4.6, 7.2, 7.9, 10.1, 10.2, 11.12)
// ---------------------------------------------------------------------------

/**
 * Runs the Publish_State machine for an owned Campus_Agent (design step order).
 * Returns a discriminated result: `published` on success, or one of
 * `field_error` / `usage_limit` / `consent_required` /
 * `runtime_registration_failed` / `call_link_failed` on a blocked step. Every
 * blocked result echoes the entered `values` so nothing is lost, and every
 * blocked step leaves the agent retryable (the draft is retained; a Call_Link
 * failure moves it to `link_failed`, from which a successful retry publishes).
 */
export const publishAgent = mutation({
  args: { agentId: v.string() },
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const agent = await getAgentById(ctx, args.agentId);
    if (!agent) {
      throw new Error("Agent not found");
    }
    if (agent.ownerId !== ownerId) {
      throw new Error("Forbidden: you do not own this agent");
    }
    if (agent.status === "deleted") {
      throw new Error("Agent has been deleted");
    }

    const values = enteredValues(agent);

    // --- Step 1: required-field + Campus_Tag validation (Req 4.7, 10.1, 10.2).
    const knowledgeSourceCount = await countKnowledgeSources(ctx, agent.agentId);
    const requiredFailing = validateRequiredFields({
      name: agent.name,
      agentType: agent.agentType,
      campus: agent.campusTag,
      voice: agent.voiceId,
      tone: agent.personalityTone,
      knowledgeSourceCount,
      visibility: agent.visibility,
      description: agent.description,
      displayName: agent.creatorDisplayName,
    });
    const optionalFailing = validateOptionalValues({
      contactEmail: agent.optional?.contactEmail,
      monetizationLink: agent.monetizationLink,
    });

    // Map the required-field `campus` result onto the schema's `campusTag`, and
    // additionally require a publishable (non-blank) Campus_Tag (Req 10.2).
    const fields = new Set<string>();
    for (const f of requiredFailing) {
      fields.add(f === "campus" ? "campusTag" : f);
    }
    if (!hasPublishableCampusTag(agent.campusTag)) {
      fields.add("campusTag");
    }
    for (const f of optionalFailing) {
      fields.add(f);
    }
    if (fields.size > 0) {
      return {
        status: "field_error" as const,
        fields: Array.from(fields),
        values,
      };
    }

    // --- Step 2: usage gate (Req 4.5). The limit is on how many agents the
    // creator may own, so the agent being published is excluded from the count.
    const owned = await ctx.db
      .query("campusAgents")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .collect();
    const otherAgentCount = owned.filter(
      (a) => a.agentId !== agent.agentId && a.status !== "deleted"
    ).length;
    const tier = await resolveOwnerTier(ctx, ownerId);
    const usageGate = canCreateAgent(otherAgentCount, tier);
    if (!usageGate.allowed) {
      return {
        status: "usage_limit" as const,
        dimension: usageGate.dimension,
        limit: usageGate.limit,
        upgradeOption: usageGate.upgradeOption,
        values,
      };
    }

    // --- Step 3: voice-clone consent gate (Req 11.12).
    const consentRows = await ctx.db
      .query("campusVoiceCloneConsents")
      .withIndex("by_agent_id", (q) => q.eq("agentId", agent.agentId))
      .collect();
    const consents: ConsentRecordView[] = consentRows.map((c) => ({
      agentId: c.agentId,
      method: c.method,
      verified: c.verified,
    }));
    const consentGate = evaluateConsentGate({
      agentId: agent.agentId,
      representsRealPerson: agent.representsRealPerson,
      consents,
    });
    if (!consentGate.permitted) {
      return { status: "consent_required" as const, values };
    }

    // --- Step 4: register with the Voice_Runtime (retain draft on failure).
    const registration = registerAgentWithRuntime(agent);
    if (!registration.ok) {
      return { status: "runtime_registration_failed" as const, values };
    }

    // --- Step 5: enter publish_pending_link + attach the Campus_Tag. In this
    // state the agent is registered but has no Call_Link, so it is neither
    // discoverable nor callable (Req 4.2, 7.9).
    const now = Date.now();
    await ctx.db.patch(agent._id, {
      status: "publish_pending_link",
      updatedAt: now,
    });

    // --- Step 6: generate the unique Call_Link slug (Req 7.1). On failure move
    // to link_failed (not discoverable/callable) and allow retry (Req 7.2).
    let slug: string;
    try {
      slug = await assignUniqueSlug(ctx, agent);
    } catch {
      await ctx.db.patch(agent._id, {
        status: "link_failed",
        updatedAt: Date.now(),
      });
      return { status: "call_link_failed" as const, values };
    }

    // --- Step 7: transition to published (discoverable + callable, Req 4.2).
    const publishedAt = Date.now();
    await ctx.db.patch(agent._id, {
      slug,
      status: "published",
      publishedAt,
      updatedAt: publishedAt,
    });

    return {
      status: "published" as const,
      agentId: agent.agentId,
      slug,
      callLink: buildCallLink(slug, platformBaseUrl()),
      publishedAt,
    };
  },
});

// ---------------------------------------------------------------------------
// Edit (Req 3.5)
// ---------------------------------------------------------------------------

/**
 * Lets the owner edit any field of their Campus_Agent, including
 * template-prefilled ones (Req 3.5). Only the fields present in the call are
 * written (normalized via the pure draft logic); omitted fields keep their
 * stored value. Editing does not change the Publish_State.
 */
export const updateAgent = mutation({
  args: {
    agentId: v.string(),
    ...draftFieldArgs,
  },
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const { agentId, ...fields } = args;

    const agent = await getAgentById(ctx, agentId);
    if (!agent) {
      throw new Error("Agent not found");
    }
    if (agent.ownerId !== ownerId) {
      throw new Error("Forbidden: you do not own this agent");
    }
    if (agent.status === "deleted") {
      throw new Error("Agent has been deleted");
    }

    const incoming = serializeDraft(fields as CreationDraft);
    await ctx.db.patch(agent._id, { ...incoming, updatedAt: Date.now() });
    const updated = await ctx.db.get(agent._id);
    return { agentId, agent: enteredValues(updated!) };
  },
});

// ---------------------------------------------------------------------------
// Public profile — access gate + projection (Req 6.1, 6.6, 6.7, 6.10, 6.11)
// ---------------------------------------------------------------------------

/**
 * Serves a Campus_Agent's public profile through the access gate (Req 6.6,
 * 6.10, 6.11, 7.7–7.9). Content is returned only for a `published` agent that
 * is public, owned by the requester, or accessed with a valid, non-revoked
 * Private_Link token; every other case withholds all content and returns a
 * denial (`invalid` / `unavailable` / `access_denied`) with no agent fields
 * disclosed. On a grant the response carries the bounded public projection
 * (Req 6.1, 6.4, 6.5). Resolvable by Call_Link `slug` or public `agentId`.
 */
export const getPublicProfile = query({
  args: {
    slug: v.optional(v.string()),
    agentId: v.optional(v.string()),
    token: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const requesterId = await getAuthUserId(ctx);

    let agent: Doc<"campusAgents"> | null = null;
    if (args.agentId) {
      agent = await getAgentById(ctx, args.agentId);
    } else if (args.slug) {
      agent = await getAgentBySlug(ctx, args.slug);
    }

    // Resolve the agent's Private_Link tokens for the token check (Req 6.10).
    let privateLinks: PrivateLinkRecord[] = [];
    if (agent) {
      const rows = await ctx.db
        .query("campusPrivateLinks")
        .withIndex("by_agent_id", (q) => q.eq("agentId", agent!.agentId))
        .collect();
      privateLinks = rows.map((r) => ({
        token: r.token,
        agentId: r.agentId,
        status: r.status,
      }));
    }

    const result = getAccessibleProfile({
      agent: agent ? agentToRecord(agent) : null,
      requesterId: requesterId ? (requesterId as unknown as string) : null,
      token: args.token,
      privateLinks,
    });
    if (!result.granted) {
      return result;
    }
    // `granted` implies `agent` is non-null (the gate returns `invalid`
    // otherwise). Expose the public `agentId` alongside the bounded projection
    // so the Agent_Profile_Page can drive the save / remix / report / share
    // actions, which are all keyed by agent id (Req 6.5, 6.9, 15.1, 15.5). This
    // does NOT widen the pure `PublicProfileProjection` (Property 11 stays
    // bounded); the id is a public identifier and is returned only on a grant,
    // so the "withhold all content" guarantee on denial is preserved.
    return {
      granted: true as const,
      profile: result.profile,
      agentId: agent!.agentId,
    };
  },
});

// ---------------------------------------------------------------------------
// Delete — circulation removal (Req 12.2, 12.3)
// ---------------------------------------------------------------------------

/**
 * Deletes an owned Campus_Agent (Privacy_Controls, Req 12.2, 12.3). The agent
 * transitions to the `deleted` Publish_State (via the pure `applyDelete`),
 * which takes it out of circulation entirely: excluded from discovery, its
 * Call_Link becomes unavailable, and it is no longer retrievable.
 */
export const deleteAgent = mutation({
  args: { agentId: v.string() },
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const agent = await getAgentById(ctx, args.agentId);
    if (!agent) {
      throw new Error("Agent not found");
    }
    if (agent.ownerId !== ownerId) {
      throw new Error("Forbidden: you do not own this agent");
    }

    const { status } = applyDelete({ status: agent.status });
    await ctx.db.patch(agent._id, { status, updatedAt: Date.now() });
    return { agentId: args.agentId, status };
  },
});
