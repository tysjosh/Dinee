/**
 * Feature: campus-social-loops (Task 11.1) — the `Battle_Service`.
 *
 * The thin Convex layer that creates, runs, votes on, resolves, and ranks
 * Agent_Battles, wrapping the pure, property-tested core in
 * `convex/campus/social/logic/battles.ts`. Every risky decision (create-request
 * validation, one-vote-per-voter with owner exclusion, winner-or-tie
 * resolution, the derived per-campus Battle_Ranking, the head-to-head Rivalry
 * fold, the abort-on-unpublish transition, and the 24-hour voting window) lives
 * in that pure module; this service only performs I/O and wires in the REUSED
 * primitives, exactly as the design's "reuse-over-duplication" discipline
 * requires:
 *
 *   - Access gate — the shared {@link evaluateAccess} (published + public |
 *     owner | valid Private_Link token) gates each Battle_Participant so a
 *     private, non-owned agent can never be pulled into a battle (Req 8.6).
 *   - Voice_Clone_Consent — the shared {@link evaluateConsentGate} blocks a
 *     real-person Battle_Participant lacking verified consent (Req 7.10, 7.11).
 *   - Usage_Meter — the shared {@link canStartCall} meters each participant's
 *     owning account so a battle response obeys the call-minutes limit
 *     (Req 8.4, 8.5).
 *   - Voice_Runtime — each participant is prompted through the EXISTING
 *     `campus` realtime pipeline ({@link buildRealtimeSessionConfig}) within a
 *     30-second budget; no separate voice pipeline is introduced (Req 1.3, 8.1).
 *   - Safety_Service — every participant-visible response is screened through
 *     the reused fail-closed `screenContent` / {@link decideScreening} before a
 *     battle opens for voting (Req 8.1).
 *   - Gamification_Service — a resolved battle records a `battles_won`
 *     Qualifying_Activity for the winner through the reused
 *     {@link recordQualifyingActivity} hand-off (Req 1.7 → Req 5).
 *   - Clip_Studio — a resolved battle whose both owners granted Sharing_Consent
 *     offers a Share_Clip through the reused clip-suggestion logic (Req 1.9).
 *
 * The `createBattle` orchestration is deliberately split so it is testable
 * WITHOUT a Convex runtime (this repo tests pure logic + in-memory seams rather
 * than `convex-test`): {@link generateBattleResponses} and {@link buildBattlePrompt}
 * are pure/injectable, so the "each participant is prompted, grounded, within
 * 30 s" behavior (Req 1.3) and the "runtime failure ⇒ `start_failed`, not
 * opened for voting" behavior (Req 1.11) are exercised directly by the example
 * tests. The Convex action injects the real Voice_Runtime-backed generator.
 */

import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "../../_generated/server";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { Doc } from "../../_generated/dataModel";
import { api, internal } from "../../_generated/api";
import { getCurrentUserRecord } from "../../shared/ownership";
import { generateSecureToken, sha256Hex } from "../../tokenHash";

import {
  validateBattleCreation,
  castBattleVote,
  resolveBattle,
  rankBattleWins,
  canonicalPairKey,
  foldRivalry,
  abortBattleOnUnpublish,
  battleVotingWindow,
  isBattleVotingOpen,
  type BattleFormat,
  type BattleVote,
  type BattleOutcome,
  type BattleWinRecord,
} from "./logic/battles";
import {
  evaluateAccess,
  type PrivateLinkRecord,
  type AgentAccessView,
} from "../logic/access";
import {
  evaluateConsentGate,
  type ConsentRecordView,
} from "../logic/consent";
import { canStartCall } from "../logic/usage";
import { resolveOwnerTier } from "../usage";
import { buildSocialVoiceSessionConfig } from "./companion";
import { decideClipSuggestion, SHARE_CLIP_MIN_SEC } from "./logic/clips";
import { AI_VOICE_AGENT_LABEL } from "../logic/share";
import { recordQualifyingActivity } from "./gamification";

type AnyCtx = QueryCtx | MutationCtx;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The Voice_Runtime response budget for a battle: each Battle_Participant must
 * produce its response within 30 seconds or the battle enters `start_failed`
 * and is not opened for voting (Req 1.3, 1.11).
 */
export const BATTLE_RESPONSE_TIMEOUT_MS = 30_000;

/** The realtime model used for battle responses (matches the campus voice path). */
const BATTLE_RESPONSE_MODEL = "gpt-realtime";

/** The winner Qualifying_Activity type recorded through the Gamification_Service. */
const BATTLES_WON_ACTIVITY = "battles_won" as const;

/** The calendar-month period key (`YYYY-MM`, UTC), matching the Usage_Meter. */
function periodKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 7);
}

// ---------------------------------------------------------------------------
// Battle prompt + response generation (pure/injectable seam — Req 1.3, 1.11)
// ---------------------------------------------------------------------------

/** A single approved Knowledge_Store grounding entry for a prompt. */
export interface BattleKnowledgeEntry {
  sourceId: string;
  content: string;
}

/**
 * The data needed to prompt one Battle_Participant through the Voice_Runtime,
 * grounded in that Campus_Agent's configured personality and Knowledge_Store
 * (Req 1.3). Assembled by {@link getBattleCreationContext} and consumed by
 * {@link generateBattleResponses}.
 */
export interface BattlePromptRequest {
  agentId: string;
  ownerId: string;
  agentName: string;
  voiceId: string;
  personalityTone: string;
  format: BattleFormat;
  knowledge: readonly BattleKnowledgeEntry[];
}

/** A Battle_Participant's produced Voice_Runtime response. */
export interface BattleParticipantResponse {
  agentId: string;
  /** The `calls` row correlating the response to its Campus_Agent (Req 8.1). */
  responseCallId: string;
  /** The participant-visible response text screened before voting opens. */
  transcript: string;
}

/**
 * The Voice_Runtime response generator — injected so the orchestration is
 * testable without a Convex runtime. The production implementation
 * (in {@link createBattle}) builds the realtime session config and correlates a
 * `calls` row; the tests supply a mock Realtime.
 */
export type GenerateBattleResponse = (
  request: BattlePromptRequest
) => Promise<BattleParticipantResponse>;

/**
 * The outcome of prompting both Battle_Participants (Req 1.3, 1.11):
 *   - `open`: every participant produced a response within the budget, so the
 *     battle may be opened for voting;
 *   - `start_failed`: at least one Voice_Runtime response failed or timed out,
 *     so the battle is NOT opened for voting and an error indication is carried.
 */
export type BattleStartOutcome =
  | { status: "open"; responses: BattleParticipantResponse[] }
  | { status: "start_failed"; error: string; failedAgentId?: string };

/**
 * Assembles the grounded Voice_Runtime prompt for one Battle_Participant
 * (Req 1.3). The prompt scopes the response to the selected Battle_Format and
 * grounds it in the Campus_Agent's configured personality tone and its approved
 * Knowledge_Store content, so a battle response can never draw on anything
 * outside the agent's configuration — the same grounding discipline as a normal
 * campus call. Pure and deterministic.
 */
export function buildBattlePrompt(input: {
  format: BattleFormat;
  agentName: string;
  personalityTone: string;
  knowledge: readonly BattleKnowledgeEntry[];
}): string {
  const knowledgeBlock =
    input.knowledge.length > 0
      ? input.knowledge.map((k) => `- ${k.content}`).join("\n")
      : "(no additional knowledge)";
  return (
    `You are ${input.agentName}, an ${AI_VOICE_AGENT_LABEL}. ` +
    `Produce a short spoken response for a ${input.format.replace(/_/g, " ")}. ` +
    `Stay in character with this personality/tone: ${input.personalityTone}. ` +
    `Answer strictly from your approved knowledge and nothing else:\n${knowledgeBlock}`
  );
}

/** Rejects `promise` after `ms` milliseconds with a timeout error (Req 1.3). */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("battle_response_timeout")),
      ms
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/** Normalizes a thrown value into a short error message string. */
function errorMessage(reason: unknown): string {
  if (reason instanceof Error) {
    return reason.message;
  }
  return typeof reason === "string" ? reason : "voice_runtime_error";
}

/**
 * Prompts every Battle_Participant through the injected Voice_Runtime generator,
 * each within the {@link BATTLE_RESPONSE_TIMEOUT_MS} budget (Req 1.3), and
 * decides whether the battle can open (Req 1.11). Pure with respect to its
 * injected `generate`: it performs no I/O of its own, so the example tests can
 * drive it with a mock Realtime.
 *
 * Every participant is prompted; if ANY response rejects or exceeds the budget,
 * the whole start fails (`start_failed`) — the battle is not opened for voting
 * and the first failing participant + error are reported (Req 1.11). Only when
 * every participant produced a response within the budget does the outcome
 * report `open` with the produced responses (Req 1.3).
 */
export async function generateBattleResponses(
  requests: readonly BattlePromptRequest[],
  generate: GenerateBattleResponse,
  timeoutMs: number = BATTLE_RESPONSE_TIMEOUT_MS
): Promise<BattleStartOutcome> {
  const settled = await Promise.allSettled(
    requests.map((request) => withTimeout(generate(request), timeoutMs))
  );

  const responses: BattleParticipantResponse[] = [];
  for (let i = 0; i < settled.length; i += 1) {
    const result = settled[i];
    if (result.status === "fulfilled") {
      responses.push(result.value);
    } else {
      return {
        status: "start_failed",
        error: errorMessage(result.reason),
        failedAgentId: requests[i]?.agentId,
      };
    }
  }

  return { status: "open", responses };
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

/** Loads a battle by its public `battleId`, or null when absent. */
async function getBattleById(
  ctx: AnyCtx,
  battleId: string
): Promise<Doc<"campusBattles"> | null> {
  return await ctx.db
    .query("campusBattles")
    .withIndex("by_battle_id", (q) => q.eq("battleId", battleId))
    .first();
}

/** Resolves an agent's Private_Link token records for the access gate. */
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

/** Resolves an agent's Voice_Clone_Consent records for the consent gate. */
async function resolveConsents(
  ctx: AnyCtx,
  agentId: string
): Promise<ConsentRecordView[]> {
  const rows = await ctx.db
    .query("campusVoiceCloneConsents")
    .withIndex("by_agent_id", (q) => q.eq("agentId", agentId))
    .collect();
  return rows.map((r) => ({
    agentId: r.agentId,
    method: r.method,
    verified: r.verified,
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
 * Resolves the requester id to hand the access gate. When the authenticated
 * user owns `agent`, returns the agent's `ownerId` so the owner check matches
 * whether ownership was recorded as the auth `_id` or the app `userId`;
 * otherwise returns the user's `_id`. Mirrors the Share_Service convention.
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

/** Builds grounded knowledge entries for an agent from its approved sources. */
async function resolveKnowledgeEntries(
  ctx: AnyCtx,
  agentId: string
): Promise<BattleKnowledgeEntry[]> {
  const sources = await ctx.db
    .query("campusKnowledgeSources")
    .withIndex("by_agent_id", (q) => q.eq("agentId", agentId))
    .collect();
  const entries: BattleKnowledgeEntry[] = [];
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

// ---------------------------------------------------------------------------
// getBattleCreationContext — validation + shared interaction lifecycle gates
// ---------------------------------------------------------------------------

/**
 * The result of resolving a battle-creation request in the default runtime
 * (where the caller's identity propagates), so the `createBattle` action can
 * read it via `ctx.runQuery`. It runs, in order, the pure
 * {@link validateBattleCreation} and then the shared interaction lifecycle
 * gates (access → consent → metering) for EACH Battle_Participant, so a battle
 * is only ever generated once every reused guarantee holds.
 */
type BattleCreationContext =
  | {
      ok: false;
      reason: "not_authenticated";
    }
  | {
      ok: false;
      reason: "validation";
      invalidField:
        | "participant_count"
        | "duplicate_participant"
        | "participant_not_published"
        | "format";
      message: string;
    }
  | {
      ok: false;
      reason: "access_denied" | "consent_required" | "call_minutes_exhausted";
      agentId: string;
    }
  | {
      ok: true;
      campusTag: string;
      requests: BattlePromptRequest[];
    };

/**
 * Validates an Agent_Battle create request and runs the shared interaction
 * lifecycle gates for each Battle_Participant (Req 1.1, 1.2, 8.4, 8.5, 8.6).
 * Delegates every decision to the reused pure primitives:
 *   1. {@link validateBattleCreation} — exactly two distinct `published`
 *      participants and a valid Battle_Format (Req 1.1, 1.2);
 *   2. {@link evaluateAccess} — each participant must be reachable by the
 *      creator (published + public, or owned, or valid token) (Req 8.6);
 *   3. {@link evaluateConsentGate} — a real-person participant needs verified
 *      Voice_Clone_Consent (Req 7.10, 7.11);
 *   4. {@link canStartCall} — each participant's owning account must be within
 *      its call-minutes limit (Req 8.4, 8.5).
 * On success it returns the grounded {@link BattlePromptRequest}s for the
 * Voice_Runtime; on any failure it returns a discriminated rejection that the
 * action surfaces unchanged.
 */
export const getBattleCreationContext = internalQuery({
  args: {
    participantAgentIds: v.array(v.string()),
    format: v.string(),
  },
  handler: async (ctx, args): Promise<BattleCreationContext> => {
    const user = await getCurrentUserRecord(ctx);
    if (!user) {
      return { ok: false, reason: "not_authenticated" };
    }

    // Resolve each requested participant (preserving order + duplicates so the
    // pure validation sees the request exactly as submitted).
    const agents = await Promise.all(
      args.participantAgentIds.map((id) => getAgentById(ctx, id))
    );

    // 1. Pure create-request validation (Req 1.1, 1.2). A missing agent is
    // treated as not-published so it is rejected with the same field the
    // property test expects.
    const validation = validateBattleCreation(
      args.participantAgentIds.map((id, i) => ({
        agentId: id,
        status: agents[i]?.status ?? "removed",
      })),
      args.format
    );
    if (!validation.valid) {
      return {
        ok: false,
        reason: "validation",
        invalidField: validation.invalidField,
        message: validation.message,
      };
    }

    // Validation guarantees the format is a Battle_Format and both agents exist.
    const format = args.format as BattleFormat;
    const now = Date.now();
    const requests: BattlePromptRequest[] = [];

    for (const agent of agents) {
      const resolved = agent as Doc<"campusAgents">;

      // 2. Access gate — the creator must be able to reach this participant
      // (Req 8.6). Withholds a private, non-owned agent with no detail.
      const privateLinks = await resolvePrivateLinks(ctx, resolved.agentId);
      const access = evaluateAccess({
        agent: agentToAccessView(resolved),
        requesterId: resolveRequesterId(user, resolved),
        token: null,
        privateLinks,
      });
      if (!access.granted) {
        return { ok: false, reason: "access_denied", agentId: resolved.agentId };
      }

      // 3. Voice_Clone_Consent gate for real-person agents (Req 7.10, 7.11).
      const consents = await resolveConsents(ctx, resolved.agentId);
      const consentGate = evaluateConsentGate({
        agentId: resolved.agentId,
        representsRealPerson: resolved.representsRealPerson === true,
        consents,
      });
      if (!consentGate.permitted) {
        return {
          ok: false,
          reason: "consent_required",
          agentId: resolved.agentId,
        };
      }

      // 4. Usage_Meter gate on the OWNING account's call minutes (Req 8.4, 8.5).
      const tier = await resolveOwnerTier(ctx, resolved.ownerId);
      const usageRow = await ctx.db
        .query("campusUsage")
        .withIndex("by_owner_and_period", (q) =>
          q.eq("ownerId", resolved.ownerId).eq("period", periodKey(now))
        )
        .first();
      const meter = canStartCall(usageRow?.callMinutesUsed ?? 0, tier);
      if (!meter.allowed) {
        return {
          ok: false,
          reason: "call_minutes_exhausted",
          agentId: resolved.agentId,
        };
      }

      requests.push({
        agentId: resolved.agentId,
        ownerId: resolved.ownerId,
        agentName: resolved.name,
        voiceId: resolved.voiceId,
        personalityTone: resolved.personalityTone,
        format,
        knowledge: await resolveKnowledgeEntries(ctx, resolved.agentId),
      });
    }

    // Per-campus ranking scope: both participants share a campus for a battle;
    // the first participant's campus tag scopes the resulting Battle_Ranking.
    const campusTag = agents[0]?.campusTag ?? "";
    return { ok: true, campusTag, requests };
  },
});

// ---------------------------------------------------------------------------
// persistBattleResponseCall — correlate a Voice_Runtime response to its agent
// ---------------------------------------------------------------------------

/**
 * Persists the `calls` row correlating a Battle_Participant's Voice_Runtime
 * response to its Campus_Agent (Req 8.1), and returns the server-minted
 * `callId`. Battle responses run on the EXISTING `campus` conversation type and
 * `calls`/`campusAgentId` correlation rather than a separate pipeline. Guarded
 * as an internal server-to-server function.
 */
export const persistBattleResponseCall = internalMutation({
  args: { agentId: v.string() },
  handler: async (ctx, args): Promise<{ callId: string }> => {
    const callId = `campusbattle_${generateSecureToken(16)}`;
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

// ---------------------------------------------------------------------------
// persistBattleOpen / persistBattleStartFailed — battle lifecycle writes
// ---------------------------------------------------------------------------

const participantValidator = v.object({
  agentId: v.string(),
  ownerId: v.string(),
  responseCallId: v.optional(v.string()),
});

const battleFormatValidator = v.union(
  v.literal("roast_battle"),
  v.literal("debate"),
  v.literal("trivia_showdown"),
  v.literal("advice_showdown"),
  v.literal("club_pitch_battle")
);

/**
 * Opens an Agent_Battle for voting (Req 1.3, 1.12): inserts the `campusBattles`
 * row in the `open` state with `openedAt` and `votingClosesAt = openedAt + 24h`
 * (the reused {@link battleVotingWindow}), then SCHEDULES
 * {@link resolveBattleScheduled} to fire at the close instant so the outcome is
 * resolved automatically. Returns the public `battleId`.
 */
export const persistBattleOpen = internalMutation({
  args: {
    battleId: v.string(),
    campusTag: v.string(),
    format: battleFormatValidator,
    participants: v.array(participantValidator),
    ageAppropriateFor: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<{ battleId: string; votingClosesAt: number }> => {
    const now = Date.now();
    const { closesAt } = battleVotingWindow(now);

    await ctx.db.insert("campusBattles", {
      battleId: args.battleId,
      campusTag: args.campusTag,
      format: args.format,
      participants: args.participants,
      status: "open",
      ageAppropriateFor: args.ageAppropriateFor,
      openedAt: now,
      votingClosesAt: closesAt,
      createdAt: now,
    });

    // Scheduled resolution at the close of the 24-hour voting window (Req 1.12).
    await ctx.scheduler.runAt(
      closesAt,
      internal.campus.social.battles.resolveBattleScheduled,
      { battleId: args.battleId }
    );

    return { battleId: args.battleId, votingClosesAt: closesAt };
  },
});

/**
 * Records an Agent_Battle that could not be started because a Voice_Runtime
 * response failed or timed out, or a participant-visible response was withheld
 * by screening (Req 1.11). The battle is inserted in the `start_failed` state
 * and is NEVER opened for voting (`openedAt`/`votingClosesAt` are left unset),
 * so it can never accumulate votes or resolve.
 */
export const persistBattleStartFailed = internalMutation({
  args: {
    battleId: v.string(),
    campusTag: v.string(),
    format: battleFormatValidator,
    participants: v.array(participantValidator),
    ageAppropriateFor: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<{ battleId: string }> => {
    const now = Date.now();
    await ctx.db.insert("campusBattles", {
      battleId: args.battleId,
      campusTag: args.campusTag,
      format: args.format,
      participants: args.participants,
      status: "start_failed",
      ageAppropriateFor: args.ageAppropriateFor,
      createdAt: now,
    });
    return { battleId: args.battleId };
  },
});

// ---------------------------------------------------------------------------
// resolveBattleScheduled — scheduled outcome + rivalry + winner activity + clip
// ---------------------------------------------------------------------------

/**
 * Upserts the head-to-head Rivalry record for the two participants of a
 * resolved battle (Req 1.7). The per-outcome delta is derived by the reused
 * {@link foldRivalry} over the single outcome, then added to the existing
 * canonical-pair record so the running totals reflect every resolved battle
 * between the pair.
 */
async function upsertRivalry(
  ctx: MutationCtx,
  agent1: string,
  agent2: string,
  outcome: BattleOutcome,
  now: number
): Promise<void> {
  const { pairKey, agentAId, agentBId } = canonicalPairKey(agent1, agent2);
  const delta = foldRivalry(agent1, agent2, [outcome]);

  const existing = await ctx.db
    .query("campusRivalries")
    .withIndex("by_pair_key", (q) => q.eq("pairKey", pairKey))
    .first();

  if (existing) {
    await ctx.db.patch(existing._id, {
      aWins: existing.aWins + delta.aWins,
      bWins: existing.bWins + delta.bWins,
      ties: existing.ties + delta.ties,
      battleCount: existing.battleCount + delta.battleCount,
      updatedAt: now,
    });
  } else {
    await ctx.db.insert("campusRivalries", {
      pairKey,
      agentAId,
      agentBId,
      aWins: delta.aWins,
      bWins: delta.bWins,
      ties: delta.ties,
      battleCount: delta.battleCount,
      updatedAt: now,
    });
  }
}

/**
 * Resolves an Agent_Battle at the close of its voting window (Req 1.6, 1.7,
 * 1.9). Idempotent: a battle not in the `open` state is left untouched, so a
 * re-fired schedule or an already-aborted battle is a no-op. On resolution it:
 *   1. tallies the recorded Battle_Votes and computes the Battle_Outcome via the
 *      reused {@link resolveBattle} (strictly greater count wins, else tie);
 *   2. writes the `outcome`, `resolvedAt`, and `resolved` status;
 *   3. upserts the head-to-head Rivalry record (Req 1.7);
 *   4. records a `battles_won` Qualifying_Activity for the winning owner through
 *      the reused Gamification_Service hand-off (Req 1.7 → Req 5);
 *   5. offers a Share_Clip when both owners granted Sharing_Consent (Req 1.9).
 */
export const resolveBattleScheduled = internalMutation({
  args: { battleId: v.string() },
  handler: async (ctx, args): Promise<{ resolved: boolean }> => {
    const battle = await getBattleById(ctx, args.battleId);
    if (!battle || battle.status !== "open") {
      // Aborted, already resolved, or missing — nothing to do (idempotent).
      return { resolved: false };
    }

    const participantAgentIds = battle.participants.map((p) => p.agentId) as [
      string,
      string
    ];

    const voteRows = await ctx.db
      .query("campusBattleVotes")
      .withIndex("by_battle_id", (q) => q.eq("battleId", args.battleId))
      .collect();
    const votes: BattleVote[] = voteRows.map((row) => ({
      voterKey: row.voterKey,
      choiceAgentId: row.choiceAgentId,
    }));

    const outcome = resolveBattle(votes, participantAgentIds);
    const now = Date.now();

    await ctx.db.patch(battle._id, {
      status: "resolved",
      outcome,
      resolvedAt: now,
    });

    // Rivalry record (Req 1.7).
    await upsertRivalry(
      ctx,
      participantAgentIds[0],
      participantAgentIds[1],
      outcome,
      now
    );

    // Winner Qualifying_Activity through the reused Gamification_Service
    // hand-off (Req 1.7 → Req 5). A tie awards nothing.
    if (outcome.kind === "winner") {
      const winner = battle.participants.find(
        (p) => p.agentId === outcome.winnerAgentId
      );
      if (winner) {
        await recordQualifyingActivity(ctx, {
          userId: winner.ownerId,
          activityType: BATTLES_WON_ACTIVITY,
          kind: "creator",
          nowMs: now,
        });
      }
    }

    // Offer a Share_Clip when both owners granted Sharing_Consent (Req 1.9).
    await maybeOfferBattleShareClip(ctx, battle, now);

    return { resolved: true };
  },
});

/**
 * Offers a Share_Clip for a resolved battle when — and only when — both
 * Battle_Participants' owners have granted Sharing_Consent (Req 1.9). The
 * suggestion itself is decided by the reused {@link decideClipSuggestion}
 * (a recorded source of sufficient length); the produced clip flows through the
 * existing Call_Clip pipeline that Clip_Studio extends. Absent a granted
 * Sharing_Consent for either owner, no clip is offered and the source is left
 * unchanged — so this is a no-op until Clip_Studio supplies the consent source.
 */
async function maybeOfferBattleShareClip(
  ctx: MutationCtx,
  battle: Doc<"campusBattles">,
  now: number
): Promise<void> {
  const consent = await bothOwnersConsentToShare(ctx, battle.participants);
  if (!consent.granted) {
    return;
  }

  const source = battle.participants.find(
    (p) => typeof p.responseCallId === "string" && p.responseCallId.length > 0
  );
  if (!source || !source.responseCallId) {
    return;
  }

  // Reuse the suggestion gate: a recorded source of at least the minimum length
  // is offered as a candidate Share_Clip (Req 1.9 → Req 3.1).
  const suggestion = decideClipSuggestion({
    recordingConsent: consent.recordingConsent,
    sourceDurationSec: consent.sourceDurationSec,
  });
  if (!suggestion.suggest) {
    return;
  }

  await ctx.db.insert("campusShareClips", {
    shareClipId: `SHARECLIP_${generateSecureToken(12)}`,
    sourceCallId: source.responseCallId,
    agentId: source.agentId,
    ownerId: source.ownerId,
    durationSec: SHARE_CLIP_MIN_SEC,
    hasCaptions: true,
    formats: ["tiktok", "reels", "snap"],
    label: AI_VOICE_AGENT_LABEL,
    status: "suggested",
    createdAt: now,
  });
}

/**
 * Resolves whether BOTH Battle_Participants' owners granted Sharing_Consent for
 * the resolved battle, plus the source recording facts the suggestion gate
 * needs (Req 1.9). Sharing_Consent for battle clips is sourced by Clip_Studio
 * (Req 3); until it is wired, no consent is on record, so this reports
 * `granted: false` and the battle offers no clip. Kept as a single seam so the
 * Clip_Studio task can supply the real consent lookup without touching the
 * resolution flow.
 */
async function bothOwnersConsentToShare(
  _ctx: MutationCtx,
  _participants: Doc<"campusBattles">["participants"]
): Promise<
  | { granted: false }
  | { granted: true; recordingConsent: boolean; sourceDurationSec: number }
> {
  return { granted: false };
}

// ---------------------------------------------------------------------------
// createBattle — validate → lifecycle gates → Voice_Runtime → screen → open
// ---------------------------------------------------------------------------

/** The inputs echoed back on every `createBattle` result. */
interface CreateBattleInputs {
  format: string;
  participantAgentIds: string[];
}

/** Discriminated outcome of `createBattle`, preserving the request inputs. */
type CreateBattleResult =
  | { created: true; battleId: string; votingClosesAt: number; inputs: CreateBattleInputs }
  | { created: false; reason: "not_authenticated"; inputs: CreateBattleInputs }
  | {
      created: false;
      reason: "validation";
      invalidField:
        | "participant_count"
        | "duplicate_participant"
        | "participant_not_published"
        | "format";
      message: string;
      inputs: CreateBattleInputs;
    }
  | {
      created: false;
      reason: "access_denied" | "consent_required" | "call_minutes_exhausted";
      agentId: string;
      inputs: CreateBattleInputs;
    }
  | {
      created: false;
      reason: "start_failed" | "content_withheld";
      error: string;
      battleId: string;
      inputs: CreateBattleInputs;
    };

/**
 * Creates an Agent_Battle (Req 1.1, 1.2, 1.3, 1.11, 8.1, 8.4, 8.5). The action:
 *   1. validates the request and runs the shared interaction lifecycle gates
 *      for each participant through {@link getBattleCreationContext} (access →
 *      Voice_Clone_Consent → call-minutes metering);
 *   2. prompts each participant through the Voice_Runtime within the 30-second
 *      budget via {@link generateBattleResponses}, grounded in personality +
 *      Knowledge_Store (Req 1.3); a failure/timeout records `start_failed` and
 *      does NOT open for voting (Req 1.11);
 *   3. screens every participant-visible response through the reused fail-closed
 *      Safety_Service (`screenContent` / `decideScreening`); a withheld response
 *      also records `start_failed` (Req 8.1);
 *   4. opens the battle for the 24-hour voting window on success.
 * Every result echoes the request inputs so the caller can reconcile the
 * outcome with what it submitted.
 */
export const createBattle = action({
  args: {
    format: v.string(),
    participantAgentIds: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<CreateBattleResult> => {
    const inputs: CreateBattleInputs = {
      format: args.format,
      participantAgentIds: args.participantAgentIds,
    };

    const context = await ctx.runQuery(
      internal.campus.social.battles.getBattleCreationContext,
      { participantAgentIds: args.participantAgentIds, format: args.format }
    );

    if (!context.ok) {
      if (context.reason === "validation") {
        return {
          created: false,
          reason: "validation",
          invalidField: context.invalidField,
          message: context.message,
          inputs,
        };
      }
      if (context.reason === "not_authenticated") {
        return { created: false, reason: "not_authenticated", inputs };
      }
      return { created: false, reason: context.reason, agentId: context.agentId, inputs };
    }

    const format = context.requests[0]?.format as BattleFormat;
    const participants = context.requests.map((r) => ({
      agentId: r.agentId,
      ownerId: r.ownerId,
    }));
    const battleId = `BATTLE_${generateSecureToken(12)}`;

    // The Voice_Runtime-backed generator: build the realtime session config on
    // the EXISTING campus pipeline (Req 8.1) and correlate a `calls` row. The
    // grounded prompt is the participant-visible content screened below.
    const generate: GenerateBattleResponse = async (request) => {
      const systemPrompt = buildBattlePrompt({
        format: request.format,
        agentName: request.agentName,
        personalityTone: request.personalityTone,
        knowledge: request.knowledge,
      });
      // Reuse the existing realtime session-config builder via the shared
      // Companion_Safety bridge — no new pipeline (Req 8.1).
      buildSocialVoiceSessionConfig({
        model: BATTLE_RESPONSE_MODEL,
        voiceId: request.voiceId,
        systemPrompt,
      });
      const { callId } = await ctx.runMutation(
        internal.campus.social.battles.persistBattleResponseCall,
        { agentId: request.agentId }
      );
      return {
        agentId: request.agentId,
        responseCallId: callId,
        transcript: systemPrompt,
      };
    };

    const outcome = await generateBattleResponses(context.requests, generate);

    // Runtime failure/timeout ⇒ start_failed, not opened for voting (Req 1.11).
    if (outcome.status === "start_failed") {
      await ctx.runMutation(
        internal.campus.social.battles.persistBattleStartFailed,
        {
          battleId,
          campusTag: context.campusTag,
          format,
          participants,
          ageAppropriateFor: [],
        }
      );
      return {
        created: false,
        reason: "start_failed",
        error: outcome.error,
        battleId,
        inputs,
      };
    }

    // Screen every participant-visible response fail-closed (Req 8.1).
    for (const response of outcome.responses) {
      const decision = await ctx.runAction(api.campus.safety.screenContent, {
        content: response.transcript,
        internalSecret: process.env.INTERNAL_API_KEY,
      });
      if (decision.withheld) {
        await ctx.runMutation(
          internal.campus.social.battles.persistBattleStartFailed,
          {
            battleId,
            campusTag: context.campusTag,
            format,
            participants,
            ageAppropriateFor: [],
          }
        );
        return {
          created: false,
          reason: "content_withheld",
          error: decision.error ?? "policy_violation",
          battleId,
          inputs,
        };
      }
    }

    // Attach each participant's response call and open for voting (Req 1.3).
    const openParticipants = participants.map((p) => {
      const response = outcome.responses.find((r) => r.agentId === p.agentId);
      return {
        agentId: p.agentId,
        ownerId: p.ownerId,
        responseCallId: response?.responseCallId,
      };
    });

    const { votingClosesAt } = await ctx.runMutation(
      internal.campus.social.battles.persistBattleOpen,
      {
        battleId,
        campusTag: context.campusTag,
        format,
        participants: openParticipants,
        ageAppropriateFor: [],
      }
    );

    return { created: true, battleId, votingClosesAt, inputs };
  },
});

// ---------------------------------------------------------------------------
// castVote — one vote per voter, owners excluded (Req 1.4, 1.5, 1.12)
// ---------------------------------------------------------------------------

/** Discriminated outcome of `castVote`. */
type CastVoteMutationResult =
  | { accepted: true; choiceAgentId: string }
  | {
      accepted: false;
      reason: "battle_not_found" | "owner_excluded" | "voting_closed" | "invalid_choice";
    };

/**
 * Records a Battle_Vote in an open Agent_Battle (Req 1.4, 1.5, 1.12). The pure
 * {@link castBattleVote} decides the outcome: at most one vote per voter (the
 * latest selection wins on change), the owner of either Battle_Participant is
 * excluded (`owner_excluded`, Req 1.5), a vote after the 24-hour window closes
 * is refused (`voting_closed`, Req 1.12), and a choice that is not one of the
 * two participants is rejected (`invalid_choice`). Uniqueness is backed by the
 * `campusBattleVotes.by_battle_and_voter` index, so a changed vote patches the
 * existing row rather than inserting a second.
 */
export const castVote = mutation({
  args: { battleId: v.string(), choiceAgentId: v.string() },
  handler: async (ctx, args): Promise<CastVoteMutationResult> => {
    const user = await getCurrentUserRecord(ctx);
    if (!user) {
      throw new Error("Unauthorized: authentication required");
    }

    const battle = await getBattleById(ctx, args.battleId);
    if (!battle) {
      return { accepted: false, reason: "battle_not_found" };
    }

    const participantAgentIds = battle.participants.map((p) => p.agentId) as [
      string,
      string
    ];
    const ownerIds = battle.participants.map((p) => p.ownerId);

    // Resolve the requester id so the pure owner-exclusion check matches whether
    // ownership was recorded as the auth `_id` or the app `userId`.
    const authId = user._id as unknown as string;
    const requesterId =
      ownerIds.includes(authId)
        ? authId
        : Boolean(user.userId) && ownerIds.includes(user.userId as string)
        ? (user.userId as string)
        : authId;

    const now = Date.now();
    const isOpen =
      battle.status === "open" &&
      typeof battle.openedAt === "number" &&
      isBattleVotingOpen(battle.openedAt, now);

    const voterKey = await sha256Hex(`campus_battle_voter:${authId}`);
    const existing = await ctx.db
      .query("campusBattleVotes")
      .withIndex("by_battle_and_voter", (q) =>
        q.eq("battleId", args.battleId).eq("voterKey", voterKey)
      )
      .first();

    const existingVotes: BattleVote[] = existing
      ? [{ voterKey, choiceAgentId: existing.choiceAgentId }]
      : [];

    const decision = castBattleVote(existingVotes, {
      voterKey,
      choiceAgentId: args.choiceAgentId,
      isOpen,
      participantAgentIds,
      ownerIds,
      requesterId,
    });

    if (!decision.accepted) {
      return { accepted: false, reason: decision.reason };
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        choiceAgentId: args.choiceAgentId,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("campusBattleVotes", {
        battleId: args.battleId,
        voterKey,
        choiceAgentId: args.choiceAgentId,
        updatedAt: now,
      });
    }

    return { accepted: true, choiceAgentId: args.choiceAgentId };
  },
});

// ---------------------------------------------------------------------------
// getBattleRanking — derived per-campus Battle_Ranking (Req 1.8, 8.3)
// ---------------------------------------------------------------------------

/**
 * Returns the per-campus Battle_Ranking (Req 1.8, 8.3). Battle_Ranking is
 * DERIVED — not stored — mirroring the existing derived Campus_Leaderboard: it
 * reads the campus's resolved battles, projects each winning agent's CURRENT
 * circulation view, and hands them to the reused {@link rankBattleWins}, which
 * applies the trailing 7-day window, descending win order, top-20 bound, and
 * the shared `isDiscoverable` + `matchesCampus` exclusion (private / removed /
 * blocked / deleted / off-campus agents are excluded). So the ranking can never
 * drift from the resolved outcomes.
 */
export const getBattleRanking = query({
  args: { campusTag: v.string(), now: v.optional(v.number()) },
  handler: async (
    ctx,
    args
  ): Promise<{ entries: { agentId: string; wins: number }[]; isEmpty: boolean }> => {
    const now = args.now ?? Date.now();

    const resolvedBattles = await ctx.db
      .query("campusBattles")
      .withIndex("by_campus_and_status", (q) =>
        q.eq("campusTag", args.campusTag).eq("status", "resolved")
      )
      .collect();

    const records: BattleWinRecord[] = [];
    for (const battle of resolvedBattles) {
      if (
        !battle.outcome ||
        battle.outcome.kind !== "winner" ||
        typeof battle.resolvedAt !== "number"
      ) {
        continue;
      }
      const agent = await getAgentById(ctx, battle.outcome.winnerAgentId);
      if (!agent) {
        continue;
      }
      records.push({
        agentId: agent.agentId,
        campusTag: agent.campusTag,
        status: agent.status,
        visibility: agent.visibility,
        resolvedAt: battle.resolvedAt,
      });
    }

    return rankBattleWins(records, args.campusTag, now);
  },
});

// ---------------------------------------------------------------------------
// onParticipantUnpublished — abort open battles on unpublish (Req 1.10)
// ---------------------------------------------------------------------------

/**
 * Aborts every open Agent_Battle that references a Campus_Agent which has
 * transitioned out of the `published` Publish_State (Req 1.10). For each such
 * battle the reused {@link abortBattleOnUnpublish} closes it to `aborted` with
 * no winner (never resolving a winner from a battle whose participant is gone).
 * Invoked by the agent-lifecycle transitions (block / remove / delete / unpublish).
 */
export const onParticipantUnpublished = internalMutation({
  args: { agentId: v.string() },
  handler: async (ctx, args): Promise<{ aborted: number }> => {
    const agent = await getAgentById(ctx, args.agentId);
    const openBattles = agent?.campusTag
      ? await ctx.db
          .query("campusBattles")
          .withIndex("by_campus_and_status", (q) =>
            q.eq("campusTag", agent.campusTag as string).eq("status", "open")
          )
          .collect()
      : await ctx.db
          .query("campusBattles")
          .filter((q) => q.eq(q.field("status"), "open"))
          .collect();

    let aborted = 0;
    for (const battle of openBattles) {
      if (!battle.participants.some((p) => p.agentId === args.agentId)) {
        continue;
      }
      // The named participant is no longer published; the others are assumed
      // still published — the pure gate decides the abort.
      const statuses = battle.participants.map((p) => ({
        status:
          p.agentId === args.agentId
            ? ("removed" as const)
            : ("published" as const),
      }));
      const decision = abortBattleOnUnpublish("open", statuses);
      if (decision.aborted) {
        await ctx.db.patch(battle._id, { status: decision.status });
        aborted += 1;
      }
    }

    return { aborted };
  },
});
