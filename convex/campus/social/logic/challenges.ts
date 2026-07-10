/**
 * Feature: campus-social-loops (Task 4.1)
 *
 * Pure, property-testable core for the Challenge_Service (Daily Campus
 * Challenges, Requirement 2). These functions carry NO Convex `ctx` and perform
 * no I/O, so they can be exercised directly by unit and property tests and
 * imported by the Convex `social/challenges.ts` service that wraps them with
 * `campusChallenges` / `campusChallengeEntries` / `campusChallengeVotes` reads
 * and writes (`publishDailyChallenge`, `submitEntry`, `castChallengeVote`,
 * `getChallengeLeaderboard`, and the scheduled winner resolution).
 *
 * Covered behaviors:
 *   - 2.1: one Daily_Challenge per campus per local calendar day, a
 *     Challenge_Prompt bounded to 1–280 characters, a 24-hour submission window
 *     followed by a subsequent 24-hour voting window.
 *   - 2.2 / 2.3 / 2.4 / 2.5: submission is accepted only for an owned,
 *     `published` agent inside an open submission window and not already
 *     entered; otherwise the specific reason is identified.
 *   - 2.6 / 2.7: at most one Challenge_Vote per user per Daily_Challenge (the
 *     most recent selection counts), refused once voting closes.
 *   - 2.8 / 8.3: the Challenge_Leaderboard is descending by vote count,
 *     tie-broken by earliest submission, bounded to the top 20, and excludes
 *     any entry whose agent is private, removed, blocked, or deleted — reusing
 *     the shared {@link isDiscoverable} circulation invariant so social ranking
 *     can never diverge from Discovery_Service.
 *   - 2.9: the winning Challenge_Entry is the one with the greatest vote count,
 *     tie-broken by earliest submission; `null` when there are no entries.
 *
 * The leaderboard exclusion reuses {@link isDiscoverable} from the Campus access
 * module (`../../logic/access`) verbatim, exactly as the Discovery_Service
 * leaderboard does, so "in circulation" means the same thing everywhere.
 */

import {
  isDiscoverable,
  type PublishState,
  type Visibility,
} from "../../logic/access";

// ---------------------------------------------------------------------------
// Constants (Req 2.1)
// ---------------------------------------------------------------------------

/** Minimum length, in characters, of a Challenge_Prompt (Req 2.1). */
export const CHALLENGE_PROMPT_MIN = 1;

/** Maximum length, in characters, of a Challenge_Prompt (Req 2.1). */
export const CHALLENGE_PROMPT_MAX = 280;

/** Duration of a Daily_Challenge submission window, in milliseconds (Req 2.1). */
export const CHALLENGE_SUBMISSION_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Duration of a Daily_Challenge voting period, in milliseconds (Req 2.1). */
export const CHALLENGE_VOTING_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Maximum number of Challenge_Entries presented on a Challenge_Leaderboard —
 * the top count the ranking is bounded to (Req 2.8).
 */
export const MAX_CHALLENGE_LEADERBOARD_ENTRIES = 20;

// ---------------------------------------------------------------------------
// Prompt bounds (Req 2.1)
// ---------------------------------------------------------------------------

/**
 * True iff `prompt` is a valid Challenge_Prompt: its length is within the
 * inclusive range [{@link CHALLENGE_PROMPT_MIN}, {@link CHALLENGE_PROMPT_MAX}]
 * (Req 2.1). An empty prompt or one exceeding 280 characters is rejected. Pure.
 */
export function isValidChallengePrompt(prompt: string): boolean {
  return (
    prompt.length >= CHALLENGE_PROMPT_MIN &&
    prompt.length <= CHALLENGE_PROMPT_MAX
  );
}

// ---------------------------------------------------------------------------
// Daily_Challenge windows (Req 2.1)
// ---------------------------------------------------------------------------

/**
 * The submission and voting windows of a Daily_Challenge, expressed as absolute
 * millisecond timestamps derived from the campus-local calendar day start
 * (Req 2.1). Both windows are half-open intervals `[opensAt, closesAt)`: the
 * 24-hour submission window opens at the local day start, and the 24-hour
 * voting window opens exactly when submission closes.
 */
export interface ChallengeWindows {
  submissionOpensAt: number;
  submissionClosesAt: number;
  votingOpensAt: number;
  votingClosesAt: number;
}

/**
 * Derives the submission and voting windows for a Daily_Challenge from the
 * millisecond timestamp of the campus's local calendar-day start
 * (`localDayStartMs`) (Req 2.1). The submission window spans
 * `[localDayStartMs, localDayStartMs + 24h)` and the voting window spans the
 * subsequent `[submissionClosesAt, submissionClosesAt + 24h)`. Pure and
 * non-mutating.
 */
export function challengeWindows(localDayStartMs: number): ChallengeWindows {
  const submissionOpensAt = localDayStartMs;
  const submissionClosesAt = submissionOpensAt + CHALLENGE_SUBMISSION_WINDOW_MS;
  const votingOpensAt = submissionClosesAt;
  const votingClosesAt = votingOpensAt + CHALLENGE_VOTING_WINDOW_MS;
  return {
    submissionOpensAt,
    submissionClosesAt,
    votingOpensAt,
    votingClosesAt,
  };
}

/**
 * True iff `now` falls within the Daily_Challenge's submission window — the
 * half-open interval `[submissionOpensAt, submissionClosesAt)` — so the window
 * is open for exactly 24 hours (Req 2.1). Pure.
 */
export function isSubmissionOpen(w: ChallengeWindows, now: number): boolean {
  return now >= w.submissionOpensAt && now < w.submissionClosesAt;
}

/**
 * True iff `now` falls within the Daily_Challenge's voting period — the
 * half-open interval `[votingOpensAt, votingClosesAt)` — so the period is open
 * for exactly 24 hours (Req 2.1). Pure.
 */
export function isVotingOpen(w: ChallengeWindows, now: number): boolean {
  return now >= w.votingOpensAt && now < w.votingClosesAt;
}

// ---------------------------------------------------------------------------
// Submission validation (Req 2.2, 2.3, 2.4, 2.5)
// ---------------------------------------------------------------------------

/**
 * The outcome of validating a Challenge_Entry submission (Req 2.2–2.5). On
 * rejection the specific `reason` is identified so the service can present a
 * matching indication:
 *   - `not_owner`: the submitting user does not own the Campus_Agent (Req 2.3).
 *   - `not_published`: the Campus_Agent is not in the `published` Publish_State
 *     (Req 2.3).
 *   - `submission_closed`: the Daily_Challenge's submission window is closed
 *     (Req 2.5).
 *   - `already_entered`: the Campus_Agent has already entered this
 *     Daily_Challenge (Req 2.4).
 */
export type SubmitResult =
  | { accepted: true }
  | {
      accepted: false;
      reason:
        | "not_owner"
        | "not_published"
        | "submission_closed"
        | "already_entered";
      message: string;
    };

/**
 * Validates a Challenge_Entry submission (Req 2.2, 2.3, 2.4, 2.5). The
 * submission is accepted if and only if the submitting user owns the
 * Campus_Agent, the agent is in the `published` Publish_State, the
 * Daily_Challenge's submission window is open, and the agent has not already
 * entered that Daily_Challenge. Otherwise the first failing condition — in the
 * order ownership → published → open window → not already entered — determines
 * the rejection `reason`. Pure and non-mutating.
 */
export function validateChallengeEntry(input: {
  isOwner: boolean;
  agentStatus: PublishState;
  submissionOpen: boolean;
  agentAlreadyEntered: boolean;
}): SubmitResult {
  if (!input.isOwner) {
    return {
      accepted: false,
      reason: "not_owner",
      message: "You can only enter with an agent you own.",
    };
  }
  if (input.agentStatus !== "published") {
    return {
      accepted: false,
      reason: "not_published",
      message: "This agent must be published to enter the challenge.",
    };
  }
  if (!input.submissionOpen) {
    return {
      accepted: false,
      reason: "submission_closed",
      message: "This challenge is closed for submissions.",
    };
  }
  if (input.agentAlreadyEntered) {
    return {
      accepted: false,
      reason: "already_entered",
      message: "This agent has already entered this challenge.",
    };
  }
  return { accepted: true };
}

// ---------------------------------------------------------------------------
// Vote application (Req 2.6, 2.7)
// ---------------------------------------------------------------------------

/** A recorded Challenge_Vote: the voter and the entry they selected. */
export interface ChallengeVote {
  voterKey: string;
  entryId: string;
}

/**
 * The outcome of applying a Challenge_Vote (Req 2.6, 2.7). On acceptance
 * `votes` is the updated vote set; on rejection (`voting_closed`) `votes` is the
 * unchanged set, copied.
 */
export interface CastChallengeVoteResult {
  accepted: boolean;
  reason?: "voting_closed";
  votes: ChallengeVote[];
}

/**
 * Applies a Challenge_Vote to the current vote set (Req 2.6, 2.7). While voting
 * is open a user casts at most one vote per Daily_Challenge and the most recent
 * selection counts: any prior vote by the same `voterKey` is replaced by the
 * new selection. Once voting has closed the vote is refused (`voting_closed`)
 * and the existing votes are returned unchanged. Pure and non-mutating — a new
 * array is returned; the input `votes` is never modified.
 */
export function castChallengeVote(
  votes: readonly ChallengeVote[],
  input: { voterKey: string; entryId: string; votingOpen: boolean }
): CastChallengeVoteResult {
  if (!input.votingOpen) {
    return { accepted: false, reason: "voting_closed", votes: [...votes] };
  }
  // Drop any prior vote by this voter, then record the latest selection so at
  // most one vote per user per challenge survives (Req 2.6).
  const retained = votes.filter((v) => v.voterKey !== input.voterKey);
  retained.push({ voterKey: input.voterKey, entryId: input.entryId });
  return { accepted: true, votes: retained };
}

// ---------------------------------------------------------------------------
// Challenge_Leaderboard ranking (Req 2.8, 8.3) and winner (Req 2.9)
// ---------------------------------------------------------------------------

/**
 * A Challenge_Entry as far as ranking and winner resolution are concerned. The
 * `status` and `visibility` fields let {@link isDiscoverable} decide circulation
 * exactly as it does for Discovery_Service; `submittedAt` is the earliest-wins
 * tie-breaker and `votes` is the current Challenge_Vote count.
 */
export interface EntryView {
  entryId: string;
  agentId: string;
  status: PublishState;
  visibility: Visibility;
  submittedAt: number;
  votes: number;
}

/**
 * Orders entries by descending vote count, breaking ties in favor of the
 * earliest `submittedAt` and, for full determinism when submissions are
 * simultaneous, by `entryId`. Assumes `a` and `b` are distinct entries.
 */
function compareEntries(a: EntryView, b: EntryView): number {
  const byVotes = b.votes - a.votes;
  if (byVotes !== 0) return byVotes;
  const bySubmission = a.submittedAt - b.submittedAt;
  if (bySubmission !== 0) return bySubmission;
  return a.entryId.localeCompare(b.entryId);
}

/**
 * Ranks the Challenge_Entries of a Daily_Challenge for its Challenge_Leaderboard
 * (Req 2.8, 8.3).
 *
 * The ranking:
 *   1. retains only entries whose Campus_Agent is in circulation — `published`
 *      AND `public` (via {@link isDiscoverable}) — thereby excluding every
 *      private, removed, blocked, deleted, draft, publish_pending_link, or
 *      link_failed agent's entry (Req 2.8, 8.3);
 *   2. orders the remainder by descending Challenge_Vote count, breaking ties in
 *      favor of the earliest submitted entry (Req 2.8);
 *   3. bounds the result to the top {@link MAX_CHALLENGE_LEADERBOARD_ENTRIES}
 *      (Req 2.8).
 *
 * Pure and non-mutating (a new array is returned; the input is not modified).
 */
export function rankChallengeLeaderboard(
  entries: readonly EntryView[]
): EntryView[] {
  return entries
    .filter((entry) => isDiscoverable(entry))
    .slice()
    .sort(compareEntries)
    .slice(0, MAX_CHALLENGE_LEADERBOARD_ENTRIES);
}

/**
 * The presented Challenge_Leaderboard view for a Daily_Challenge (Req 2.8,
 * 2.10): the ranked, circulation-excluded, top-20 `entries`, together with the
 * `isEmpty` empty-state flag.
 */
export interface ChallengeLeaderboardView {
  entries: EntryView[];
  isEmpty: boolean;
}

/**
 * Builds the Challenge_Leaderboard presentation from the challenge's submitted
 * entries (Req 2.8, 2.10). `entries` are the Challenge_Entries submitted to the
 * Daily_Challenge (before circulation filtering). The returned `entries` are the
 * ranked result of {@link rankChallengeLeaderboard} (descending votes, tie-broken
 * by earliest submission, bounded to the top 20, circulation-excluded), and
 * `isEmpty` is `true` exactly when NO Challenge_Entry has been submitted — the
 * empty-state indication that no entries have been submitted (Req 2.10). Note
 * `isEmpty` is keyed on the submitted set, so a challenge whose only entries are
 * all out of circulation is not the empty-state (entries were submitted) even
 * though the ranked list is empty. Pure and non-mutating.
 */
export function buildChallengeLeaderboardView(
  entries: readonly EntryView[]
): ChallengeLeaderboardView {
  return {
    entries: rankChallengeLeaderboard(entries),
    isEmpty: entries.length === 0,
  };
}

/**
 * Resolves the winning Challenge_Entry of a Daily_Challenge (Req 2.9): the entry
 * with the greatest Challenge_Vote count, breaking ties in favor of the earliest
 * submitted entry (and, when submissions are simultaneous, the lexicographically
 * smallest `entryId` for determinism). Returns `null` when there are no entries.
 * Pure and non-mutating.
 */
export function resolveChallengeWinner(
  entries: readonly EntryView[]
): EntryView | null {
  if (entries.length === 0) {
    return null;
  }
  return entries.reduce((best, entry) =>
    compareEntries(entry, best) < 0 ? entry : best
  );
}
