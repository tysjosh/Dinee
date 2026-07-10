/**
 * Feature: campus-social-loops (Task 17.1) — the shared `Companion_Safety`
 * guardrail service that wires the cross-cutting protections into every social
 * service.
 *
 * The pure, property-tested decision core lives in
 * `convex/campus/social/logic/companion.ts` (overattachment reminder/break
 * timing and the age-appropriateness filter) and in the reused Campus logic
 * modules; this file is the thin Convex + injectable-seam layer that CENTRALIZES
 * the guardrails so every social feature applies them the same way, in the same
 * order, on top of the REUSED primitives (no primitive is re-implemented here):
 *
 *   - Screening (Req 7.1–7.3, 8.1): every user-visible social-loops content
 *     item is passed through the reused fail-closed `decideScreening` (via the
 *     `api.campus.safety.screenContent` action). The battle/challenge/group/clip
 *     services each already call this on their own content; {@link screenSocialContent}
 *     is the single shared helper they share so the fail-closed contract can
 *     never diverge between features.
 *   - Overattachment (Req 7.4, 7.5): {@link applyCompanionInteraction} reads and
 *     writes the `campusCompanionInteractions` row for a (user, companion-agent)
 *     pair and applies the reused pure {@link evaluateCompanionInteraction} so a
 *     companion-style agent (`ai_twin`, `funny_character`) surfaces the
 *     AI-identity reminder before the first response of a continuous session and
 *     at least every 30 min thereafter, plus a take-a-break notice at each 60-min
 *     mark of gapless cumulative interaction.
 *   - Age-appropriateness (Req 7.7): {@link filterAgeAppropriate} restricts
 *     presented Daily_Challenges, Agent_Battles, and Campus_Quests for a minor
 *     viewer to content explicitly marked age-appropriate for that band.
 *   - Real-person consent (Req 7.10, 7.11): the reused {@link evaluateConsentGate}
 *     gates a real-person agent joining a battle/challenge/group session.
 *   - Usage metering (Req 8.4, 8.5): the reused {@link canStartCall} meters the
 *     owning account's call minutes before a social voice interaction starts.
 *   - Private access (Req 8.6): the reused {@link evaluateAccess} /
 *     {@link hasValidPrivateLinkToken} gate private-agent access, disclosing
 *     nothing on denial.
 *   - Self-harm escalation (Req 7.6): {@link routeSelfHarmEscalation} detects a
 *     self-harm disclosure in any social-loops interaction and triggers the
 *     REUSED Safety_Service escalation within a 5-second budget, recording it
 *     with a timestamp in `campusSafetyEscalations`. The
 *     {@link escalateSelfHarmDisclosure} action wires that seam to the reused
 *     `recordSelfHarmEscalation` mutation.
 *   - Voice_Runtime (Req 8.1): {@link buildSocialVoiceSessionConfig} is the
 *     single shared bridge to the EXISTING `buildRealtimeSessionConfig`, so
 *     battle/challenge/group voice paths all run on the existing campus
 *     Voice_Runtime rather than a separate pipeline.
 *
 * Following the repo discipline, every risky decision is a pure/injectable seam
 * exercised directly by the tests without a Convex runtime; the Convex functions
 * only perform I/O and hand off to those seams.
 */

import { v } from "convex/values";
import { action, internalMutation } from "../../_generated/server";
import type { ActionCtx } from "../../_generated/server";
import { api } from "../../_generated/api";
import type { ScreeningDecision } from "../logic/screening";

import {
  evaluateCompanionInteraction,
  filterAgeAppropriate,
  isCompanionAgentType,
  INITIAL_COMPANION_STATE,
  COMPANION_AGENT_TYPES,
  SESSION_GAP_MS,
  IDENTITY_REMINDER_INTERVAL_MS,
  BREAK_INTERVAL_MS,
  type CompanionState,
  type CompanionDecision,
  type AgeBand,
  type AgeMarkedContent,
} from "./logic/companion";
import {
  buildRealtimeSessionConfig,
  type RealtimeSessionConfig,
} from "../logic/realtime";
import type { AgentType } from "../logic/validation";

// Re-export the pure guardrail primitives so social services import the shared
// Companion_Safety surface from a single place (Req 7.4, 7.5, 7.7).
export {
  evaluateCompanionInteraction,
  filterAgeAppropriate,
  isCompanionAgentType,
  INITIAL_COMPANION_STATE,
  COMPANION_AGENT_TYPES,
  SESSION_GAP_MS,
  IDENTITY_REMINDER_INTERVAL_MS,
  BREAK_INTERVAL_MS,
};
export type { CompanionState, CompanionDecision, AgeBand, AgeMarkedContent };

// ---------------------------------------------------------------------------
// Self-harm escalation routing (Req 7.6) — pure/injectable seam
// ---------------------------------------------------------------------------

/**
 * The maximum latency, in milliseconds, within which a self-harm disclosure in
 * a social-loops interaction must trigger the configured escalation behavior
 * (Req 7.6). The escalation is recorded with a timestamp in
 * `campusSafetyEscalations`.
 */
export const SELF_HARM_ESCALATION_BUDGET_MS = 5_000;

/**
 * The escalation classification recorded for a self-harm disclosure, matching
 * the `campusSafetyEscalations.kind` union (Req 7.6, reused from Req 11.10).
 */
export const SELF_HARM_ESCALATION_KIND = "self_harm" as const;

/**
 * Case-insensitive substring cues that indicate a self-harm disclosure. These
 * are intentionally conservative, high-signal phrases; the Safety_Service's own
 * classifier remains the source of truth for screening, while this detector
 * exists only to ROUTE a disclosure surfaced in a social-loops interaction to
 * the reused escalation behavior (Req 7.6).
 */
const SELF_HARM_CUES: readonly string[] = [
  "kill myself",
  "killing myself",
  "end my life",
  "ending my life",
  "take my own life",
  "taking my own life",
  "suicide",
  "suicidal",
  "want to die",
  "wanna die",
  "hurt myself",
  "harm myself",
  "self-harm",
  "self harm",
  "cut myself",
  "cutting myself",
  "no reason to live",
  "don't want to be alive",
  "do not want to be alive",
];

/**
 * Detects whether `text` contains a self-harm disclosure (Req 7.6). Pure and
 * non-mutating: a case-insensitive scan for any high-signal cue. A non-string,
 * empty, or whitespace-only input is never a disclosure.
 */
export function detectSelfHarmDisclosure(text: string | null | undefined): boolean {
  if (typeof text !== "string") {
    return false;
  }
  const normalized = text.toLowerCase();
  return SELF_HARM_CUES.some((cue) => normalized.includes(cue));
}

/** The identifying context of a social-loops interaction being escalated. */
export interface SelfHarmEscalationContext {
  /** The Campus_Agent the interaction is with (correlates the escalation). */
  agentId: string;
  /** The `calls` row correlating the interaction, when one exists. */
  callId?: string;
  /** The configured escalation behavior; defaults to `"default"`. */
  behavior?: string;
}

/**
 * The audit record the reused escalation writes to `campusSafetyEscalations`.
 * Structurally satisfied by the result of the reused `recordSelfHarmEscalation`
 * mutation.
 */
export interface SelfHarmEscalationRecord {
  escalationId: string;
  triggeredAt: number;
}

/**
 * The injected escalation recorder — a seam so {@link routeSelfHarmEscalation}
 * can be exercised WITHOUT a Convex runtime. The production implementation (in
 * {@link escalateSelfHarmDisclosure}) delegates to the reused
 * `api.campus.safety.recordSelfHarmEscalation` mutation; the tests supply an
 * in-memory recorder that mimics the `campusSafetyEscalations` insert.
 */
export type RecordSelfHarmEscalation = (
  context: SelfHarmEscalationContext
) => Promise<SelfHarmEscalationRecord>;

/** The outcome of routing a potential self-harm disclosure (Req 7.6). */
export type SelfHarmEscalationOutcome =
  | {
      /** No disclosure detected: no escalation was triggered. */
      triggered: false;
    }
  | {
      /** A disclosure was detected and the escalation behavior was triggered. */
      triggered: true;
      /** The recorded escalation audit id. */
      escalationId: string;
      /** The timestamp the escalation was recorded (Req 7.6). */
      triggeredAt: number;
      /** The observed routing latency, in ms, measured against the budget. */
      latencyMs: number;
      /** Whether the escalation was recorded within {@link SELF_HARM_ESCALATION_BUDGET_MS}. */
      withinBudget: boolean;
    };

/**
 * Routes a social-loops interaction's content to the reused Safety_Service
 * self-harm escalation when — and only when — it contains a self-harm
 * disclosure (Req 7.6). Pure with respect to its injected `recordEscalation`
 * and clock: it detects a disclosure via {@link detectSelfHarmDisclosure}, and
 * on a hit triggers the escalation behavior and records it with a timestamp,
 * measuring the routing latency against the {@link SELF_HARM_ESCALATION_BUDGET_MS}
 * 5-second budget. Absent a disclosure it performs no escalation.
 *
 * The `startedAt`/`now` clock is injected so the test can assert the escalation
 * fires within the budget deterministically; in production the recorder's own
 * timestamp is used and `now` is `Date.now()` after the recorder resolves.
 */
export async function routeSelfHarmEscalation(
  content: string | null | undefined,
  context: SelfHarmEscalationContext,
  recordEscalation: RecordSelfHarmEscalation,
  clock: { startedAt: number; now: () => number } = {
    startedAt: Date.now(),
    now: () => Date.now(),
  }
): Promise<SelfHarmEscalationOutcome> {
  if (!detectSelfHarmDisclosure(content)) {
    return { triggered: false };
  }

  const record = await recordEscalation(context);
  const latencyMs = Math.max(0, clock.now() - clock.startedAt);

  return {
    triggered: true,
    escalationId: record.escalationId,
    triggeredAt: record.triggeredAt,
    latencyMs,
    withinBudget: latencyMs <= SELF_HARM_ESCALATION_BUDGET_MS,
  };
}

// ---------------------------------------------------------------------------
// Voice_Runtime reuse bridge (Req 8.1)
// ---------------------------------------------------------------------------

/**
 * The realtime model social voice interactions run on, matching the existing
 * campus voice path (Req 8.1). Battle responses, challenge entries, and group
 * responses all use this model through the shared builder below.
 */
export const SOCIAL_VOICE_MODEL = "gpt-realtime";

/**
 * Builds the OpenAI Realtime session config for ANY social-loops voice
 * interaction (battle response, challenge entry, group response) by delegating
 * to the EXISTING {@link buildRealtimeSessionConfig} (Req 8.1). This is the
 * single shared bridge to the campus Voice_Runtime, so every social voice path
 * runs on the same pipeline — with the same knowledge-lookup grounding tools —
 * rather than a separate one. Pure and non-mutating.
 */
export function buildSocialVoiceSessionConfig(input: {
  voiceId: string;
  systemPrompt: string;
  model?: string;
}): RealtimeSessionConfig {
  return buildRealtimeSessionConfig({
    model: input.model ?? SOCIAL_VOICE_MODEL,
    voiceId: input.voiceId,
    systemPrompt: input.systemPrompt,
  });
}

// ---------------------------------------------------------------------------
// Convex layer: companion interaction state (Req 7.4, 7.5)
// ---------------------------------------------------------------------------

/** Projects a stored `campusCompanionInteractions` row into a {@link CompanionState}. */
function rowToCompanionState(row: {
  sessionStartMs?: number;
  lastInteractionMs?: number;
  lastReminderMs?: number;
  cumulativeMs: number;
  breaksShown: number;
}): CompanionState {
  return {
    sessionStartMs: row.sessionStartMs ?? null,
    lastInteractionMs: row.lastInteractionMs ?? null,
    lastReminderMs: row.lastReminderMs ?? null,
    cumulativeMs: row.cumulativeMs,
    breaksShown: row.breaksShown,
  };
}

/**
 * Applies the Overattachment_Safeguard for a single interaction with a
 * companion-style Campus_Agent (Req 7.4, 7.5). Reads the persisted
 * `campusCompanionInteractions` row for the (user, agent) pair, applies the
 * reused pure {@link evaluateCompanionInteraction}, persists the next state, and
 * returns whether this interaction must surface an AI-identity reminder and/or a
 * take-a-break notice.
 *
 * For a non-companion `agentType` the safeguard does not apply: no reminder or
 * notice is surfaced and no state is written. Internal — invoked by the social
 * services as part of the shared interaction lifecycle.
 */
export const applyCompanionInteraction = internalMutation({
  args: {
    userId: v.string(),
    agentId: v.string(),
    agentType: v.string(),
    now: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ showIdentityReminder: boolean; showBreakNotice: boolean }> => {
    const agentType = args.agentType as AgentType;
    const now = args.now ?? Date.now();

    // Non-companion agents are never subject to the safeguard (Req 7.4, 7.5).
    if (!isCompanionAgentType(agentType)) {
      return { showIdentityReminder: false, showBreakNotice: false };
    }

    const existing = await ctx.db
      .query("campusCompanionInteractions")
      .withIndex("by_user_and_agent", (q) =>
        q.eq("userId", args.userId).eq("agentId", args.agentId)
      )
      .first();

    const state: CompanionState = existing
      ? rowToCompanionState(existing)
      : INITIAL_COMPANION_STATE;

    const decision: CompanionDecision = evaluateCompanionInteraction(
      state,
      agentType,
      now
    );

    const patch = {
      sessionStartMs: decision.next.sessionStartMs ?? undefined,
      lastInteractionMs: decision.next.lastInteractionMs ?? undefined,
      lastReminderMs: decision.next.lastReminderMs ?? undefined,
      cumulativeMs: decision.next.cumulativeMs,
      breaksShown: decision.next.breaksShown,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert("campusCompanionInteractions", {
        userId: args.userId,
        agentId: args.agentId,
        ...patch,
      });
    }

    return {
      showIdentityReminder: decision.showIdentityReminder,
      showBreakNotice: decision.showBreakNotice,
    };
  },
});

// ---------------------------------------------------------------------------
// Convex layer: self-harm escalation (Req 7.6)
// ---------------------------------------------------------------------------

/**
 * Routes a self-harm disclosure surfaced in a social-loops interaction to the
 * REUSED Safety_Service escalation (Req 7.6). Detects the disclosure via the
 * shared {@link routeSelfHarmEscalation} seam and, on a hit, triggers the
 * configured escalation behavior by recording it — with a timestamp — through
 * the reused `api.campus.safety.recordSelfHarmEscalation` mutation, within the
 * 5-second budget. Absent a disclosure it performs no escalation. Returns the
 * escalation outcome so the calling service can surface the escalation to the
 * user consistently.
 */
export const escalateSelfHarmDisclosure = action({
  args: {
    content: v.string(),
    agentId: v.string(),
    callId: v.optional(v.string()),
    behavior: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<SelfHarmEscalationOutcome> => {
    const startedAt = Date.now();
    return await routeSelfHarmEscalation(
      args.content,
      { agentId: args.agentId, callId: args.callId, behavior: args.behavior },
      async (context) => {
        const result = await ctx.runMutation(
          api.campus.safety.recordSelfHarmEscalation,
          {
            agentId: context.agentId,
            callId: context.callId,
            behavior: context.behavior,
            internalSecret: process.env.INTERNAL_API_KEY,
          }
        );
        return {
          escalationId: result.escalationId,
          triggeredAt: result.triggeredAt,
        };
      },
      { startedAt, now: () => Date.now() }
    );
  },
});

// ---------------------------------------------------------------------------
// Convex layer: shared screening helper (Req 7.1–7.3, 8.1)
// ---------------------------------------------------------------------------

/**
 * Screens a single user-visible social-loops content item through the REUSED
 * fail-closed Safety_Service (Req 7.1–7.3, 8.1). A thin wrapper over the reused
 * `api.campus.safety.screenContent` action so every social feature screens its
 * content identically — a violation or an unavailable screening dependency both
 * yield a withheld decision. Returns the reused {@link ScreeningDecision}
 * unchanged so callers apply the same withhold/flag/deliver logic.
 */
export async function screenSocialContent(
  ctx: ActionCtx,
  content: string,
  sourceId?: string
): Promise<ScreeningDecision> {
  return await ctx.runAction(api.campus.safety.screenContent, {
    content,
    sourceId,
    internalSecret: process.env.INTERNAL_API_KEY,
  });
}
