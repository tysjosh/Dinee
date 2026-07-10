/**
 * Feature: campus-social-loops (Task 2.2)
 *
 * Pure, property-testable core for the Companion_Safety guardrails — the
 * anti-overattachment reminder/break timing (Req 7.4, 7.5) and the
 * age-appropriateness filter for minors (Req 7.7). These functions carry NO
 * Convex `ctx` and perform no I/O, so they can be exercised directly by unit
 * and property tests and imported by the Convex services that wrap them
 * (`convex/campus/social/companion.ts`, backed by `campusCompanionInteractions`
 * for the interaction state and the additive `users.ageBand` field for the
 * viewer band). This mirrors the discipline used across `convex/campus/logic/**`.
 *
 * Covered behaviors:
 *   - 7.4 (Property 28): WHILE a user interacts with a companion-style
 *     Campus_Agent (Agent_Type `ai_twin` or `funny_character`), present an
 *     AI-identity reminder before the first response of a continuous
 *     interaction session and at least once every 30 minutes thereafter, where
 *     a continuous interaction session ends after a gap of 5 minutes or more
 *     without interaction.
 *   - 7.5 (Property 28): WHEN cumulative interaction with a single
 *     companion-style Campus_Agent with no gap of 5 minutes or more reaches 60
 *     minutes, present a take-a-break notice, and present a further notice at
 *     each subsequent 60-minute interval of such cumulative interaction.
 *   - 7.7 (Property 29): WHERE a viewer is a minor, restrict presented content
 *     (Daily_Challenges, Agent_Battles, Campus_Quests) to items explicitly
 *     marked age-appropriate for the minor band, excluding anything not so
 *     marked. Other bands (adult/unknown) are unaffected.
 */

import type { AgentType } from "../../logic/validation";

// ---------------------------------------------------------------------------
// Constants (Req 7.4, 7.5)
// ---------------------------------------------------------------------------

/**
 * The companion-style Agent_Types subject to the Overattachment_Safeguard
 * (Req 7.4, 7.5). Only `ai_twin` and `funny_character` agents receive
 * AI-identity reminders and take-a-break notices; every other Agent_Type is
 * left untouched by {@link evaluateCompanionInteraction}.
 */
export const COMPANION_AGENT_TYPES = ["ai_twin", "funny_character"] as const;

/** A companion-style Agent_Type (a member of {@link COMPANION_AGENT_TYPES}). */
export type CompanionAgentType = (typeof COMPANION_AGENT_TYPES)[number];

/**
 * The continuous-session gap (Req 7.4, 7.5). A gap of 5 minutes or more without
 * interaction ends the current continuous interaction session; the next
 * interaction begins a fresh session (resetting the cumulative interaction and
 * the break counter, and re-presenting the AI-identity reminder).
 */
export const SESSION_GAP_MS = 5 * 60 * 1000;

/**
 * The maximum interval between AI-identity reminders within a continuous
 * session (Req 7.4). A reminder is presented at session start and at least once
 * every 30 minutes thereafter.
 */
export const IDENTITY_REMINDER_INTERVAL_MS = 30 * 60 * 1000;

/**
 * The take-a-break cadence (Req 7.5). A take-a-break notice is presented at each
 * 60-minute mark of gapless cumulative interaction.
 */
export const BREAK_INTERVAL_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Overattachment safeguard (Req 7.4, 7.5)
// ---------------------------------------------------------------------------

/**
 * The persisted interaction state for a (user, companion-agent) pair,
 * structurally satisfied by a `campusCompanionInteractions` row. All time
 * fields are wall-clock milliseconds.
 *
 * - `sessionStartMs`: start of the current continuous session (`null` before
 *   the first interaction).
 * - `lastInteractionMs`: time of the most recent interaction (`null` before the
 *   first interaction), used to detect the 5-minute session gap.
 * - `lastReminderMs`: time the AI-identity reminder was last presented (`null`
 *   before the first interaction), used for the 30-minute cadence.
 * - `cumulativeMs`: gapless cumulative interaction time in the current session,
 *   used for the 60-minute take-a-break cadence.
 * - `breaksShown`: number of take-a-break notices already presented in the
 *   current session (the count of 60-minute marks already acknowledged).
 */
export interface CompanionState {
  sessionStartMs: number | null;
  lastInteractionMs: number | null;
  lastReminderMs: number | null;
  cumulativeMs: number;
  breaksShown: number;
}

/**
 * The outcome of {@link evaluateCompanionInteraction}: the next
 * {@link CompanionState} to persist and whether this interaction must surface an
 * AI-identity reminder and/or a take-a-break notice.
 */
export interface CompanionDecision {
  next: CompanionState;
  showIdentityReminder: boolean;
  showBreakNotice: boolean;
}

/** The initial {@link CompanionState} for a (user, companion-agent) pair. */
export const INITIAL_COMPANION_STATE: CompanionState = {
  sessionStartMs: null,
  lastInteractionMs: null,
  lastReminderMs: null,
  cumulativeMs: 0,
  breaksShown: 0,
};

/**
 * True iff `agentType` is a companion-style Agent_Type subject to the
 * Overattachment_Safeguard (Req 7.4, 7.5). Pure.
 */
export function isCompanionAgentType(
  agentType: AgentType
): agentType is CompanionAgentType {
  return (COMPANION_AGENT_TYPES as readonly string[]).includes(agentType);
}

/**
 * Evaluates a single interaction at time `now` with a companion-style
 * Campus_Agent against the persisted {@link CompanionState}, computing the next
 * state and whether to present an AI-identity reminder (Req 7.4) and/or a
 * take-a-break notice (Req 7.5).
 *
 * Rules:
 *   - For a non-companion `agentType`, no safeguard applies: the state is
 *     returned unchanged with both flags `false`.
 *   - A **new continuous session** begins when there is no prior interaction, or
 *     when the gap since the last interaction is at least 5 minutes
 *     ({@link SESSION_GAP_MS}). Starting a session resets the cumulative
 *     interaction and break counter to 0 and presents the AI-identity reminder
 *     before this (first) response.
 *   - Within a **continuing session**, the (non-negative) gap since the last
 *     interaction is added to the cumulative interaction time. The AI-identity
 *     reminder is presented again once at least 30 minutes
 *     ({@link IDENTITY_REMINDER_INTERVAL_MS}) have elapsed since the last
 *     reminder.
 *   - A take-a-break notice is presented whenever the cumulative interaction
 *     first reaches a new 60-minute mark ({@link BREAK_INTERVAL_MS}); crossing
 *     multiple marks in one step surfaces a single notice and advances
 *     `breaksShown` to the marks reached so the same mark is never repeated.
 *
 * Pure and non-mutating.
 */
export function evaluateCompanionInteraction(
  state: CompanionState,
  agentType: AgentType,
  now: number
): CompanionDecision {
  // Non-companion agents are never subject to the safeguard (Req 7.4, 7.5).
  if (!isCompanionAgentType(agentType)) {
    return { next: state, showIdentityReminder: false, showBreakNotice: false };
  }

  const isNewSession =
    state.lastInteractionMs === null ||
    state.sessionStartMs === null ||
    now - state.lastInteractionMs >= SESSION_GAP_MS;

  if (isNewSession) {
    // A fresh continuous session: reset cumulative + breaks, present the
    // AI-identity reminder before the first response (Req 7.4).
    const next: CompanionState = {
      sessionStartMs: now,
      lastInteractionMs: now,
      lastReminderMs: now,
      cumulativeMs: 0,
      breaksShown: 0,
    };
    return { next, showIdentityReminder: true, showBreakNotice: false };
  }

  // Continuing session: accrue the (clamped, non-negative) gap into the gapless
  // cumulative interaction time (Req 7.5).
  const gap = Math.max(0, now - (state.lastInteractionMs as number));
  const cumulativeMs = state.cumulativeMs + gap;

  // AI-identity reminder at least every 30 minutes (Req 7.4).
  const showIdentityReminder =
    state.lastReminderMs === null ||
    now - state.lastReminderMs >= IDENTITY_REMINDER_INTERVAL_MS;

  // Take-a-break notice at each new 60-minute mark of cumulative interaction
  // (Req 7.5).
  const marksReached = Math.floor(cumulativeMs / BREAK_INTERVAL_MS);
  const showBreakNotice = marksReached > state.breaksShown;

  const next: CompanionState = {
    sessionStartMs: state.sessionStartMs,
    lastInteractionMs: now,
    lastReminderMs: showIdentityReminder ? now : state.lastReminderMs,
    cumulativeMs,
    breaksShown: showBreakNotice ? marksReached : state.breaksShown,
  };

  return { next, showIdentityReminder, showBreakNotice };
}

// ---------------------------------------------------------------------------
// Age-appropriateness filter (Req 7.7)
// ---------------------------------------------------------------------------

/**
 * A viewer's declared age band, mirroring the additive `users.ageBand` field.
 * Rows without a declared band are treated as `"unknown"` (Req 7.7).
 */
export type AgeBand = "minor" | "adult" | "unknown";

/**
 * A presentable content item carrying its explicit age-appropriateness markers.
 * `ageAppropriateFor` lists the age bands the item is explicitly marked
 * appropriate for; an item not marked for a band is not appropriate for that
 * band. Structurally satisfied by a Daily_Challenge, Agent_Battle, or
 * Campus_Quest presentation view.
 */
export interface AgeMarkedContent {
  id: string;
  ageAppropriateFor: readonly AgeBand[];
}

/**
 * Restricts `items` to those a viewer in `viewerBand` may be presented
 * (Req 7.7). For a `minor` viewer, only items explicitly marked appropriate for
 * the `minor` band are kept, and every item not so marked (including items with
 * no markers) is excluded. For every other band (`adult`, `unknown`), all items
 * are returned unaffected.
 *
 * Returns a new array; the input is neither mutated nor reordered. Pure.
 */
export function filterAgeAppropriate<T extends AgeMarkedContent>(
  items: readonly T[],
  viewerBand: AgeBand
): T[] {
  if (viewerBand !== "minor") {
    return [...items];
  }
  return items.filter((item) => item.ageAppropriateFor.includes("minor"));
}
