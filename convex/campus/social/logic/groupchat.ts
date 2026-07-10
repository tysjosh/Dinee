/**
 * Feature: campus-social-loops (Task 6.1)
 *
 * Pure, property-testable core for the `GroupChat_Service`: the risky decisions
 * behind starting a Group_Chat_Session, resolving a share-link access token,
 * enforcing the 100-participant admission cap, and validating a Group_Question
 * body (Requirements 4.1, 4.2, 4.7, 4.8, 4.10, 4.11, 4.12).
 *
 * These functions carry NO Convex `ctx` and perform no I/O, so they can be
 * exercised directly by unit and property tests and imported by the Convex
 * `social/groupchat.ts` service that wraps them with `campusGroupSessions` /
 * `campusGroupParticipants` / `campusGroupQuestions` reads and writes — the same
 * reuse-over-duplication discipline used by `convex/campus/logic/**` and the
 * sibling `battles.ts` / `challenges.ts` / `clips.ts` social modules.
 *
 * Reuse: {@link PublishState} is the shared publish-state type from the existing
 * access core rather than a redefined enum, so the start gate agrees with every
 * other place the platform reasons about the `published` state.
 */

import type { PublishState } from "../../logic/access";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum number of concurrent Participants a Group_Chat_Session admits
 * (Req 4.2, 4.12). A 101st Participant is denied as "full".
 */
export const GROUP_MAX_PARTICIPANTS = 100;

/** Minimum Group_Question length in characters (Req 4.2, 4.11). */
export const GROUP_QUESTION_MIN = 1;

/** Maximum Group_Question length in characters (Req 4.2, 4.11). */
export const GROUP_QUESTION_MAX = 500;

/**
 * Maximum Group_Response voice-note duration in seconds (Req 4.3). A
 * Group_Response is delivered as a voice note of at most this length or a
 * Share_Clip.
 */
export const GROUP_RESPONSE_MAX_SEC = 60;

// ---------------------------------------------------------------------------
// Start validation (Req 4.10)
// ---------------------------------------------------------------------------

/**
 * The outcome of validating a Group_Chat_Session start request (Req 4.10).
 *
 *   - `{ ok: true }`: the requester owns the Campus_Agent and it is in the
 *     `published` Publish_State, so a session may be created.
 *   - `{ ok: false; reason: "not_owner" }`: the requester does not own the
 *     Campus_Agent.
 *   - `{ ok: false; reason: "not_published" }`: the owned Campus_Agent is not in
 *     the `published` Publish_State.
 */
export type GroupStartResult =
  | { ok: true }
  | { ok: false; reason: "not_owner" | "not_published" };

/**
 * Validates a Group_Chat_Session start request (Req 4.10). A session may be
 * started if and only if the requester owns the Campus_Agent AND that agent is
 * in the `published` Publish_State. Ownership is checked first so a non-owner
 * learns nothing about the agent's publish state. Pure and deterministic.
 */
export function validateGroupStart(input: {
  isOwner: boolean;
  agentStatus: PublishState;
}): GroupStartResult {
  if (!input.isOwner) {
    return { ok: false, reason: "not_owner" };
  }
  if (input.agentStatus !== "published") {
    return { ok: false, reason: "not_published" };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Access gate (Req 4.7)
// ---------------------------------------------------------------------------

/**
 * The minimal view of a Group_Chat_Session needed to resolve a share-link
 * access token (Req 4.7): its id, its unique access token, and whether it is
 * `open` or `closed`. Carries no participant, question, or response content, so
 * the access gate can never leak session content on denial.
 */
export interface GroupSessionView {
  sessionId: string;
  token: string;
  status: "open" | "closed";
}

/**
 * The outcome of resolving a presented share-link token against a
 * Group_Chat_Session (Req 4.7).
 *
 *   - `{ granted: true; sessionId }`: the token exactly matches the session's
 *     token and the session is `open`.
 *   - `{ granted: false; reason: "access_denied" }`: the session is missing, or
 *     the presented token is missing/invalid/revoked/mismatched — nothing about
 *     the session is disclosed.
 *   - `{ granted: false; reason: "session_closed" }`: the token matches but the
 *     session is `closed`.
 */
export type GroupAccessResult =
  | { granted: true; sessionId: string }
  | { granted: false; reason: "access_denied" | "session_closed" };

/**
 * Resolves a presented share-link token against a Group_Chat_Session (Req 4.7).
 * Access is granted if and only if the token exactly matches the session's own
 * token and the session is `open`.
 *
 * A missing session, a missing/empty presented token, or any token that does
 * not exactly match is denied with `access_denied`, disclosing nothing about
 * whether a session exists. A token that matches an existing but `closed`
 * session is denied with `session_closed`. Pure and deterministic.
 */
export function evaluateGroupAccess(
  session: GroupSessionView | null | undefined,
  token: string | null | undefined
): GroupAccessResult {
  // No session to resolve, or no usable token presented: deny without
  // disclosing whether any session exists (Req 4.7).
  if (
    session === null ||
    session === undefined ||
    typeof token !== "string" ||
    token.length === 0
  ) {
    return { granted: false, reason: "access_denied" };
  }

  // The presented token must exactly match this session's token; a
  // mismatched/invalid/revoked token discloses nothing (Req 4.7).
  if (token !== session.token) {
    return { granted: false, reason: "access_denied" };
  }

  // The token matches, but a closed session admits no one (Req 4.8).
  if (session.status !== "open") {
    return { granted: false, reason: "session_closed" };
  }

  return { granted: true, sessionId: session.sessionId };
}

// ---------------------------------------------------------------------------
// Admission cap (Req 4.2, 4.12)
// ---------------------------------------------------------------------------

/**
 * The outcome of an admission attempt against the 100-participant cap
 * (Req 4.2, 4.12).
 *
 *   - `{ admitted: true }`: the Participant is already a member, or the session
 *     has fewer than {@link GROUP_MAX_PARTICIPANTS} current Participants.
 *   - `{ admitted: false; reason: "session_full" }`: the session is at capacity
 *     and the Participant is not already a member.
 */
export type AdmissionResult =
  | { admitted: true }
  | { admitted: false; reason: "session_full" };

/**
 * Decides whether a Participant is admitted to a Group_Chat_Session under the
 * 100-participant cap (Req 4.2, 4.12). An already-admitted Participant is always
 * (re)admitted — reopening the link never evicts them and never over-counts.
 * Otherwise a new Participant is admitted only while the current count is
 * strictly below {@link GROUP_MAX_PARTICIPANTS}; the (cap + 1)th distinct
 * Participant is denied as `session_full`. Pure and deterministic.
 */
export function admitParticipant(input: {
  currentCount: number;
  alreadyMember: boolean;
}): AdmissionResult {
  if (input.alreadyMember) {
    return { admitted: true };
  }
  if (input.currentCount < GROUP_MAX_PARTICIPANTS) {
    return { admitted: true };
  }
  return { admitted: false, reason: "session_full" };
}

// ---------------------------------------------------------------------------
// Question validation (Req 4.2, 4.11)
// ---------------------------------------------------------------------------

/**
 * The outcome of validating a Group_Question body (Req 4.2, 4.11).
 *
 *   - `{ valid: true }`: the body length is within [1, 500] characters.
 *   - `{ valid: false; reason: "empty" }`: the body is empty (0 characters).
 *   - `{ valid: false; reason: "too_long" }`: the body exceeds 500 characters.
 */
export type GroupQuestionResult =
  | { valid: true }
  | { valid: false; reason: "empty" | "too_long" };

/**
 * Validates a Group_Question body (Req 4.2, 4.11). A body is valid if and only
 * if its length is within `[GROUP_QUESTION_MIN, GROUP_QUESTION_MAX]`
 * (1–500) characters. A body below the minimum is `empty`; a body above the
 * maximum is `too_long`. Pure and deterministic; the emptiness check precedes
 * the length ceiling so a zero-length body is always reported as `empty`.
 */
export function validateGroupQuestion(body: string): GroupQuestionResult {
  if (body.length < GROUP_QUESTION_MIN) {
    return { valid: false, reason: "empty" };
  }
  if (body.length > GROUP_QUESTION_MAX) {
    return { valid: false, reason: "too_long" };
  }
  return { valid: true };
}
