/**
 * Feature: campus-social-loops (Task 3.1)
 *
 * Pure, property-testable core for the Battle_Service: create-request
 * validation, vote application (one-per-voter, owner exclusion), outcome
 * resolution (winner-or-tie), the derived per-campus Battle_Ranking, the
 * head-to-head Rivalry fold, the abort-on-unpublish transition, and the 24-hour
 * voting-window math (Requirements 1.1, 1.2, 1.4, 1.5, 1.6, 1.7, 1.8, 1.10,
 * 1.12, 8.3).
 *
 * These functions carry NO Convex `ctx` and perform no I/O, so they can be
 * exercised directly by unit and property tests and imported by the Convex
 * `social/battles.ts` service that wraps them with `campusBattles` /
 * `campusBattleVotes` / `campusRivalries` reads and writes — the same
 * reuse-over-duplication discipline used by `convex/campus/logic/**`.
 *
 * Reuse: the ranking exclusion invariant is NOT reimplemented here. It reuses
 * {@link isDiscoverable} (the shared published + public predicate) and
 * {@link matchesCampus} (the shared per-campus filter) from the existing
 * Discovery_Service core, so Battle_Ranking excludes private / removed /
 * blocked / deleted agents identically to the Campus_Leaderboard (Req 8.3).
 * Battle_Ranking is derived — not stored — mirroring the existing derived
 * Campus_Leaderboard, so it can never drift from the resolved outcomes.
 */

import {
  isDiscoverable,
  type PublishState,
  type Visibility,
} from "../../logic/access";
import { matchesCampus } from "../../logic/discovery";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Milliseconds in one day. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The defined set of Battle_Formats (Req 1.1). A create request whose format is
 * outside this set is rejected with `invalidField: "format"` (Req 1.2).
 */
export const BATTLE_FORMATS = [
  "roast_battle",
  "debate",
  "trivia_showdown",
  "advice_showdown",
  "club_pitch_battle",
] as const;

/** One of the five defined Battle_Formats (Req 1.1). */
export type BattleFormat = (typeof BATTLE_FORMATS)[number];

/**
 * Number of Battle_Participants an Agent_Battle requires — exactly two
 * (Req 1.1).
 */
export const BATTLE_PARTICIPANT_COUNT = 2;

/**
 * Maximum number of Campus_Agents presented on a Battle_Ranking — the top count
 * the ranking is bounded to (Req 1.8), matching the Campus_Leaderboard bound.
 */
export const MAX_BATTLE_RANKING_ENTRIES = 20;

/**
 * Trailing window, in days, over which Agent_Battle wins are counted for the
 * per-campus Battle_Ranking (Req 1.8).
 */
export const BATTLE_RANKING_WINDOW_DAYS = 7;

/**
 * The Agent_Battle voting window, in milliseconds — voting is open for exactly
 * 24 hours from the moment the battle opens (Req 1.12).
 */
export const BATTLE_VOTING_WINDOW_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The lifecycle state of an Agent_Battle:
 *   - `generating`: responses are being produced through the Voice_Runtime;
 *   - `open`: opened for voting within the 24-hour window (Req 1.12);
 *   - `resolved`: voting closed, Battle_Outcome computed (Req 1.6);
 *   - `aborted`: a participant left `published` while open (Req 1.10);
 *   - `start_failed`: the Voice_Runtime failed to produce a response (Req 1.11).
 */
export type BattleStatus =
  | "generating"
  | "open"
  | "resolved"
  | "aborted"
  | "start_failed";

/** A Battle_Participant: one of the two Campus_Agents in an Agent_Battle. */
export interface BattleParticipant {
  agentId: string;
  ownerId: string;
}

/**
 * The outcome of validating an Agent_Battle create request (Req 1.1, 1.2). On
 * rejection, `invalidField` names the specific failing dimension so the service
 * can surface an indication identifying the invalid field.
 */
export type BattleCreateResult =
  | { valid: true }
  | {
      valid: false;
      invalidField:
        | "participant_count"
        | "duplicate_participant"
        | "participant_not_published"
        | "format";
      message: string;
    };

/**
 * A single Battle_Vote: a Voter's selection of one Battle_Participant.
 * `voterKey` is the (hashed) voter identity used to enforce one-vote-per-voter.
 */
export interface BattleVote {
  voterKey: string;
  choiceAgentId: string;
}

/** The input to {@link castBattleVote}: the incoming vote plus its context. */
export interface CastVoteInput {
  voterKey: string;
  choiceAgentId: string;
  /** Whether the Agent_Battle's voting window is currently open (Req 1.12). */
  isOpen: boolean;
  /** The two Battle_Participant agent ids; a vote must choose one of them. */
  participantAgentIds: readonly [string, string];
  /** The owner ids of the two Battle_Participants (owners cannot vote). */
  ownerIds: readonly string[];
  /** The authenticated requester's id, used for the owner-exclusion check. */
  requesterId?: string;
}

/**
 * The outcome of applying a Battle_Vote (Req 1.4, 1.5, 1.12). On acceptance,
 * `votes` is the new tally (at most one vote per `voterKey`, latest wins). On
 * rejection, `votes` is returned unchanged so the tally is never mutated.
 */
export type CastVoteResult =
  | { accepted: true; votes: BattleVote[] }
  | {
      accepted: false;
      reason: "owner_excluded" | "voting_closed" | "invalid_choice";
      votes: BattleVote[];
    };

/** The resolved Battle_Outcome after voting closes (Req 1.6). */
export type BattleOutcome =
  | { kind: "winner"; winnerAgentId: string }
  | { kind: "tie" };

/**
 * A single resolved Agent_Battle win, as consumed by {@link rankBattleWins}.
 * Structurally a projection of a resolved `campusBattles` row joined with the
 * winning agent's circulation view. Extends nothing so it can be built from
 * either source; `status` + `visibility` feed the reused {@link isDiscoverable}
 * exclusion, `campusTag` feeds {@link matchesCampus}, and `resolvedAt` drives
 * the trailing-window filter.
 */
export interface BattleWinRecord {
  agentId: string;
  campusTag?: string;
  status: PublishState;
  visibility: Visibility;
  resolvedAt: number;
}

/** The result of a Battle_Ranking request (Req 1.8). */
export interface BattleRankingResult {
  entries: { agentId: string; wins: number }[];
  /** `true` exactly when no qualifying agent has a win in the window. */
  isEmpty: boolean;
}

/**
 * A head-to-head Rivalry record for a canonical agent pair (Req 1.7), mirroring
 * a `campusRivalries` row: `agentAId`/`agentBId` are the canonically sorted
 * pair, `aWins`/`bWins`/`ties` are their per-agent win and draw counts, and
 * `battleCount` is the total resolved battles between them.
 */
export interface RivalryRecord {
  pairKey: string;
  agentAId: string;
  agentBId: string;
  aWins: number;
  bWins: number;
  ties: number;
  battleCount: number;
}

/** The result of {@link abortBattleOnUnpublish} (Req 1.10). */
export interface AbortDecision {
  status: BattleStatus;
  /** `true` iff this call transitioned the battle to `aborted`. */
  aborted: boolean;
}

// ---------------------------------------------------------------------------
// Create-request validation (Req 1.1, 1.2)
// ---------------------------------------------------------------------------

/**
 * True iff `format` is one of the defined {@link BATTLE_FORMATS} (Req 1.1).
 * Pure.
 */
export function isBattleFormat(format: string): format is BattleFormat {
  return (BATTLE_FORMATS as readonly string[]).includes(format);
}

/**
 * Validates an Agent_Battle create request (Req 1.1, 1.2). Creation is accepted
 * if and only if there are exactly two distinct Battle_Participants, both in the
 * `published` Publish_State, and `format` is a defined Battle_Format. Otherwise
 * the first failing dimension is reported via `invalidField`, checked in the
 * order: participant count → duplicate participant → participant not published →
 * format. Pure and non-mutating.
 */
export function validateBattleCreation(
  participants: readonly { agentId: string; status: PublishState }[],
  format: string
): BattleCreateResult {
  // Exactly two Battle_Participants (Req 1.1, 1.2).
  if (participants.length !== BATTLE_PARTICIPANT_COUNT) {
    return {
      valid: false,
      invalidField: "participant_count",
      message: `An Agent_Battle requires exactly ${BATTLE_PARTICIPANT_COUNT} Battle_Participants.`,
    };
  }

  // The two Battle_Participants must be distinct Campus_Agents (Req 1.2).
  const distinctIds = new Set(participants.map((p) => p.agentId));
  if (distinctIds.size !== participants.length) {
    return {
      valid: false,
      invalidField: "duplicate_participant",
      message:
        "An Agent_Battle requires two distinct Campus_Agents as Battle_Participants.",
    };
  }

  // Both Battle_Participants must be in the `published` Publish_State (Req 1.2).
  if (participants.some((p) => p.status !== "published")) {
    return {
      valid: false,
      invalidField: "participant_not_published",
      message: "Every Battle_Participant must be a published Campus_Agent.",
    };
  }

  // The Battle_Format must be one of the defined formats (Req 1.1, 1.2).
  if (!isBattleFormat(format)) {
    return {
      valid: false,
      invalidField: "format",
      message: "The Battle_Format is not one of the defined formats.",
    };
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Vote application (Req 1.4, 1.5, 1.12)
// ---------------------------------------------------------------------------

/**
 * Applies an incoming Battle_Vote to the current tally (Req 1.4, 1.5, 1.12).
 *
 * A vote is rejected — leaving the tally unchanged — when:
 *   - the voting window is closed (`voting_closed`, Req 1.12);
 *   - the requester owns either Battle_Participant (`owner_excluded`, Req 1.5);
 *   - the chosen agent is not one of the two participants (`invalid_choice`).
 *
 * Otherwise the vote is recorded so that a Voter holds at most one vote per
 * Agent_Battle, and a repeated vote from the same `voterKey` replaces the prior
 * selection (the most recent selection wins, Req 1.4). Pure and non-mutating:
 * a new `votes` array is returned; the input array is never modified.
 */
export function castBattleVote(
  votes: readonly BattleVote[],
  input: CastVoteInput
): CastVoteResult {
  // Voting is open for exactly 24 hours; a vote after close is refused
  // (Req 1.12).
  if (!input.isOpen) {
    return { accepted: false, reason: "voting_closed", votes: [...votes] };
  }

  // The owner of either Battle_Participant cannot vote in that Agent_Battle
  // (Req 1.5).
  if (
    typeof input.requesterId === "string" &&
    input.requesterId.length > 0 &&
    input.ownerIds.includes(input.requesterId)
  ) {
    return { accepted: false, reason: "owner_excluded", votes: [...votes] };
  }

  // A vote must select one of the two Battle_Participants.
  if (!input.participantAgentIds.includes(input.choiceAgentId)) {
    return { accepted: false, reason: "invalid_choice", votes: [...votes] };
  }

  // At most one vote per Voter, latest selection wins (Req 1.4): drop any
  // existing vote by this voter, then append the new selection.
  const retained = votes.filter((v) => v.voterKey !== input.voterKey);
  retained.push({ voterKey: input.voterKey, choiceAgentId: input.choiceAgentId });
  return { accepted: true, votes: retained };
}

// ---------------------------------------------------------------------------
// Outcome resolution (Req 1.6)
// ---------------------------------------------------------------------------

/**
 * Resolves the Battle_Outcome from the final tally (Req 1.6): the
 * Battle_Participant with the strictly greater Battle_Vote count wins;
 * equal counts (including 0–0) resolve as a tie. Votes for anything other than
 * the two participants are ignored. Pure.
 */
export function resolveBattle(
  votes: readonly BattleVote[],
  participantAgentIds: readonly [string, string]
): BattleOutcome {
  const [agentA, agentB] = participantAgentIds;
  let aCount = 0;
  let bCount = 0;
  for (const vote of votes) {
    if (vote.choiceAgentId === agentA) {
      aCount += 1;
    } else if (vote.choiceAgentId === agentB) {
      bCount += 1;
    }
  }

  if (aCount > bCount) {
    return { kind: "winner", winnerAgentId: agentA };
  }
  if (bCount > aCount) {
    return { kind: "winner", winnerAgentId: agentB };
  }
  return { kind: "tie" };
}

// ---------------------------------------------------------------------------
// Battle_Ranking (Req 1.8, 8.3)
// ---------------------------------------------------------------------------

/**
 * Ranks a campus's Campus_Agents by Agent_Battle wins within the trailing
 * window (Req 1.8, 8.3). The ranking:
 *   1. keeps only win records inside the trailing `windowDays`-day window
 *      ending at `now`;
 *   2. keeps only agents that are `published` + `public` (via the reused
 *      {@link isDiscoverable}) AND match `campus` (via the reused
 *      {@link matchesCampus}), thereby excluding every private, removed,
 *      blocked, deleted, draft, publish_pending_link, or link_failed agent and
 *      every agent from another campus (Req 1.8, 8.3);
 *   3. tallies wins per surviving agent;
 *   4. orders by descending win count, breaking ties by `agentId` for a
 *      deterministic ordering;
 *   5. bounds the result to the top {@link MAX_BATTLE_RANKING_ENTRIES}.
 *
 * `isEmpty` is `true` exactly when no qualifying agent has a win in the window.
 * Pure and non-mutating.
 */
export function rankBattleWins(
  outcomes: readonly BattleWinRecord[],
  campus: string,
  now: number,
  windowDays: number = BATTLE_RANKING_WINDOW_DAYS
): BattleRankingResult {
  const windowStart = now - windowDays * MS_PER_DAY;

  const wins = new Map<string, number>();
  for (const record of outcomes) {
    // Trailing-window filter (Req 1.8).
    if (record.resolvedAt < windowStart || record.resolvedAt > now) {
      continue;
    }
    // Reused published + public + campus exclusion (Req 1.8, 8.3).
    if (!isDiscoverable(record) || !matchesCampus(record, campus)) {
      continue;
    }
    wins.set(record.agentId, (wins.get(record.agentId) ?? 0) + 1);
  }

  const entries = Array.from(wins.entries())
    .map(([agentId, count]) => ({ agentId, wins: count }))
    .sort((a, b) => {
      const diff = b.wins - a.wins;
      if (diff !== 0) return diff;
      return a.agentId.localeCompare(b.agentId);
    })
    .slice(0, MAX_BATTLE_RANKING_ENTRIES);

  return { entries, isEmpty: entries.length === 0 };
}

// ---------------------------------------------------------------------------
// Rivalry fold (Req 1.7)
// ---------------------------------------------------------------------------

/**
 * Derives the canonical, order-independent identity of an agent pair (Req 1.7):
 * the two ids sorted lexicographically, with `pairKey` their `"a|b"` join. So
 * `(X, Y)` and `(Y, X)` always yield the same `pairKey`, `agentAId`, and
 * `agentBId`. Pure.
 */
export function canonicalPairKey(
  agent1: string,
  agent2: string
): { pairKey: string; agentAId: string; agentBId: string } {
  const [agentAId, agentBId] = [agent1, agent2].sort((a, b) =>
    a.localeCompare(b)
  );
  return { pairKey: `${agentAId}|${agentBId}`, agentAId, agentBId };
}

/**
 * Folds a sequence of resolved head-to-head Battle_Outcomes between two
 * Campus_Agents into their Rivalry record (Req 1.7). `aWins`/`bWins` count the
 * outcomes won by the canonical agent A / agent B respectively, `ties` counts
 * drawn outcomes, and `battleCount` is the total number of resolved outcomes
 * between the pair. The pair identity is canonicalized so the record is
 * independent of the argument order. Pure and non-mutating.
 */
export function foldRivalry(
  agent1: string,
  agent2: string,
  outcomes: readonly BattleOutcome[]
): RivalryRecord {
  const { pairKey, agentAId, agentBId } = canonicalPairKey(agent1, agent2);

  let aWins = 0;
  let bWins = 0;
  let ties = 0;
  for (const outcome of outcomes) {
    if (outcome.kind === "tie") {
      ties += 1;
    } else if (outcome.winnerAgentId === agentAId) {
      aWins += 1;
    } else if (outcome.winnerAgentId === agentBId) {
      bWins += 1;
    }
  }

  return {
    pairKey,
    agentAId,
    agentBId,
    aWins,
    bWins,
    ties,
    battleCount: outcomes.length,
  };
}

// ---------------------------------------------------------------------------
// Abort-on-unpublish transition (Req 1.10)
// ---------------------------------------------------------------------------

/**
 * Decides the abort transition when a Battle_Participant's Publish_State is
 * observed (Req 1.10). When an Agent_Battle is `open` and any Battle_Participant
 * is no longer `published`, the battle is closed to `aborted` with no winner.
 * In every other case the battle status is returned unchanged. Pure.
 */
export function abortBattleOnUnpublish(
  currentStatus: BattleStatus,
  participants: readonly { status: PublishState }[]
): AbortDecision {
  if (
    currentStatus === "open" &&
    participants.some((p) => p.status !== "published")
  ) {
    return { status: "aborted", aborted: true };
  }
  return { status: currentStatus, aborted: false };
}

// ---------------------------------------------------------------------------
// Voting window (Req 1.12)
// ---------------------------------------------------------------------------

/**
 * The Agent_Battle voting window for a battle opened at `openedAt` (Req 1.12):
 * voting opens at `openedAt` and closes exactly {@link BATTLE_VOTING_WINDOW_MS}
 * (24 hours) later. Pure.
 */
export function battleVotingWindow(openedAt: number): {
  opensAt: number;
  closesAt: number;
} {
  return { opensAt: openedAt, closesAt: openedAt + BATTLE_VOTING_WINDOW_MS };
}

/**
 * True iff `now` falls within the 24-hour voting window of a battle opened at
 * `openedAt` — i.e., `openedAt <= now < openedAt + 24h` (Req 1.12). At and after
 * the close instant the window is closed, so voting is open for exactly 24
 * hours. Pure.
 */
export function isBattleVotingOpen(openedAt: number, now: number): boolean {
  const { opensAt, closesAt } = battleVotingWindow(openedAt);
  return now >= opensAt && now < closesAt;
}
