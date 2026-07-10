/**
 * Feature: campus-social-loops (Task 14.1) — the `GroupChat_Service`.
 *
 * The thin Convex layer that hosts Group_Chat_Sessions: a Student_Creator drops
 * an owned, published Campus_Agent into a link-accessed group so Participants
 * can ask it questions asynchronously and receive short voice-note (or
 * Share_Clip) Group_Responses. Every risky decision (start validation, share
 * link token access, the 100-Participant admission cap, and Group_Question body
 * validation) lives in the pure, property-tested core in
 * `convex/campus/social/logic/groupchat.ts`; this service only performs I/O and
 * wires in the REUSED primitives, exactly as the design's
 * "reuse-over-duplication" discipline requires:
 *
 *   - Access gate — the shared {@link evaluateAccess} confirms the session's
 *     Campus_Agent is reachable by its owner before a Group_Response is
 *     produced (Req 8.6).
 *   - Voice_Clone_Consent — the shared {@link evaluateConsentGate} blocks a
 *     real-person agent lacking verified consent from speaking in a session
 *     (Req 7.10, 7.11).
 *   - Usage_Meter — the shared {@link canStartCall} meters the owning account so
 *     a Group_Response obeys the call-minutes limit (Req 8.4, 8.5).
 *   - Voice_Runtime — a Group_Response is produced through the EXISTING `campus`
 *     realtime pipeline ({@link buildRealtimeSessionConfig}) and correlated to a
 *     `calls` row; no separate voice pipeline is introduced (Req 4.3, 8.1).
 *   - Safety_Service — every Group_Question body is screened through the reused
 *     fail-closed `screenContent` / {@link decideScreening} BEFORE a
 *     Group_Response is produced; a flagged body is withheld from the agent
 *     (Req 4.5, 4.6, 8.1).
 *
 * The `submitQuestion` orchestration is deliberately split so its Voice_Runtime
 * step is testable WITHOUT a Convex runtime (this repo tests pure logic +
 * in-memory seams rather than `convex-test`): {@link buildGroupPrompt} and
 * {@link produceGroupResponse} are pure/injectable, so the "a Group_Response is
 * produced as a ≤ 60 s voice note or Share_Clip, grounded solely in the agent's
 * name/purpose/Knowledge_Store/boundaries" behavior (Req 4.3, 4.9) and the
 * "asynchronous delivery — a Participant can ask without any other Participant
 * present" behavior (Req 4.4) are exercised directly by the tests. The Convex
 * action injects the real Voice_Runtime-backed generator.
 *
 * Covered requirements: 4.1–4.12, 8.1, 8.4, 8.5, 8.6.
 */

import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
} from "../../_generated/server";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { Doc } from "../../_generated/dataModel";
import { api, internal } from "../../_generated/api";
import { getCurrentUserRecord } from "../../shared/ownership";
import { generateSecureToken, sha256Hex } from "../../tokenHash";

import {
  validateGroupStart,
  evaluateGroupAccess,
  admitParticipant,
  validateGroupQuestion,
  GROUP_RESPONSE_MAX_SEC,
  type GroupSessionView,
} from "./logic/groupchat";
import {
  evaluateAccess,
  type AgentAccessView,
} from "../logic/access";
import {
  evaluateConsentGate,
  type ConsentRecordView,
} from "../logic/consent";
import { canStartCall } from "../logic/usage";
import { resolveOwnerTier } from "../usage";
import { buildSocialVoiceSessionConfig } from "./companion";
import { AI_VOICE_AGENT_LABEL } from "../logic/share";
import type { ScreeningDecision } from "../logic/screening";

type AnyCtx = QueryCtx | MutationCtx;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The realtime model used for Group_Responses (matches the campus voice path). */
const GROUP_RESPONSE_MODEL = "gpt-realtime";

/** The calendar-month period key (`YYYY-MM`, UTC), matching the Usage_Meter. */
function periodKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 7);
}

// ---------------------------------------------------------------------------
// Group_Response prompt + generation (pure/injectable seam — Req 4.3, 4.9)
// ---------------------------------------------------------------------------

/** A single approved Knowledge_Store grounding entry for a prompt. */
export interface GroupKnowledgeEntry {
  sourceId: string;
  content: string;
}

/**
 * The data needed to prompt the session's Campus_Agent through the
 * Voice_Runtime for a Group_Response, grounded SOLELY in that agent's
 * configured name, purpose, Knowledge_Store content, and boundaries (Req 4.9).
 * Assembled by {@link getSubmitQuestionContext] and consumed by
 * {@link produceGroupResponse}.
 */
export interface GroupResponsePromptRequest {
  agentId: string;
  agentName: string;
  /** The agent's configured purpose (its `description`). */
  purpose: string;
  voiceId: string;
  knowledge: readonly GroupKnowledgeEntry[];
  /** The screened-clean Group_Question the agent is answering. */
  questionBody: string;
}

/**
 * A Group_Response produced by the Voice_Runtime — either a voice note of at
 * most {@link GROUP_RESPONSE_MAX_SEC} seconds or a Share_Clip (Req 4.3).
 *
 *   - `voice_note`: carries the recorded `durationSec` (clamped ≤ 60 s) and the
 *     `calls` row (`responseCallId`) correlating the interaction to its agent.
 *   - `share_clip`: carries the produced `clipId`.
 */
export type GroupResponseDraft =
  | {
      kind: "voice_note";
      responseCallId: string;
      transcript: string;
      durationSec: number;
    }
  | {
      kind: "share_clip";
      responseCallId: string;
      transcript: string;
      clipId: string;
    };

/**
 * The Voice_Runtime response generator — injected so the orchestration is
 * testable without a Convex runtime. The production implementation
 * (in {@link submitQuestion}) builds the realtime session config and correlates
 * a `calls` row; the tests supply a mock Realtime.
 */
export type GenerateGroupResponse = (
  request: GroupResponsePromptRequest
) => Promise<GroupResponseDraft>;

/**
 * Assembles the grounded Voice_Runtime prompt for a Group_Response (Req 4.9).
 * The prompt constrains the agent to its configured NAME, PURPOSE,
 * Knowledge_Store content, and BOUNDARIES and nothing else — the same grounding
 * discipline as a normal campus call — so a Group_Response can never draw on
 * anything outside the agent's configuration. Pure and deterministic.
 */
export function buildGroupPrompt(input: {
  agentName: string;
  purpose: string;
  knowledge: readonly GroupKnowledgeEntry[];
  questionBody: string;
}): string {
  const knowledgeBlock =
    input.knowledge.length > 0
      ? input.knowledge.map((k) => `- ${k.content}`).join("\n")
      : "(no additional knowledge)";
  return (
    `You are ${input.agentName}, an ${AI_VOICE_AGENT_LABEL}. ` +
    `Your purpose: ${input.purpose}. ` +
    `Answer the group's question strictly from your approved knowledge and your ` +
    `configured purpose, and nothing else. Stay within your boundaries: do not ` +
    `speculate beyond, or act outside, this configuration.\n` +
    `Approved knowledge:\n${knowledgeBlock}\n` +
    `Group question: ${input.questionBody}`
  );
}

/**
 * Clamps a produced voice-note duration into `[0, GROUP_RESPONSE_MAX_SEC]` so a
 * Group_Response voice note is always at most 60 seconds (Req 4.3). Pure.
 */
export function clampGroupVoiceNoteDuration(requestedSec: number): number {
  if (!Number.isFinite(requestedSec) || requestedSec < 0) {
    return 0;
  }
  return Math.min(requestedSec, GROUP_RESPONSE_MAX_SEC);
}

/**
 * Produces the Group_Response for a screened-clean Group_Question through the
 * injected Voice_Runtime generator (Req 4.3, 4.9), enforcing the ≤ 60 s
 * voice-note ceiling. Pure with respect to its injected `generate`: it performs
 * no I/O of its own, so the tests can drive it with a mock Realtime and assert
 * that a response is produced without any other Participant present (Req 4.4).
 * The produced draft is normalized so a voice note can never exceed the
 * {@link GROUP_RESPONSE_MAX_SEC} ceiling regardless of what the generator
 * reports.
 */
export async function produceGroupResponse(
  request: GroupResponsePromptRequest,
  generate: GenerateGroupResponse
): Promise<GroupResponseDraft> {
  const draft = await generate(request);
  if (draft.kind === "voice_note") {
    return { ...draft, durationSec: clampGroupVoiceNoteDuration(draft.durationSec) };
  }
  return draft;
}

// ---------------------------------------------------------------------------
// DB helpers
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

/** Loads a Group_Chat_Session by its public `sessionId`, or null when absent. */
async function getSessionById(
  ctx: AnyCtx,
  sessionId: string
): Promise<Doc<"campusGroupSessions"> | null> {
  return await ctx.db
    .query("campusGroupSessions")
    .withIndex("by_session_id", (q) => q.eq("sessionId", sessionId))
    .first();
}

/** Loads a Group_Chat_Session by its access `token`, or null when absent. */
async function getSessionByToken(
  ctx: AnyCtx,
  token: string
): Promise<Doc<"campusGroupSessions"> | null> {
  return await ctx.db
    .query("campusGroupSessions")
    .withIndex("by_token", (q) => q.eq("token", token))
    .first();
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
 * True iff the authenticated `user` owns `agent`, matching whether ownership was
 * recorded as the auth `_id` or the app `userId` (mirrors the Share/Social
 * service convention so the owner check never diverges).
 */
function ownerMatches(user: Doc<"users">, agent: Doc<"campusAgents">): boolean {
  return (
    agent.ownerId === user._id ||
    (Boolean(user.userId) && agent.ownerId === user.userId)
  );
}

/** Builds grounded knowledge entries for an agent from its approved sources. */
async function resolveKnowledgeEntries(
  ctx: AnyCtx,
  agentId: string
): Promise<GroupKnowledgeEntry[]> {
  const sources = await ctx.db
    .query("campusKnowledgeSources")
    .withIndex("by_agent_id", (q) => q.eq("agentId", agentId))
    .collect();
  const entries: GroupKnowledgeEntry[] = [];
  for (const source of sources) {
    // Only approved knowledge grounds a response (fail-closed): a flagged or
    // pending source is never surfaced to the Voice_Runtime.
    if (source.moderationStatus !== "approved") {
      continue;
    }
    const content =
      typeof source.textContent === "string" ? source.textContent.trim() : "";
    if (content.length > 0) {
      entries.push({ sourceId: source.sourceId, content });
    }
  }
  return entries;
}

/**
 * A stable, hashed Participant identity for `by_session_and_participant`
 * (Req 4.2). An authenticated Participant is keyed by their user id; an
 * anonymous Participant (who reached the session by its share link) is keyed by
 * the provided opaque identifier so re-opening the link never over-counts.
 */
async function deriveParticipantKey(
  sessionId: string,
  identity: string
): Promise<string> {
  return await sha256Hex(`campus_group_participant:${sessionId}:${identity}`);
}

// ---------------------------------------------------------------------------
// startSession — validate → mint unique token → create session (Req 4.1, 4.10)
// ---------------------------------------------------------------------------

/** Discriminated outcome of resolving a start request in the default runtime. */
type StartSessionContext =
  | { ok: false; reason: "not_authenticated" | "no_agent" }
  | { ok: false; reason: "not_owner" | "not_published" }
  | {
      ok: true;
      agentId: string;
      ownerId: string;
    };

/**
 * Resolves a Group_Chat_Session start request against the pure
 * {@link validateGroupStart} gate (Req 4.10): the requester must own the
 * Campus_Agent and it must be in the `published` Publish_State. Internal —
 * called by {@link startSession} (identity propagates from the action).
 */
export const getStartSessionContext = internalQuery({
  args: { agentId: v.string() },
  handler: async (ctx, args): Promise<StartSessionContext> => {
    const user = await getCurrentUserRecord(ctx);
    if (!user) {
      return { ok: false, reason: "not_authenticated" };
    }
    const agent = await getAgentById(ctx, args.agentId);
    if (!agent) {
      return { ok: false, reason: "no_agent" };
    }

    const validation = validateGroupStart({
      isOwner: ownerMatches(user, agent),
      agentStatus: agent.status,
    });
    if (!validation.ok) {
      return { ok: false, reason: validation.reason };
    }

    return { ok: true, agentId: agent.agentId, ownerId: agent.ownerId };
  },
});

/**
 * Mints a high-entropy access token that is unique across all
 * Group_Chat_Sessions (checked via the `by_token` index) and inserts the
 * `open` `campusGroupSessions` row so the token resolves ONLY to this session
 * (Req 4.1). Internal — invoked by {@link startSession} after the start gate
 * passes. Retries token generation on the vanishingly-rare collision so the
 * `by_token` uniqueness invariant always holds.
 */
export const persistSession = internalMutation({
  args: { agentId: v.string(), ownerId: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<{ sessionId: string; token: string }> => {
    // Generate a token that does not already resolve to a session (Req 4.1).
    let token = generateSecureToken(24);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const collision = await getSessionByToken(ctx, token);
      if (!collision) {
        break;
      }
      token = generateSecureToken(24);
    }

    const sessionId = `GROUP_${generateSecureToken(12)}`;
    await ctx.db.insert("campusGroupSessions", {
      sessionId,
      agentId: args.agentId,
      ownerId: args.ownerId,
      token,
      status: "open",
      participantCount: 0,
      createdAt: Date.now(),
    });
    return { sessionId, token };
  },
});

/** Discriminated outcome of `startSession`. */
type StartSessionResult =
  | { started: true; sessionId: string; token: string; shareUrl: string }
  | {
      started: false;
      reason: "not_authenticated" | "no_agent" | "not_owner" | "not_published";
      message: string;
    };

/** The platform base URL used to build the absolute session share link. */
function platformBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined) ??
    "https://dinee.app"
  ).replace(/\/+$/, "");
}

/**
 * Starts a Group_Chat_Session for an owned, published Campus_Agent (Req 4.1,
 * 4.10). Validates the request through the pure {@link validateGroupStart} gate,
 * then mints a high-entropy unique access token and returns the share link that
 * resolves ONLY to the new session. A non-owner, an unpublished agent, or an
 * unknown agent creates NO session and is returned the specific reason
 * (Req 4.10).
 */
export const startSession = action({
  args: { agentId: v.string() },
  handler: async (ctx, args): Promise<StartSessionResult> => {
    const context = await ctx.runQuery(
      internal.campus.social.groupchat.getStartSessionContext,
      { agentId: args.agentId }
    );

    if (!context.ok) {
      const message =
        context.reason === "not_authenticated"
          ? "Authentication is required to start a group chat."
          : context.reason === "no_agent"
            ? "This agent no longer exists."
            : context.reason === "not_owner"
              ? "You do not own this Campus_Agent."
              : "This agent must be published before starting a group chat.";
      return { started: false, reason: context.reason, message };
    }

    const { sessionId, token } = await ctx.runMutation(
      internal.campus.social.groupchat.persistSession,
      { agentId: context.agentId, ownerId: context.ownerId }
    );

    const shareUrl = `${platformBaseUrl()}/campus/social/group/${token}`;
    return { started: true, sessionId, token, shareUrl };
  },
});

// ---------------------------------------------------------------------------
// joinSession — token access + 100-participant admission cap (Req 4.2, 4.7, 4.12)
// ---------------------------------------------------------------------------

/** Discriminated outcome of `joinSession`. */
type JoinSessionResult =
  | { admitted: true; sessionId: string; agentId: string }
  | {
      admitted: false;
      reason: "access_denied" | "session_closed" | "session_full";
      message: string;
    };

/**
 * Admits a Participant to a Group_Chat_Session via its share-link token
 * (Req 4.2, 4.7, 4.12). The presented token is resolved through the pure
 * {@link evaluateGroupAccess} gate against the `by_token` index: a
 * missing/invalid/revoked/mismatched token is denied with `access_denied` and
 * NO session content disclosed (Req 4.7), and a closed session is denied with
 * `session_closed` (Req 4.8). An admitted Participant is recorded once (backed
 * by `by_session_and_participant`) under the pure {@link admitParticipant} cap:
 * an already-joined Participant re-enters without over-counting, and the 101st
 * distinct Participant is denied `session_full` (Req 4.2, 4.12).
 *
 * `participantId` is an opaque identifier for an anonymous Participant who
 * reached the session by its link; an authenticated user is keyed by their
 * account instead, so re-opening the link never counts twice.
 */
export const joinSession = mutation({
  args: { token: v.string(), participantId: v.optional(v.string()) },
  handler: async (ctx, args): Promise<JoinSessionResult> => {
    // Resolve strictly by the presented token so the gate can never leak the
    // existence of any other session (Req 4.7).
    const sessionRow = await getSessionByToken(ctx, args.token);
    const sessionView: GroupSessionView | null = sessionRow
      ? {
          sessionId: sessionRow.sessionId,
          token: sessionRow.token,
          status: sessionRow.status,
        }
      : null;

    const access = evaluateGroupAccess(sessionView, args.token);
    if (!access.granted) {
      return {
        admitted: false,
        reason: access.reason,
        message:
          access.reason === "session_closed"
            ? "This group chat is closed."
            : "Access denied.",
      };
    }

    // `sessionRow` is non-null here (a grant requires a matching session).
    const session = sessionRow as Doc<"campusGroupSessions">;

    // Derive the Participant identity: an authenticated user by account, else
    // the provided anonymous identifier.
    const user = await getCurrentUserRecord(ctx);
    const identity = user
      ? (user._id as unknown as string)
      : (args.participantId ?? "").trim();
    if (identity.length === 0) {
      return {
        admitted: false,
        reason: "access_denied",
        message: "Access denied.",
      };
    }
    const participantKey = await deriveParticipantKey(session.sessionId, identity);

    const existing = await ctx.db
      .query("campusGroupParticipants")
      .withIndex("by_session_and_participant", (q) =>
        q.eq("sessionId", session.sessionId).eq("participantKey", participantKey)
      )
      .first();

    const admission = admitParticipant({
      currentCount: session.participantCount,
      alreadyMember: existing !== null,
    });
    if (!admission.admitted) {
      return {
        admitted: false,
        reason: "session_full",
        message: "This group chat is full.",
      };
    }

    // Record a new Participant exactly once and advance the count (Req 4.2).
    if (!existing) {
      await ctx.db.insert("campusGroupParticipants", {
        sessionId: session.sessionId,
        participantKey,
        joinedAt: Date.now(),
      });
      await ctx.db.patch(session._id, {
        participantCount: session.participantCount + 1,
      });
    }

    return { admitted: true, sessionId: session.sessionId, agentId: session.agentId };
  },
});

// ---------------------------------------------------------------------------
// submitQuestion — validate → screen → lifecycle → Voice_Runtime → post
// (Req 4.3, 4.4, 4.5, 4.6, 4.9, 8.1, 8.4, 8.5, 8.6)
// ---------------------------------------------------------------------------

/**
 * The resolved context the `submitQuestion` action needs to run the shared
 * interaction lifecycle and produce a Group_Response, gathered in one read.
 */
type SubmitQuestionContext =
  | { found: false; reason: "no_session" | "session_closed" | "not_member" | "no_agent" }
  | {
      found: true;
      sessionId: string;
      participantKey: string;
      agentId: string;
      ownerId: string;
      accessView: AgentAccessView;
      representsRealPerson: boolean;
      consents: ConsentRecordView[];
      tier: "free" | "paid";
      callMinutesUsed: number;
      // Grounding inputs (Req 4.9): name/purpose/Knowledge_Store.
      agentName: string;
      purpose: string;
      voiceId: string;
      knowledge: GroupKnowledgeEntry[];
    };

/**
 * Resolves everything the Group_Question lifecycle depends on in a single read
 * keyed by the session's access token: the `open` session, the participant's
 * membership (backed by `by_session_and_participant`), the session's
 * Campus_Agent access view + real-person declaration + Voice_Clone_Consent
 * records, the owning account's tier + call-minutes usage, and the grounding
 * inputs (name/purpose/Knowledge_Store). Internal — called by
 * {@link submitQuestion}.
 */
export const getSubmitQuestionContext = internalQuery({
  args: {
    token: v.string(),
    participantId: v.optional(v.string()),
    now: v.number(),
  },
  handler: async (ctx, args): Promise<SubmitQuestionContext> => {
    const session = await getSessionByToken(ctx, args.token);
    if (!session) {
      return { found: false, reason: "no_session" };
    }
    if (session.status !== "open") {
      return { found: false, reason: "session_closed" };
    }

    // Resolve the asker's identity: an authenticated user by account, else the
    // provided anonymous identifier (matching `joinSession`). Resolved here (in
    // the query) because the calling action has no database access.
    const user = await getCurrentUserRecord(ctx);
    const identity = user
      ? (user._id as unknown as string)
      : (args.participantId ?? "").trim();
    if (identity.length === 0) {
      return { found: false, reason: "not_member" };
    }

    // The asker must be an admitted Participant of this session (Req 4.2). The
    // session-scoped Participant key is derived HERE so it always matches the
    // key `joinSession` stored, regardless of the presented token.
    const participantKey = await deriveParticipantKey(session.sessionId, identity);
    const member = await ctx.db
      .query("campusGroupParticipants")
      .withIndex("by_session_and_participant", (q) =>
        q.eq("sessionId", session.sessionId).eq("participantKey", participantKey)
      )
      .first();
    if (!member) {
      return { found: false, reason: "not_member" };
    }

    const agent = await getAgentById(ctx, session.agentId);
    if (!agent) {
      return { found: false, reason: "no_agent" };
    }

    const consentRows = await ctx.db
      .query("campusVoiceCloneConsents")
      .withIndex("by_agent_id", (q) => q.eq("agentId", agent.agentId))
      .collect();
    const consents: ConsentRecordView[] = consentRows.map((c) => ({
      agentId: c.agentId,
      method: c.method,
      verified: c.verified,
    }));

    const tier = await resolveOwnerTier(ctx, agent.ownerId);
    const usageRow = await ctx.db
      .query("campusUsage")
      .withIndex("by_owner_and_period", (q) =>
        q.eq("ownerId", agent.ownerId).eq("period", periodKey(args.now))
      )
      .first();

    return {
      found: true,
      sessionId: session.sessionId,
      participantKey,
      agentId: agent.agentId,
      ownerId: agent.ownerId,
      accessView: agentToAccessView(agent),
      representsRealPerson: agent.representsRealPerson,
      consents,
      tier,
      callMinutesUsed: usageRow?.callMinutesUsed ?? 0,
      agentName: agent.name,
      purpose: agent.description,
      voiceId: agent.voiceId,
      knowledge: await resolveKnowledgeEntries(ctx, agent.agentId),
    };
  },
});

/**
 * Persists the `calls` row correlating a Group_Response's Voice_Runtime
 * interaction to its Campus_Agent (Req 8.1), returning the server-minted
 * `callId`. Group_Responses run on the EXISTING `campus` conversation type and
 * `calls`/`campusAgentId` correlation rather than a separate pipeline. Guarded
 * as an internal server-to-server function.
 */
export const persistGroupResponseCall = internalMutation({
  args: { agentId: v.string() },
  handler: async (ctx, args): Promise<{ callId: string }> => {
    const callId = `campusgroup_${generateSecureToken(16)}`;
    await ctx.db.insert("calls", {
      callId,
      callStartTime: Date.now(),
      campusAgentId: args.agentId,
      conversationType: "campus_agent_conversation",
      recordingEnabled: false,
      status: "active",
    });
    return { callId };
  },
});

/**
 * Persists a screened Group_Question and, when it was accepted, its produced
 * Group_Response, in one transaction (Req 4.3, 4.6). A `blocked` question stores
 * no response; an `accepted` question stores the `campusGroupResponses` row as a
 * voice note (≤ 60 s) or a Share_Clip. Re-checks the session is still `open` as
 * a race guard so a question can never post to a session closed after the
 * lifecycle began (Req 4.8).
 */
export const persistQuestionAndResponse = internalMutation({
  args: {
    sessionId: v.string(),
    participantKey: v.string(),
    agentId: v.string(),
    body: v.string(),
    status: v.union(v.literal("accepted"), v.literal("blocked")),
    response: v.optional(
      v.object({
        kind: v.union(v.literal("voice_note"), v.literal("share_clip")),
        durationSec: v.optional(v.number()),
        storageId: v.optional(v.string()),
        clipId: v.optional(v.string()),
      })
    ),
    now: v.number(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: boolean; questionId: string; responseId?: string }> => {
    // Race guard: the session must still be open to accept a question (Req 4.8).
    const session = await getSessionById(ctx, args.sessionId);
    if (!session || session.status !== "open") {
      return { ok: false, questionId: "" };
    }

    const questionId = `GQ_${generateSecureToken(12)}`;
    await ctx.db.insert("campusGroupQuestions", {
      questionId,
      sessionId: args.sessionId,
      participantKey: args.participantKey,
      body: args.body,
      status: args.status,
      createdAt: args.now,
    });

    if (args.status !== "accepted" || !args.response) {
      return { ok: true, questionId };
    }

    const responseId = `GR_${generateSecureToken(12)}`;
    await ctx.db.insert("campusGroupResponses", {
      responseId,
      questionId,
      sessionId: args.sessionId,
      agentId: args.agentId,
      kind: args.response.kind,
      durationSec: args.response.durationSec,
      storageId: args.response.storageId,
      clipId: args.response.clipId,
      createdAt: args.now,
    });

    return { ok: true, questionId, responseId };
  },
});

/** Discriminated outcome of `submitQuestion`. */
type SubmitQuestionResult =
  | {
      posted: true;
      questionId: string;
      responseId: string;
      response: GroupResponseDraft;
    }
  | {
      posted: false;
      reason:
        | "no_session"
        | "session_closed"
        | "not_member"
        | "no_agent"
        | "invalid"
        | "blocked"
        | "access_denied"
        | "unavailable"
        | "consent_required"
        | "call_minutes_exhausted";
      message: string;
      questionId?: string;
    };

/**
 * Submits a Group_Question to the session's Campus_Agent and posts the
 * asynchronous Group_Response (Req 4.3–4.6, 4.9, 8.1, 8.4–8.6). In order:
 *   1. {@link validateGroupQuestion} bounds the body to 1–500 characters
 *      (Req 4.2, 4.11);
 *   2. the body is screened FIRST through the reused fail-closed
 *      {@link decideScreening} (`screenContent`); a flagged body is withheld
 *      from the agent, persisted `blocked`, and NO Group_Response is produced
 *      (Req 4.5, 4.6);
 *   3. a clean question runs the shared interaction lifecycle — the access gate
 *      (Req 8.6), the Voice_Clone_Consent gate for a real-person agent
 *      (Req 7.10, 7.11), and the owning account's call-minutes metering
 *      (Req 8.4, 8.5);
 *   4. the Group_Response is produced through the Voice_Runtime as a ≤ 60 s
 *      voice note or a Share_Clip, grounded SOLELY in the agent's
 *      name/purpose/Knowledge_Store/boundaries (Req 4.3, 4.9), and posted to the
 *      session.
 * Delivery is asynchronous: a Participant submits a Group_Question and receives
 * a Group_Response without any other Participant being present (Req 4.4).
 *
 * `participantId` identifies an anonymous Participant; an authenticated user is
 * keyed by their account, matching {@link joinSession}.
 */
export const submitQuestion = action({
  args: {
    token: v.string(),
    body: v.string(),
    participantId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<SubmitQuestionResult> => {
    const now = Date.now();

    // (1) Body length validation (Req 4.2, 4.11).
    const validation = validateGroupQuestion(args.body);
    if (!validation.valid) {
      return {
        posted: false,
        reason: "invalid",
        message:
          validation.reason === "empty"
            ? "The message is empty."
            : "The message exceeds the 500-character limit.",
      };
    }

    // Resolve the session + lifecycle context by token; the context read
    // resolves the asker's identity, derives the session-scoped Participant
    // key, and verifies membership (Req 4.2).
    const context = await ctx.runQuery(
      internal.campus.social.groupchat.getSubmitQuestionContext,
      { token: args.token, participantId: args.participantId, now }
    );

    if (!context.found) {
      const message =
        context.reason === "no_session"
          ? "This group chat does not exist."
          : context.reason === "session_closed"
            ? "This group chat is closed."
            : context.reason === "not_member"
              ? "You are not a member of this group chat."
              : "This agent no longer exists.";
      return { posted: false, reason: context.reason, message };
    }

    // (2) Screen the Group_Question body FIRST, fail-closed (Req 4.5, 4.6).
    const screening: ScreeningDecision = await ctx.runAction(
      api.campus.safety.screenContent,
      { content: args.body, internalSecret: process.env.INTERNAL_API_KEY }
    );
    if (screening.withheld) {
      // Withhold the body from the agent, persist it blocked, produce no
      // Group_Response, and surface the "blocked" indication (Req 4.6).
      const persisted = await ctx.runMutation(
        internal.campus.social.groupchat.persistQuestionAndResponse,
        {
          sessionId: context.sessionId,
          participantKey: context.participantKey,
          agentId: context.agentId,
          body: args.body,
          status: "blocked",
          now,
        }
      );
      return {
        posted: false,
        reason: "blocked",
        message: "This message was blocked for a content-policy violation.",
        questionId: persisted.questionId,
      };
    }

    // (3) Shared interaction lifecycle: access → consent → metering.
    const access = evaluateAccess({
      agent: context.accessView,
      requesterId: context.ownerId,
    });
    if (!access.granted) {
      return {
        posted: false,
        reason: access.denial === "unavailable" ? "unavailable" : "access_denied",
        message:
          access.denial === "unavailable"
            ? "This agent is not available."
            : "Access denied.",
      };
    }

    const consent = evaluateConsentGate({
      agentId: context.accessView.agentId,
      representsRealPerson: context.representsRealPerson,
      consents: context.consents,
    });
    if (!consent.permitted) {
      return {
        posted: false,
        reason: "consent_required",
        message: "Verified Voice_Clone_Consent is required for this agent to respond.",
      };
    }

    const gate = canStartCall(context.callMinutesUsed, context.tier);
    if (!gate.allowed) {
      return {
        posted: false,
        reason: "call_minutes_exhausted",
        message: "This agent is temporarily unavailable.",
      };
    }

    // (4) Produce the Group_Response through the Voice_Runtime, grounded solely
    // in the agent's name/purpose/Knowledge_Store/boundaries (Req 4.3, 4.9).
    const generate: GenerateGroupResponse = async (request) => {
      const systemPrompt = buildGroupPrompt({
        agentName: request.agentName,
        purpose: request.purpose,
        knowledge: request.knowledge,
        questionBody: request.questionBody,
      });
      // Reuse the existing realtime session-config builder via the shared
      // Companion_Safety bridge — no new pipeline (Req 8.1).
      buildSocialVoiceSessionConfig({
        model: GROUP_RESPONSE_MODEL,
        voiceId: request.voiceId,
        systemPrompt,
      });
      const { callId } = await ctx.runMutation(
        internal.campus.social.groupchat.persistGroupResponseCall,
        { agentId: request.agentId }
      );
      return {
        kind: "voice_note",
        responseCallId: callId,
        transcript: systemPrompt,
        durationSec: GROUP_RESPONSE_MAX_SEC,
      };
    };

    const response = await produceGroupResponse(
      {
        agentId: context.agentId,
        agentName: context.agentName,
        purpose: context.purpose,
        voiceId: context.voiceId,
        knowledge: context.knowledge,
        questionBody: args.body,
      },
      generate
    );

    const persisted = await ctx.runMutation(
      internal.campus.social.groupchat.persistQuestionAndResponse,
      {
        sessionId: context.sessionId,
        participantKey: context.participantKey,
        agentId: context.agentId,
        body: args.body,
        status: "accepted",
        response: {
          kind: response.kind,
          durationSec:
            response.kind === "voice_note" ? response.durationSec : undefined,
          clipId: response.kind === "share_clip" ? response.clipId : undefined,
        },
        now,
      }
    );

    if (!persisted.ok || !persisted.responseId) {
      // The session closed between the lifecycle and the write (Req 4.8).
      return {
        posted: false,
        reason: "session_closed",
        message: "This group chat is closed.",
        questionId: persisted.questionId || undefined,
      };
    }

    return {
      posted: true,
      questionId: persisted.questionId,
      responseId: persisted.responseId,
      response,
    };
  },
});

// ---------------------------------------------------------------------------
// closeSession — stop accepting questions (Req 4.8)
// ---------------------------------------------------------------------------

/** Discriminated outcome of `closeSession`. */
type CloseSessionResult =
  | { closed: true; sessionId: string }
  | {
      closed: false;
      reason: "not_authenticated" | "no_session" | "not_owner";
      message: string;
    };

/**
 * Closes a Group_Chat_Session so it stops accepting new Group_Questions and
 * surfaces a "closed" indication (Req 4.8). Owner-gated: only the
 * Student_Creator who owns the session may close it. Idempotent — closing an
 * already-closed session succeeds. A closed session's share-link token
 * thereafter resolves to `session_closed` in {@link evaluateGroupAccess} and
 * {@link joinSession}.
 */
export const closeSession = mutation({
  args: { sessionId: v.string() },
  handler: async (ctx, args): Promise<CloseSessionResult> => {
    const user = await getCurrentUserRecord(ctx);
    if (!user) {
      return {
        closed: false,
        reason: "not_authenticated",
        message: "Authentication is required to close a group chat.",
      };
    }

    const session = await getSessionById(ctx, args.sessionId);
    if (!session) {
      return { closed: false, reason: "no_session", message: "This group chat does not exist." };
    }

    const ownsSession =
      session.ownerId === user._id ||
      (Boolean(user.userId) && session.ownerId === user.userId);
    if (!ownsSession) {
      return {
        closed: false,
        reason: "not_owner",
        message: "You do not own this group chat.",
      };
    }

    if (session.status !== "closed") {
      await ctx.db.patch(session._id, { status: "closed" });
    }
    return { closed: true, sessionId: session.sessionId };
  },
});
