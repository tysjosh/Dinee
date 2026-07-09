/**
 * Feature: dinee-campus (Task 27.2) — Voice_Runtime session service.
 *
 * The `campus` VoiceDomainPack is product-agnostic: per-call behavior is
 * resolved from `campusAgents` + `Knowledge_Store.getGroundingContext` at
 * session start, not baked into the pack (design §"`campus` VoiceDomainPack",
 * §"Where Campus plugs into the Voice_Runtime"). This module is the thin Convex
 * layer the Voice_Runtime consumes to do exactly that:
 *
 *   - `getSessionConfig` (query)  — at session start, resolve the agent's
 *     voice / personality / knowledge / boundaries / creator-contact into the
 *     session configuration + system prompt, delegating every decision to the
 *     pure, property-tested `convex/campus/logic/session.ts` (Req 5.4, 8.3,
 *     8.4, 8.5, 8.6). Grounding is read through the shared
 *     `resolveGroundingContext` so the runtime sees exactly the approved,
 *     access-gated knowledge the public grounding query returns.
 *   - `startCall` (mutation)      — at session start, correlate the `calls`
 *     record to its Campus_Agent (`campusAgentId`, `conversationType`) and
 *     snapshot the recording setting in effect (Req 8.1, 12.5, 12.8).
 *   - `recordCallEnd` (mutation)  — at call end, write the whole-second call
 *     duration (via the pure `computeCallDurationSeconds`) and mark the call
 *     completed, keeping the `campusAgentId` correlation (Req 8.8).
 *
 * The call-write mutations are server-to-server Voice_Runtime calls, so they are
 * guarded by {@link assertInternalCaller} exactly like `internal.upsertCallData`
 * — a direct unauthenticated Convex call cannot forge campus call records.
 */

import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { assertInternalCaller } from "../shared/internalAuth";
import { getCurrentUserRecord } from "../shared/ownership";
import { generateSecureToken, sha256Hex } from "../tokenHash";
import {
  resolveGroundingContext,
  type ApprovedGroundingSource,
} from "./knowledge";
import { resolveOwnerTier } from "./usage";
import {
  buildSessionConfig as buildCampusSessionConfig,
  retrieveGrounding,
  type CampusAgentRuntimeConfig,
  type GroundingEntry,
} from "./logic/session";
import {
  computeCallDurationSeconds,
  callMinutesFromDuration,
} from "./logic/callDuration";
import { canStartCall } from "./logic/usage";
import {
  isCallRealtimeEligible,
  formatGroundingToolOutput,
} from "./logic/realtime";
import { evaluateAccess, type PrivateLinkRecord } from "./logic/access";
import {
  applyDeclineOverride,
  snapshotPrivacyAtCallStart,
} from "./logic/recording";

/** The conversation type owned by the campus VoiceDomainPack. */
const CAMPUS_CONVERSATION_TYPE = "campus_agent_conversation" as const;

type AnyCtx = QueryCtx | MutationCtx;

// ---------------------------------------------------------------------------
// Pure projections (agent row → runtime config, approved sources → grounding)
// ---------------------------------------------------------------------------

/**
 * Projects a stored `campusAgents` row into the pure {@link CampusAgentRuntimeConfig}
 * consumed by the session-assembly logic. The agent's `description` is its
 * purpose (it scopes the responses), `voiceId` becomes the session voice
 * (Req 8.3), and `creatorContactLink` — when configured — is surfaced so the
 * runtime can offer it on a routing match (Req 8.6). `campusAgents` carries no
 * separate boundary text, so `boundaries` is left unset and the pack's standard
 * boundary instruction applies.
 */
function agentToRuntimeConfig(
  agent: Doc<"campusAgents">
): CampusAgentRuntimeConfig {
  return {
    agentId: agent.agentId,
    name: agent.name,
    voiceId: agent.voiceId,
    purpose: agent.description,
    personalityTone: agent.personalityTone,
    creatorContactLink: agent.creatorContactLink,
  };
}

/**
 * Renders one approved Knowledge_Source projection into a plain-text grounding
 * body. FAQ sources are flattened to `Q: …\nA: …` blocks; document sources
 * (whose bytes are not extracted here) contribute their file name so the model
 * at least knows the material exists; text sources use their content verbatim.
 */
function sourceContent(source: ApprovedGroundingSource): string {
  if (typeof source.textContent === "string" && source.textContent.length > 0) {
    return source.textContent;
  }
  if (source.faqEntries && source.faqEntries.length > 0) {
    return source.faqEntries
      .map((entry) => `Q: ${entry.question}\nA: ${entry.answer}`)
      .join("\n\n");
  }
  if (source.fileMeta && source.fileMeta.fileName.length > 0) {
    return source.fileMeta.fileName;
  }
  return "";
}

/**
 * Maps the approved Knowledge_Sources for an agent into the pure
 * {@link GroundingEntry} list used to summarize knowledge in the system prompt
 * and to ground answers (Req 5.4, 8.4). Empty-content sources are dropped so
 * they never produce a blank knowledge line.
 */
function groundingSourcesToEntries(
  sources: readonly ApprovedGroundingSource[]
): GroundingEntry[] {
  const entries: GroundingEntry[] = [];
  for (const source of sources) {
    const content = sourceContent(source);
    if (content.length > 0) {
      entries.push({ sourceId: source.sourceId, content });
    }
  }
  return entries;
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

// ---------------------------------------------------------------------------
// getSessionConfig — session-start config resolution (Req 5.4, 8.3, 8.4, 8.6)
// ---------------------------------------------------------------------------

/** The session configuration the Voice_Runtime applies for a campus call. */
type SessionConfigResult =
  | { available: false }
  | {
      available: true;
      agentId: string;
      conversationType: typeof CAMPUS_CONVERSATION_TYPE;
      /** The session voice — exactly the agent's `voiceId` (Req 8.3). */
      voiceId: string;
      /** The assembled system prompt: identity, purpose, knowledge, boundaries (Req 8.4). */
      systemPrompt: string;
      /** The agent's personality/tone, surfaced for the runtime (Req 8.4). */
      personalityTone: string;
      /** The creator contact link offered on a routing match, when configured (Req 8.6). */
      creatorContactLink?: string;
      /** The approved knowledge grounding the conversation (Req 5.4). */
      knowledge: GroundingEntry[];
    };

/**
 * Resolves the per-call session configuration for a Campus_Agent at session
 * start (Req 5.4, 8.3, 8.4, 8.5, 8.6). Loads the agent's runtime config and its
 * approved knowledge (through the shared, access-gated `resolveGroundingContext`
 * so unpublished/flagged knowledge is never exposed) and assembles the session
 * voice + system prompt via the pure `buildSessionConfig`. Returns
 * `{ available: false }` when the agent is unknown or its knowledge is withheld
 * (an unpublished agent requested by a non-owner), so the runtime does not open
 * a session for content it may not serve.
 */
export const getSessionConfig = query({
  args: { agentId: v.string() },
  handler: async (ctx, args): Promise<SessionConfigResult> => {
    const agent = await getAgentById(ctx, args.agentId);
    if (!agent) {
      return { available: false };
    }

    const grounding = await resolveGroundingContext(ctx, args.agentId);
    if (!grounding.available) {
      return { available: false };
    }

    const runtimeConfig = agentToRuntimeConfig(agent);
    const entries = groundingSourcesToEntries(grounding.sources);
    const session = buildCampusSessionConfig(runtimeConfig, entries);

    return {
      available: true,
      agentId: session.agentId,
      conversationType: CAMPUS_CONVERSATION_TYPE,
      voiceId: session.voiceId,
      systemPrompt: session.systemPrompt,
      personalityTone: agent.personalityTone,
      creatorContactLink: agent.creatorContactLink,
      knowledge: entries,
    };
  },
});

// ---------------------------------------------------------------------------
// getCallRealtimeConfig — call-scoped realtime config for the browser WebRTC
// media session (Req 8.1, 8.3, 8.4). Keyed by the server-minted `callId`.
// ---------------------------------------------------------------------------

/** The realtime media config the browser needs to open a WebRTC session. */
type CallRealtimeConfigResult =
  | { available: false }
  | {
      available: true;
      agentId: string;
      agentName: string;
      /** The agent's selected voice id (mapped to a provider voice by the token route). */
      voiceId: string;
      /** The assembled system prompt (identity, purpose, knowledge, boundaries). */
      systemPrompt: string;
    };

/**
 * Resolves the realtime media configuration for an in-progress browser call,
 * keyed by the SERVER-MINTED `callId` returned by {@link startBrowserCall}.
 *
 * The `callId` is a high-entropy capability: it is only ever handed to a Caller
 * who already cleared the access + usage gates in `startBrowserCall`, so this
 * query treats a matching `active` campus call as authorization to resolve the
 * agent's voice + system prompt. It never exposes config for an unknown call,
 * a non-campus call, or a call that is not `active` (e.g. already ended), so a
 * guessed/expired id yields nothing. The realtime token route
 * (`/campus/api/realtime-token`) consumes this to configure the ephemeral
 * OpenAI session, so the browser never sees the agent's raw configuration
 * beyond the voice + prompt the model itself is given.
 */
export const getCallRealtimeConfig = query({
  args: { callId: v.string() },
  handler: async (ctx, args): Promise<CallRealtimeConfigResult> => {
    const call = await ctx.db
      .query("calls")
      .withIndex("by_call_and_order_id", (q) => q.eq("callId", args.callId))
      .unique();
    if (!isCallRealtimeEligible(call) || !call?.campusAgentId) {
      return { available: false };
    }

    const agent = await getAgentById(ctx, call.campusAgentId);
    if (!agent) {
      return { available: false };
    }

    // The call already passed the access gate at start, so grounding is read
    // directly for the correlated agent to assemble the prompt (Req 8.4).
    const grounding = await resolveGroundingContext(ctx, agent.agentId);
    const entries = grounding.available
      ? groundingSourcesToEntries(grounding.sources)
      : [];
    const session = buildCampusSessionConfig(
      agentToRuntimeConfig(agent),
      entries
    );

    return {
      available: true,
      agentId: agent.agentId,
      agentName: agent.name,
      voiceId: session.voiceId,
      systemPrompt: session.systemPrompt,
    };
  },
});

// ---------------------------------------------------------------------------
// lookupCallKnowledge — live knowledge-grounding tool result (Req 5.5, 8.4, 8.5)
// ---------------------------------------------------------------------------

/**
 * Resolves the `campus_lookup_knowledge` tool call for an in-progress browser
 * call, keyed by the server-minted `callId` capability. Given the Caller's
 * question, it retrieves the correlated agent's approved knowledge and runs the
 * pure `retrieveGrounding` matcher, returning the plain-text `output` the
 * browser hands back to the model: matched approved-knowledge content when the
 * question is answerable, or the "cannot answer from available knowledge"
 * fallback otherwise (Req 5.5, 8.4, 8.5). Never exposes config for an
 * unknown/ended/non-campus call. Pure decisioning is delegated; this only reads.
 */
export const lookupCallKnowledge = query({
  args: { callId: v.string(), question: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<{ available: false } | { available: true; answered: boolean; output: string }> => {
    const call = await ctx.db
      .query("calls")
      .withIndex("by_call_and_order_id", (q) => q.eq("callId", args.callId))
      .unique();
    if (!isCallRealtimeEligible(call) || !call?.campusAgentId) {
      return { available: false };
    }

    const agent = await getAgentById(ctx, call.campusAgentId);
    if (!agent) {
      return { available: false };
    }

    const grounding = await resolveGroundingContext(ctx, agent.agentId);
    const entries = grounding.available
      ? groundingSourcesToEntries(grounding.sources)
      : [];
    const result = retrieveGrounding(args.question, entries);
    return {
      available: true,
      answered: result.answered,
      output: formatGroundingToolOutput(result),
    };
  },
});

// ---------------------------------------------------------------------------
// startCall — correlate the calls record + snapshot recording (Req 8.1, 12.5)
// ---------------------------------------------------------------------------

/**
 * Records the start of a Campus_Agent voice conversation on the `calls` table
 * (Req 8.1). Correlates the call to its Campus_Agent (`campusAgentId`) and its
 * conversation type, sets the start time, and snapshots the recording setting
 * in effect at call start — a Caller who declines the notice forces the call
 * neither-recorded (Req 12.5, 12.8), delegated to the pure recording logic.
 * Upserts by `callId` so a re-sent start is idempotent. Guarded as an internal
 * server-to-server call.
 */
export const startCall = mutation({
  args: {
    internalSecret: v.optional(v.string()),
    callId: v.string(),
    agentId: v.string(),
    callerAcknowledgedRecording: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    assertInternalCaller(args.internalSecret);

    const agent = await getAgentById(ctx, args.agentId);
    if (!agent) {
      throw new Error("Agent not found");
    }

    const now = Date.now();

    // Snapshot the recording setting in effect at call start (no per-agent
    // change history is tracked on the row, so the current default applies to
    // this and all future calls), then apply the Caller's notice response: a
    // decline forces the call neither-recorded-nor-summarized (Req 12.5, 12.8).
    const snapshot = snapshotPrivacyAtCallStart(
      {
        recordingDefault: agent.recordingEnabled === true,
        summariesDefault: agent.summariesEnabled === true,
      },
      now
    );
    const acknowledged = args.callerAcknowledgedRecording ?? true;
    const decision = applyDeclineOverride(snapshot, acknowledged);

    const existing = await ctx.db
      .query("calls")
      .withIndex("by_call_and_order_id", (q) => q.eq("callId", args.callId))
      .unique();

    const fields = {
      campusAgentId: agent.agentId,
      conversationType: CAMPUS_CONVERSATION_TYPE,
      recordingEnabled: decision.recordingEnabled,
      status: "active" as const,
    };

    if (existing) {
      await ctx.db.patch(existing._id, fields);
    } else {
      await ctx.db.insert("calls", {
        callId: args.callId,
        callStartTime: now,
        ...fields,
      });
    }

    return {
      callId: args.callId,
      campusAgentId: agent.agentId,
      recordingEnabled: decision.recordingEnabled,
    };
  },
});

// ---------------------------------------------------------------------------
// recordCallEnd — write campusAgentId + duration at call end (Req 8.8)
// ---------------------------------------------------------------------------

/** Discriminated outcome of `recordCallEnd`. */
type RecordCallEndResult =
  | { ok: true; callId: string; campusAgentId: string; duration: number }
  | { ok: false; reason: "call_not_found" | "not_a_campus_call" };

/**
 * Records the end of a Campus_Agent voice conversation (Req 8.8). Computes the
 * whole-second call duration via the pure `computeCallDurationSeconds` from the
 * stored start time and the end time, writes `duration`, `callEndTime`, and the
 * `campusAgentId` correlation, and marks the call `completed`. `agentId` is
 * accepted so the correlation can be (re)asserted even if the start write was
 * lost. Guarded as an internal server-to-server call.
 */
export const recordCallEnd = mutation({
  args: {
    internalSecret: v.optional(v.string()),
    callId: v.string(),
    agentId: v.optional(v.string()),
    endedAt: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<RecordCallEndResult> => {
    assertInternalCaller(args.internalSecret);

    const call = await ctx.db
      .query("calls")
      .withIndex("by_call_and_order_id", (q) => q.eq("callId", args.callId))
      .unique();
    if (!call) {
      return { ok: false, reason: "call_not_found" };
    }

    const campusAgentId = args.agentId ?? call.campusAgentId;
    if (!campusAgentId) {
      // Not a Campus_Agent call and no correlation supplied — leave it alone.
      return { ok: false, reason: "not_a_campus_call" };
    }

    const endMs = args.endedAt ?? Date.now();
    const startMs = call.callStartTime ?? endMs;
    const duration = computeCallDurationSeconds(startMs, endMs);

    await ctx.db.patch(call._id, {
      campusAgentId,
      duration,
      callEndTime: endMs,
      status: "completed",
    });

    return { ok: true, callId: args.callId, campusAgentId, duration };
  },
});

// ---------------------------------------------------------------------------
// Browser call session — server-authoritative callId (Req 8.1, 8.8, 13.7)
// ---------------------------------------------------------------------------

/**
 * The web (browser) call path is the default for Campus_Agents, but a browser
 * client cannot present the internal secret that guards `startCall` /
 * `recordCallEnd`, and it must not mint its own `callId` (a client-chosen id
 * cannot be trusted to key ratings, clips, or analytics). These two PUBLIC
 * mutations are the browser's authenticated entry points: the server owns the
 * `callId`, creates the authoritative `calls` row at start, and closes it at
 * end — so the `callId` returned to the browser is the same id the rating,
 * call-clip, and analytics paths key off, closing the representational gap.
 *
 * They complement (rather than replace) the internal `startCall`/`recordCallEnd`
 * used by the telephony (ws-server) media path, sharing the same recording
 * snapshot / duration logic.
 */

/** The calendar-month period key (`YYYY-MM`, UTC), matching the Usage_Meter. */
function periodKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 7);
}

/**
 * Resolves the requester id handed to the access gate. When the authenticated
 * user owns `agent`, returns the agent's `ownerId` so the gate's owner check
 * matches whether ownership was recorded as the auth `_id` or the app `userId`;
 * otherwise returns the user's `_id` (a non-owner) or `null` when anonymous.
 * Mirrors the Share_Service convention.
 */
async function resolveRequesterId(
  ctx: MutationCtx,
  agent: Doc<"campusAgents"> | null
): Promise<{ requesterId: string | null; user: Doc<"users"> | null }> {
  const user = await getCurrentUserRecord(ctx);
  if (!user) {
    return { requesterId: null, user: null };
  }
  if (
    agent &&
    (agent.ownerId === user._id ||
      (Boolean(user.userId) && agent.ownerId === user.userId))
  ) {
    return { requesterId: agent.ownerId, user };
  }
  return { requesterId: user._id as unknown as string, user };
}

/** Resolves the agent's Private_Link token records for the access gate. */
async function resolvePrivateLinks(
  ctx: MutationCtx,
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

/** Discriminated outcome of `startBrowserCall`. */
type StartBrowserCallResult =
  | {
      ok: true;
      callId: string;
      agentId: string;
      recordingEnabled: boolean;
    }
  | { ok: false; reason: "invalid" | "unavailable" | "access_denied" }
  | { ok: false; reason: "call_minutes_exhausted"; limit: number };

/**
 * Opens a browser-initiated Campus_Agent voice conversation and returns the
 * SERVER-AUTHORITATIVE `callId` the client uses for the rest of the call
 * (rating, clip, analytics). It:
 *   1. runs the same access gate as the profile/Call_Link — the agent must be
 *      published and public, owned by the requester, or reachable with a valid
 *      Private_Link token, else the matching denial is returned (Req 6.6, 6.10);
 *   2. enforces the owning account's call-minutes Usage_Limit; when exhausted
 *      the call is declined `call_minutes_exhausted` and NOTHING is written, so
 *      the agent is "temporarily unavailable" with its config/data unchanged
 *      (Req 13.6, 13.7);
 *   3. snapshots the recording/summary setting in effect and applies the
 *      Caller's notice response (a decline forces neither-recorded, Req 12.5,
 *      12.8);
 *   4. inserts the authoritative `calls` row (server-minted `callId`,
 *      `campusAgentId`, `conversationType`, `callStartTime`, recording snapshot)
 *      and returns the `callId` (Req 8.1).
 */
export const startBrowserCall = mutation({
  args: {
    agentId: v.string(),
    token: v.optional(v.string()),
    callerAcknowledgedRecording: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<StartBrowserCallResult> => {
    const agent = await getAgentById(ctx, args.agentId);
    const privateLinks = agent
      ? await resolvePrivateLinks(ctx, agent.agentId)
      : [];
    const { requesterId } = await resolveRequesterId(ctx, agent);

    // Access gate — withholds with no agent detail on any denial (Req 6.6–6.11).
    const access = evaluateAccess({
      agent: agent
        ? {
            agentId: agent.agentId,
            ownerId: agent.ownerId,
            status: agent.status,
            visibility: agent.visibility,
          }
        : null,
      requesterId,
      token: args.token,
      privateLinks,
    });
    if (!access.granted) {
      return { ok: false, reason: access.denial };
    }
    // `granted` implies the agent exists.
    const resolvedAgent = agent as Doc<"campusAgents">;

    const now = Date.now();

    // Usage gate (Req 13.6, 13.7): block on exhausted call minutes, writing
    // nothing so the agent's config/data are unchanged.
    const tier = await resolveOwnerTier(ctx, resolvedAgent.ownerId);
    const usageRow = await ctx.db
      .query("campusUsage")
      .withIndex("by_owner_and_period", (q) =>
        q.eq("ownerId", resolvedAgent.ownerId).eq("period", periodKey(now))
      )
      .first();
    const gate = canStartCall(usageRow?.callMinutesUsed ?? 0, tier);
    if (!gate.allowed) {
      return { ok: false, reason: "call_minutes_exhausted", limit: gate.limit };
    }

    // Recording snapshot + decline override (Req 12.5, 12.8).
    const snapshot = snapshotPrivacyAtCallStart(
      {
        recordingDefault: resolvedAgent.recordingEnabled === true,
        summariesDefault: resolvedAgent.summariesEnabled === true,
      },
      now
    );
    const acknowledged = args.callerAcknowledgedRecording ?? true;
    const decision = applyDeclineOverride(snapshot, acknowledged);

    // Server-minted, unguessable callId — the authoritative id for this call.
    const callId = `campuscall_${generateSecureToken(16)}`;
    await ctx.db.insert("calls", {
      callId,
      callStartTime: now,
      campusAgentId: resolvedAgent.agentId,
      conversationType: CAMPUS_CONVERSATION_TYPE,
      recordingEnabled: decision.recordingEnabled,
      status: "active",
    });

    return {
      ok: true,
      callId,
      agentId: resolvedAgent.agentId,
      recordingEnabled: decision.recordingEnabled,
    };
  },
});

/** Discriminated outcome of `endBrowserCall`. */
type EndBrowserCallResult =
  | { ok: true; callId: string; duration: number }
  | { ok: false; reason: "call_not_found" | "not_a_campus_call" };

/**
 * Closes a browser-initiated Campus_Agent call keyed by the server-minted
 * `callId` from {@link startBrowserCall}. It:
 *   1. writes the whole-second `duration`, `callEndTime`, and marks the call
 *      `completed` (Req 8.8);
 *   2. appends a `call_completed` `campusEvents` row (carrying the duration and,
 *      for an authenticated Caller, a stable hashed `callerKey`) so the
 *      Analytics_Dashboard's call count, unique-caller count, and average
 *      duration reflect the call (Req 9.1);
 *   3. meters the call minutes against the owning account's calendar-month usage
 *      (rounded up to the next whole minute) so call-minutes limits advance
 *      (Req 13.6).
 *
 * Idempotent-ish: a call already marked `completed` is not double-metered.
 */
export const endBrowserCall = mutation({
  args: {
    callId: v.string(),
    endedAt: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<EndBrowserCallResult> => {
    const call = await ctx.db
      .query("calls")
      .withIndex("by_call_and_order_id", (q) => q.eq("callId", args.callId))
      .unique();
    if (!call) {
      return { ok: false, reason: "call_not_found" };
    }
    const campusAgentId = call.campusAgentId;
    if (!campusAgentId) {
      return { ok: false, reason: "not_a_campus_call" };
    }

    // Guard against double-processing a call that was already closed.
    const alreadyCompleted = call.status === "completed";

    const endMs = args.endedAt ?? Date.now();
    const startMs = call.callStartTime ?? endMs;
    const duration = alreadyCompleted
      ? call.duration ?? computeCallDurationSeconds(startMs, endMs)
      : computeCallDurationSeconds(startMs, endMs);

    if (alreadyCompleted) {
      return { ok: true, callId: args.callId, duration };
    }

    await ctx.db.patch(call._id, {
      campusAgentId,
      duration,
      callEndTime: endMs,
      status: "completed",
    });

    // Analytics signal (Req 9.1): a completed call with its duration and a
    // stable hashed caller identity when the Caller is authenticated (anonymous
    // callers are counted per-call by the aggregator via callId).
    const user = await getCurrentUserRecord(ctx);
    const callerKey = user
      ? await sha256Hex(`campus_caller:${user._id as unknown as string}`)
      : undefined;
    await ctx.db.insert("campusEvents", {
      agentId: campusAgentId,
      type: "call_completed",
      callId: args.callId,
      ...(callerKey ? { callerKey } : {}),
      durationSeconds: duration,
      createdAt: endMs,
    });

    // Meter call minutes against the OWNING account (Req 13.6). Usage is keyed
    // by ownerId, not agentId, so resolve the owner. A partial minute is rounded
    // up so any conversation consumes at least one minute (pure helper).
    const minutes = callMinutesFromDuration(duration);
    const agent = await getAgentById(ctx, campusAgentId);
    if (minutes > 0 && agent) {
      const period = periodKey(endMs);
      const ownerRow = await ctx.db
        .query("campusUsage")
        .withIndex("by_owner_and_period", (q) =>
          q.eq("ownerId", agent.ownerId).eq("period", period)
        )
        .first();
      if (ownerRow) {
        await ctx.db.patch(ownerRow._id, {
          callMinutesUsed: ownerRow.callMinutesUsed + minutes,
          updatedAt: endMs,
        });
      } else {
        await ctx.db.insert("campusUsage", {
          ownerId: agent.ownerId,
          period,
          callMinutesUsed: minutes,
          documentUploadsUsed: 0,
          agentCount: 0,
          updatedAt: endMs,
        });
      }
    }

    return { ok: true, callId: args.callId, duration };
  },
});
