// Feature: campus-social-loops, Task 2.1: Shared social arbitraries
/**
 * Feature: campus-social-loops (Task 2.1)
 *
 * Shared `fast-check` generators used by every Campus Social Loops property
 * test. This module is a TEST HELPER — it exports arbitraries only and contains
 * NO `describe`/`it` blocks, so it never runs under `{ numRuns }` itself. It is
 * imported by the per-feature property tests under
 * `__tests__/properties/campus/social/**`.
 *
 * Validates: Requirements 8.1 (the arbitraries feed the property tests that
 * exercise the reuse-over-duplication rules across the social layer).
 *
 * The generators intentionally cluster around the boundaries called out in the
 * design so downstream properties routinely hit the interesting edges:
 *   - battle participant sets: exactly-two distinct published pairs + every
 *     invalid dimension (count, duplicate, unpublished, bad format);
 *   - vote/entry sequences with repeats/changes and owner/non-owner voters;
 *   - vote tallies clustered around equality (ties);
 *   - resolved-outcome sets spanning campuses/statuses/visibilities/timestamps;
 *   - rivalry outcome sequences for a canonical pair;
 *   - openedAt/now clocks around the 24 h voting boundary;
 *   - local-day starts and challenge prompts around 1/280 chars;
 *   - challenge submission tuples (ownership × status × window × already-entered);
 *   - challenge entry sets with equal votes and varied submittedAt;
 *   - clip inputs (recording consent × source duration ~20 s, requested
 *     duration ~10/20 s, sharing consent × screening clean/violation/unavailable);
 *   - group tokens (matching/mismatched/revoked, open/closed), participant
 *     counts ~100, and question bodies around 1/500 chars;
 *   - streak activity-day sequences (same day, consecutive, gaps, idle reads)
 *     in the reference tz;
 *   - cumulative activity counts crossing/receding from badge thresholds;
 *   - quest step arrays around 1/10 with descriptions around 1/200 chars,
 *     completion orders/repeats, and referenced/offering agent statuses;
 *   - companion interaction timelines with gaps around 5/30/60 minutes;
 *   - age-marked content sets with minor/adult/unknown viewers;
 *   - voice-clone consent records (representsRealPerson × verified × method);
 *   - usage states around the call-minutes tier limit; and
 *   - private-agent access tuples (visibility × owner × token validity).
 *
 * Reused domain types are imported from the existing Campus logic modules so
 * the generated data always matches what the reused primitives consume.
 */
import * as fc from "fast-check";

import type {
  AgentType,
  PublishState,
  Visibility,
  PrivateLinkRecord,
  AgentAccessView,
} from "../../../../convex/campus/logic/access";
import {
  SCREENING_POLICIES,
  type ScreeningPolicy,
  type ScreeningOutcome,
} from "../../../../convex/campus/logic/screening";
import {
  CONSENT_METHODS,
  type ConsentMethod,
  type ConsentRecordView,
} from "../../../../convex/campus/logic/consent";
import { FREE_TIER_LIMITS } from "../../../../convex/campus/logic/usage";
import type { AccountTier } from "../../../../convex/campus/logic/knowledge";

// ---------------------------------------------------------------------------
// Boundary constants (mirror the design; the real logic modules re-export
// their own once implemented — these keep the generators self-contained).
// ---------------------------------------------------------------------------

/** The five valid Battle_Formats (design: BATTLE_FORMATS). */
export const BATTLE_FORMATS = [
  "roast_battle",
  "debate",
  "trivia_showdown",
  "advice_showdown",
  "club_pitch_battle",
] as const;
export type BattleFormat = (typeof BATTLE_FORMATS)[number];

/** The two companion-style Agent_Types subject to the Overattachment_Safeguard. */
export const COMPANION_AGENT_TYPES = ["ai_twin", "funny_character"] as const;

/** Every Agent_Type (Req 2.3 carry-over). */
export const AGENT_TYPES: readonly AgentType[] = [
  "ai_twin",
  "study_agent",
  "club_agent",
  "campus_guide",
  "funny_character",
  "tutor_agent",
  "advice_agent",
];

/** Every Publish_State. */
export const PUBLISH_STATES: readonly PublishState[] = [
  "draft",
  "publish_pending_link",
  "published",
  "link_failed",
  "removed",
  "blocked",
  "deleted",
];

/** The Publish_States that are NOT `published` (used to force invalid inputs). */
export const NON_PUBLISHED_STATES: readonly PublishState[] =
  PUBLISH_STATES.filter((s) => s !== "published");

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/** The 24 h battle voting window and challenge windows (design). */
export const BATTLE_VOTING_WINDOW_MS = MS_PER_DAY;
/** Produced-clip and source-clip duration boundaries (seconds). */
export const SHARE_CLIP_MIN_SOURCE_SEC = 20;
export const SHARE_CLIP_MIN_SEC = 10;
export const SHARE_CLIP_MAX_SEC = 20;
/** Challenge prompt length bound (chars). */
export const CHALLENGE_PROMPT_MAX = 280;
/** Group session bounds. */
export const GROUP_MAX_PARTICIPANTS = 100;
export const GROUP_QUESTION_MIN = 1;
export const GROUP_QUESTION_MAX = 500;
/** Quest bounds. */
export const QUEST_STEPS_MIN = 1;
export const QUEST_STEPS_MAX = 10;
export const QUEST_STEP_DESC_MAX = 200;
/** Companion timing marks. */
export const SESSION_GAP_MS = 5 * MS_PER_MINUTE;
export const IDENTITY_REMINDER_INTERVAL_MS = 30 * MS_PER_MINUTE;
export const BREAK_INTERVAL_MS = 60 * MS_PER_MINUTE;

/** A fixed clock anchor (2024-01-01T00:00:00Z) for time-relative generators. */
export const CLOCK_ANCHOR_MS = Date.UTC(2024, 0, 1, 0, 0, 0);

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

/** A short, stable-looking id drawn from a small pool so collisions occur. */
export const agentIdArb: fc.Arbitrary<string> = fc.constantFrom(
  "agent_a",
  "agent_b",
  "agent_c",
  "agent_d",
);

/** A short owner id drawn from a small pool so ownership sometimes matches. */
export const ownerIdArb: fc.Arbitrary<string> = fc.constantFrom(
  "owner_1",
  "owner_2",
  "owner_3",
);

/** A hashed voter/user identity from a small pool to force repeats/changes. */
export const voterKeyArb: fc.Arbitrary<string> = fc.constantFrom(
  "voter_1",
  "voter_2",
  "voter_3",
  "voter_4",
);

/** A campus tag drawn from a small pool so per-campus grouping is exercised. */
export const campusTagArb: fc.Arbitrary<string> = fc.constantFrom(
  "state_u",
  "tech_college",
  "city_college",
);

/** Any Publish_State. */
export const publishStateArb: fc.Arbitrary<PublishState> = fc.constantFrom(
  ...PUBLISH_STATES,
);

/** Any Publish_State that is not `published`. */
export const nonPublishedStateArb: fc.Arbitrary<PublishState> = fc.constantFrom(
  ...NON_PUBLISHED_STATES,
);

/** Visibility. */
export const visibilityArb: fc.Arbitrary<Visibility> = fc.constantFrom(
  "public",
  "private",
);

/** Any Agent_Type. */
export const agentTypeArb: fc.Arbitrary<AgentType> = fc.constantFrom(
  ...AGENT_TYPES,
);

/** A companion-style Agent_Type (ai_twin | funny_character). */
export const companionAgentTypeArb: fc.Arbitrary<AgentType> = fc.constantFrom(
  ...COMPANION_AGENT_TYPES,
);

/** Builds a string of exactly `n` characters (content is irrelevant to bounds). */
function textOfLength(n: number): fc.Arbitrary<string> {
  const len = Math.max(0, n);
  return fc.string({ minLength: len, maxLength: len });
}

/** A string whose length is drawn from `lengths`, exercising exact boundaries. */
export function textOfBoundedLength(
  lengths: fc.Arbitrary<number>,
): fc.Arbitrary<string> {
  return lengths.chain((n) => textOfLength(n));
}

/** Formats a UTC calendar day (YYYY-MM-DD) offset by `dayOffset` from the anchor. */
export function dayStringForOffset(dayOffset: number): string {
  const d = new Date(CLOCK_ANCHOR_MS + dayOffset * MS_PER_DAY);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ===========================================================================
// 1. Battle participant sets — valid pairs + every invalid dimension
// ===========================================================================

export interface ParticipantView {
  agentId: string;
  status: PublishState;
}

/** A single participant with an arbitrary Publish_State. */
export const battleParticipantArb: fc.Arbitrary<ParticipantView> = fc.record({
  agentId: agentIdArb,
  status: publishStateArb,
});

/** A valid Battle_Format. */
export const battleFormatArb: fc.Arbitrary<BattleFormat> = fc.constantFrom(
  ...BATTLE_FORMATS,
);

/** A format string outside the defined set (invalid). */
export const invalidBattleFormatArb: fc.Arbitrary<string> = fc.constantFrom(
  "",
  "rap_battle",
  "cook_off",
  "ROAST_BATTLE",
  "unknown",
);

/** Exactly two distinct `published` participants — the sole valid pair shape. */
export const validParticipantPairArb: fc.Arbitrary<
  [ParticipantView, ParticipantView]
> = fc
  .uniqueArray(agentIdArb, { minLength: 2, maxLength: 2 })
  .map(
    ([a, b]) =>
      [
        { agentId: a, status: "published" as PublishState },
        { agentId: b, status: "published" as PublishState },
      ] as [ParticipantView, ParticipantView],
  );

/**
 * The tagged, invalid-by-construction participant-set dimensions (Req 1.2):
 *   - `participant_count`: fewer or more than two participants;
 *   - `duplicate_participant`: the same agent as both participants;
 *   - `participant_not_published`: a valid distinct pair with ≥ 1 unpublished.
 */
export type InvalidParticipantDimension =
  | "participant_count"
  | "duplicate_participant"
  | "participant_not_published";

export interface TaggedInvalidParticipants {
  dimension: InvalidParticipantDimension;
  participants: ParticipantView[];
}

const wrongCountParticipantsArb: fc.Arbitrary<TaggedInvalidParticipants> = fc
  .oneof(
    fc.array(battleParticipantArb, { minLength: 0, maxLength: 1 }),
    fc.array(battleParticipantArb, { minLength: 3, maxLength: 5 }),
  )
  .map((participants) => ({
    dimension: "participant_count" as const,
    participants,
  }));

const duplicateParticipantsArb: fc.Arbitrary<TaggedInvalidParticipants> =
  agentIdArb.map((id) => ({
    dimension: "duplicate_participant" as const,
    participants: [
      { agentId: id, status: "published" as PublishState },
      { agentId: id, status: "published" as PublishState },
    ],
  }));

const unpublishedParticipantsArb: fc.Arbitrary<TaggedInvalidParticipants> = fc
  .tuple(
    fc.uniqueArray(agentIdArb, { minLength: 2, maxLength: 2 }),
    nonPublishedStateArb,
    publishStateArb,
    fc.boolean(),
  )
  .map(([[a, b], badStatus, otherStatus, badFirst]) => ({
    dimension: "participant_not_published" as const,
    participants: badFirst
      ? [
          { agentId: a, status: badStatus },
          { agentId: b, status: otherStatus },
        ]
      : [
          { agentId: a, status: otherStatus },
          { agentId: b, status: badStatus },
        ],
  }));

/** Any invalid participant set, tagged with the dimension that makes it invalid. */
export const invalidParticipantsArb: fc.Arbitrary<TaggedInvalidParticipants> =
  fc.oneof(
    wrongCountParticipantsArb,
    duplicateParticipantsArb,
    unpublishedParticipantsArb,
  );

export interface BattleCreationInput {
  participants: ParticipantView[];
  format: string;
}

/** A create-battle request that mixes valid and every invalid shape. */
export const battleCreationInputArb: fc.Arbitrary<BattleCreationInput> =
  fc.oneof(
    // Fully valid: two distinct published participants + a valid format.
    fc
      .tuple(validParticipantPairArb, battleFormatArb)
      .map(([pair, format]) => ({ participants: [...pair], format })),
    // Valid participants but a bad format.
    fc
      .tuple(validParticipantPairArb, invalidBattleFormatArb)
      .map(([pair, format]) => ({ participants: [...pair], format })),
    // Invalid participants (any dimension) + a valid format.
    fc
      .tuple(invalidParticipantsArb, battleFormatArb)
      .map(({ 0: inv, 1: format }) => ({
        participants: inv.participants,
        format,
      })),
  );

// ===========================================================================
// 2. Vote/entry sequences — repeats/changes, owner/non-owner voters
// ===========================================================================

export interface BattleVoteInput {
  voterKey: string;
  choiceAgentId: string;
}

/** A single battle vote choosing one of a battle's two participants. */
export function battleVoteForPairArb(
  pair: readonly [string, string],
): fc.Arbitrary<BattleVoteInput> {
  return fc.record({
    voterKey: voterKeyArb,
    choiceAgentId: fc.constantFrom(pair[0], pair[1]),
  });
}

/**
 * A sequence of votes over a fixed participant pair, drawing voterKeys from a
 * small pool so the same voter repeats and changes selection across the run.
 */
export function battleVoteSequenceArb(
  pair: readonly [string, string],
): fc.Arbitrary<BattleVoteInput[]> {
  return fc.array(battleVoteForPairArb(pair), { minLength: 0, maxLength: 12 });
}

/** A ready-made battle: a distinct published pair plus a vote sequence over it. */
export interface BattleWithVotes {
  participantAgentIds: [string, string];
  ownerIds: string[];
  votes: BattleVoteInput[];
}

export const battleWithVotesArb: fc.Arbitrary<BattleWithVotes> = fc
  .uniqueArray(agentIdArb, { minLength: 2, maxLength: 2 })
  .chain(([a, b]) =>
    fc
      .tuple(
        battleVoteSequenceArb([a, b]),
        fc.array(ownerIdArb, { minLength: 0, maxLength: 2 }),
      )
      .map(([votes, ownerIds]) => ({
        participantAgentIds: [a, b] as [string, string],
        ownerIds,
        votes,
      })),
  );

/**
 * A voter identity paired with whether it belongs to a participant owner, for
 * exercising the owner-exclusion rule (Req 1.5).
 */
export interface VoterIdentity {
  voterKey: string;
  isOwner: boolean;
  requesterId?: string;
}

export const voterIdentityArb: fc.Arbitrary<VoterIdentity> = fc.record({
  voterKey: voterKeyArb,
  isOwner: fc.boolean(),
  requesterId: fc.option(ownerIdArb, { nil: undefined }),
});

// ===========================================================================
// 3. Vote tallies around equality (ties)
// ===========================================================================

export interface VoteTally {
  countA: number;
  countB: number;
}

/**
 * A pair of vote counts clustered around equality so ties and near-ties are
 * frequent (Req 1.6, 2.9).
 */
export const voteTallyArb: fc.Arbitrary<VoteTally> = fc
  .tuple(fc.integer({ min: 0, max: 8 }), fc.integer({ min: -2, max: 2 }))
  .map(([base, delta]) => ({
    countA: base,
    countB: Math.max(0, base + delta),
  }));

// ===========================================================================
// 4. Resolved-outcome sets for battle ranking (campus/status/visibility/time)
// ===========================================================================

export interface BattleWinRecordView {
  agentId: string;
  campusTag?: string;
  status: PublishState;
  visibility: Visibility;
  resolvedAt: number;
}

/** A resolved-battle win record spanning campuses, states, visibilities, times. */
export const battleWinRecordArb: fc.Arbitrary<BattleWinRecordView> = fc.record({
  agentId: agentIdArb,
  campusTag: fc.option(campusTagArb, { nil: undefined }),
  status: publishStateArb,
  visibility: visibilityArb,
  // Resolved times spread across ~±14 days around the anchor so the trailing
  // 7-day window includes some and excludes others.
  resolvedAt: fc.integer({
    min: CLOCK_ANCHOR_MS - 14 * MS_PER_DAY,
    max: CLOCK_ANCHOR_MS,
  }),
});

/** A set of win records feeding rankBattleWins. */
export const battleWinRecordsArb: fc.Arbitrary<BattleWinRecordView[]> =
  fc.array(battleWinRecordArb, { minLength: 0, maxLength: 40 });

// ===========================================================================
// 5. Rivalry outcome sequences (canonical pair head-to-head)
// ===========================================================================

export type RivalryOutcome =
  | { kind: "winner"; winnerAgentId: string }
  | { kind: "tie" };

/** A sequence of head-to-head outcomes for a canonical (agentA, agentB) pair. */
export function rivalryOutcomeSequenceArb(
  pair: readonly [string, string],
): fc.Arbitrary<RivalryOutcome[]> {
  const outcomeArb: fc.Arbitrary<RivalryOutcome> = fc.oneof(
    fc.record({
      kind: fc.constant("winner" as const),
      winnerAgentId: fc.constantFrom(pair[0], pair[1]),
    }),
    fc.record({ kind: fc.constant("tie" as const) }),
  );
  return fc.array(outcomeArb, { minLength: 0, maxLength: 10 });
}

/** A canonical distinct pair plus its outcome sequence. */
export interface RivalrySequence {
  pair: [string, string];
  outcomes: RivalryOutcome[];
}

export const rivalrySequenceArb: fc.Arbitrary<RivalrySequence> = fc
  .uniqueArray(agentIdArb, { minLength: 2, maxLength: 2 })
  .chain(([a, b]) =>
    rivalryOutcomeSequenceArb([a, b]).map((outcomes) => ({
      pair: [a, b] as [string, string],
      outcomes,
    })),
  );

// ===========================================================================
// 6. openedAt/now pairs around the 24 h battle voting boundary
// ===========================================================================

export interface VotingWindowClock {
  openedAt: number;
  now: number;
}

/**
 * An `openedAt`/`now` pair whose gap clusters around the 24 h voting boundary
 * (just inside, exactly at, and just past) — Req 1.12.
 */
export const votingWindowClockArb: fc.Arbitrary<VotingWindowClock> = fc
  .tuple(
    fc.integer({ min: CLOCK_ANCHOR_MS, max: CLOCK_ANCHOR_MS + MS_PER_DAY }),
    fc.constantFrom(
      -MS_PER_HOUR,
      0,
      MS_PER_HOUR,
      BATTLE_VOTING_WINDOW_MS - 1,
      BATTLE_VOTING_WINDOW_MS,
      BATTLE_VOTING_WINDOW_MS + 1,
      BATTLE_VOTING_WINDOW_MS + MS_PER_HOUR,
    ),
  )
  .map(([openedAt, gap]) => ({ openedAt, now: openedAt + gap }));

// ===========================================================================
// 7. Local-day starts and challenge prompts around 1/280
// ===========================================================================

/** A campus-local day-start timestamp (midnight-aligned in the reference tz). */
export const localDayStartArb: fc.Arbitrary<number> = fc
  .integer({ min: 0, max: 400 })
  .map((offset) => CLOCK_ANCHOR_MS + offset * MS_PER_DAY);

/** Challenge prompt lengths clustered around the 1/280 bounds. */
export const challengePromptLengthArb: fc.Arbitrary<number> = fc.constantFrom(
  0,
  1,
  2,
  140,
  279,
  CHALLENGE_PROMPT_MAX,
  CHALLENGE_PROMPT_MAX + 1,
  CHALLENGE_PROMPT_MAX + 20,
);

/** A challenge prompt string whose length hits the 1/280 boundaries. */
export const challengePromptArb: fc.Arbitrary<string> = textOfBoundedLength(
  challengePromptLengthArb,
);

// ===========================================================================
// 8. Challenge submission tuples (ownership × status × window × already-entered)
// ===========================================================================

export interface ChallengeSubmissionInput {
  isOwner: boolean;
  agentStatus: PublishState;
  submissionOpen: boolean;
  agentAlreadyEntered: boolean;
}

/** The full cross-product of submission-validation dimensions (Req 2.2–2.5). */
export const challengeSubmissionInputArb: fc.Arbitrary<ChallengeSubmissionInput> =
  fc.record({
    isOwner: fc.boolean(),
    agentStatus: publishStateArb,
    submissionOpen: fc.boolean(),
    agentAlreadyEntered: fc.boolean(),
  });

// ===========================================================================
// 9. Challenge entry sets — equal votes, varied submittedAt
// ===========================================================================

export interface ChallengeEntryView {
  entryId: string;
  agentId: string;
  status: PublishState;
  visibility: Visibility;
  submittedAt: number;
  votes: number;
}

/** A single challenge entry with a tie-prone vote count and varied submit time. */
export const challengeEntryViewArb: fc.Arbitrary<ChallengeEntryView> = fc.record(
  {
    entryId: fc.string({ minLength: 1, maxLength: 6 }),
    agentId: agentIdArb,
    status: publishStateArb,
    visibility: visibilityArb,
    submittedAt: fc.integer({
      min: CLOCK_ANCHOR_MS,
      max: CLOCK_ANCHOR_MS + MS_PER_DAY,
    }),
    // Small vote range so ties across entries are common (Req 2.8 tie-break).
    votes: fc.integer({ min: 0, max: 5 }),
  },
);

/** A set of challenge entries feeding the leaderboard/winner logic. */
export const challengeEntryViewsArb: fc.Arbitrary<ChallengeEntryView[]> =
  fc.array(challengeEntryViewArb, { minLength: 0, maxLength: 30 });

// ===========================================================================
// 10. Clip inputs — recording consent, source/requested durations, screening
// ===========================================================================

/** A source call duration clustered around the 20 s suggestion threshold. */
export const clipSourceDurationSecArb: fc.Arbitrary<number> = fc.oneof(
  fc.constantFrom(0, 1, 5, 19, SHARE_CLIP_MIN_SOURCE_SEC),
  fc.constantFrom(SHARE_CLIP_MIN_SOURCE_SEC + 1, 30, 60, 120),
  fc.integer({ min: 0, max: 180 }),
);

export interface ClipSuggestionInput {
  recordingConsent: boolean;
  sourceDurationSec: number;
}

/** Suggestion-gate inputs (recording consent × source duration ~20 s). */
export const clipSuggestionInputArb: fc.Arbitrary<ClipSuggestionInput> =
  fc.record({
    recordingConsent: fc.boolean(),
    sourceDurationSec: clipSourceDurationSecArb,
  });

/** A requested clip duration clustered around the 10/20 s clamp bounds. */
export const clipRequestedDurationSecArb: fc.Arbitrary<number> = fc.oneof(
  fc.constantFrom(
    -5,
    0,
    5,
    SHARE_CLIP_MIN_SEC - 1,
    SHARE_CLIP_MIN_SEC,
    15,
    SHARE_CLIP_MAX_SEC,
    SHARE_CLIP_MAX_SEC + 1,
    40,
  ),
  fc.integer({ min: -10, max: 60 }),
);

/** The screening policies. */
export const screeningPolicyArb: fc.Arbitrary<ScreeningPolicy> = fc.constantFrom(
  ...SCREENING_POLICIES,
);

/** A clean completed screen (the sole delivered path). */
export const cleanScreeningOutcomeArb: fc.Arbitrary<ScreeningOutcome> =
  fc.constant({ available: true, violatedPolicies: [] });

/** A completed screen reporting one or more policy violations. */
export const violatingScreeningOutcomeArb: fc.Arbitrary<ScreeningOutcome> = fc
  .array(screeningPolicyArb, {
    minLength: 1,
    maxLength: SCREENING_POLICIES.length,
  })
  .map((violatedPolicies) => ({ available: true, violatedPolicies }));

/** An unavailable screening dependency (fail-closed). */
export const unavailableScreeningOutcomeArb: fc.Arbitrary<ScreeningOutcome> =
  fc.constant({ available: false });

/** The full screening-outcome space: clean / violation / unavailable. */
export const screeningOutcomeArb: fc.Arbitrary<ScreeningOutcome> = fc.oneof(
  cleanScreeningOutcomeArb,
  violatingScreeningOutcomeArb,
  unavailableScreeningOutcomeArb,
);

export interface ProducedShareClipView {
  durationSec: number;
  captions: boolean;
  formats: readonly ("tiktok" | "reels" | "snap")[];
  label: string;
  agentId: string;
}

/** A produced Share_Clip shape (10–20 s, captioned, formatted, labeled). */
export const producedShareClipArb: fc.Arbitrary<ProducedShareClipView> =
  fc.record({
    durationSec: fc.integer({ min: SHARE_CLIP_MIN_SEC, max: SHARE_CLIP_MAX_SEC }),
    captions: fc.constant(true),
    formats: fc.constant(["tiktok", "reels", "snap"] as const),
    label: fc.constant("AI voice agent"),
    agentId: agentIdArb,
  });

export interface ClipAvailabilityInput {
  sharingConsent: boolean;
  screening: ScreeningOutcome;
  clip: ProducedShareClipView;
}

/** Availability-decision inputs (sharing consent × screening outcome × clip). */
export const clipAvailabilityInputArb: fc.Arbitrary<ClipAvailabilityInput> =
  fc.record({
    sharingConsent: fc.boolean(),
    screening: screeningOutcomeArb,
    clip: producedShareClipArb,
  });

// ===========================================================================
// 11. Group tokens, participant counts ~100, question bodies ~1/500
// ===========================================================================

export interface GroupStartInput {
  isOwner: boolean;
  agentStatus: PublishState;
}

/** Group-start validation inputs (owner × published — Req 4.10). */
export const groupStartInputArb: fc.Arbitrary<GroupStartInput> = fc.record({
  isOwner: fc.boolean(),
  agentStatus: publishStateArb,
});

/** A token drawn from a small pool so matches/mismatches both occur. */
export const groupTokenArb: fc.Arbitrary<string> = fc.constantFrom(
  "tok_alpha",
  "tok_beta",
  "tok_gamma",
);

export interface GroupSessionView {
  sessionId: string;
  token: string;
  status: "open" | "closed";
}

/** A group session with an open/closed status and a token from the pool. */
export const groupSessionViewArb: fc.Arbitrary<GroupSessionView> = fc.record({
  sessionId: fc.string({ minLength: 1, maxLength: 6 }),
  token: groupTokenArb,
  status: fc.constantFrom("open", "closed"),
});

export interface GroupAccessInput {
  session: GroupSessionView | null | undefined;
  token: string | null | undefined;
}

/**
 * A token-access request pairing a session (or none) with a presented token
 * that may match, mismatch, be missing, or be invalid (Req 4.7).
 */
export const groupAccessInputArb: fc.Arbitrary<GroupAccessInput> = fc.oneof(
  // Matching token against its own (possibly closed) session.
  groupSessionViewArb.map((session) => ({ session, token: session.token })),
  // Mismatched / revoked / missing / no-session cases.
  fc.record({
    session: fc.option(groupSessionViewArb, { nil: undefined }),
    token: fc.oneof(
      groupTokenArb,
      fc.constant<string | null | undefined>(null),
      fc.constant<string | null | undefined>(undefined),
      fc.constant("tok_revoked"),
    ),
  }),
);

export interface GroupAdmissionInput {
  currentCount: number;
  alreadyMember: boolean;
}

/** Admission-gate inputs with participant counts clustered around 100. */
export const groupAdmissionInputArb: fc.Arbitrary<GroupAdmissionInput> =
  fc.record({
    currentCount: fc.oneof(
      fc.constantFrom(
        0,
        1,
        GROUP_MAX_PARTICIPANTS - 1,
        GROUP_MAX_PARTICIPANTS,
        GROUP_MAX_PARTICIPANTS + 1,
      ),
      fc.integer({ min: 0, max: GROUP_MAX_PARTICIPANTS + 5 }),
    ),
    alreadyMember: fc.boolean(),
  });

/** Group question lengths clustered around the 1/500 bounds. */
export const groupQuestionLengthArb: fc.Arbitrary<number> = fc.constantFrom(
  0,
  GROUP_QUESTION_MIN,
  2,
  250,
  GROUP_QUESTION_MAX - 1,
  GROUP_QUESTION_MAX,
  GROUP_QUESTION_MAX + 1,
  GROUP_QUESTION_MAX + 50,
);

/** A group question body whose length hits the 1/500 boundaries. */
export const groupQuestionArb: fc.Arbitrary<string> = textOfBoundedLength(
  groupQuestionLengthArb,
);

// ===========================================================================
// 12. Streak activity-day sequences (same/consecutive/gap/idle) + reads
// ===========================================================================

/** A calendar day (YYYY-MM-DD) offset from the anchor. */
export const activityDayArb: fc.Arbitrary<string> = fc
  .integer({ min: 0, max: 30 })
  .map((offset) => dayStringForOffset(offset));

export interface StreakStateView {
  count: number;
  lastActiveDay: string | null;
}

/** A streak state: a non-negative count and an optional last-active day. */
export const streakStateArb: fc.Arbitrary<StreakStateView> = fc.record({
  count: fc.integer({ min: 0, max: 30 }),
  lastActiveDay: fc.option(activityDayArb, { nil: null }),
});

/**
 * A sequence of day-offsets whose steps cluster around the interesting streak
 * transitions: same day (0), consecutive (+1), and gaps (+2/+3). Mapped to
 * YYYY-MM-DD day strings suitable for `applyQualifyingActivity`.
 */
export const activityDaySequenceArb: fc.Arbitrary<string[]> = fc
  .array(fc.constantFrom(0, 1, 1, 1, 2, 3, 7), { minLength: 0, maxLength: 15 })
  .map((steps) => {
    let cursor = 0;
    const days: string[] = [];
    for (const step of steps) {
      cursor += step;
      days.push(dayStringForOffset(cursor));
    }
    return days;
  });

export interface StreakReadInput {
  state: StreakStateView;
  today: string;
}

/**
 * A current-streak read: a state paired with a `today` that is on, immediately
 * after, or a full idle day past the last-active day (Req 5.3).
 */
export const streakReadInputArb: fc.Arbitrary<StreakReadInput> = fc
  .tuple(
    fc.integer({ min: 0, max: 20 }),
    fc.integer({ min: 0, max: 20 }),
    fc.constantFrom(0, 1, 2, 3),
  )
  .map(([count, lastOffset, gap]) => ({
    state: { count, lastActiveDay: dayStringForOffset(lastOffset) },
    today: dayStringForOffset(lastOffset + gap),
  }));

// ===========================================================================
// 13. Cumulative activity counts crossing/receding from badge thresholds
// ===========================================================================

export interface BadgeCriterionView {
  badgeKey: string;
  activityType: string;
  threshold: number;
}

/** A badge criterion with a small threshold so crossings are frequent. */
export const badgeCriterionArb: fc.Arbitrary<BadgeCriterionView> = fc.record({
  badgeKey: fc.constantFrom("badge_x", "badge_y", "badge_z"),
  activityType: fc.constantFrom(
    "posted_challenge_entry",
    "received_call",
    "battle_won",
    "agent_discovered",
    "completed_quest",
  ),
  threshold: fc.constantFrom(1, 2, 3, 5, 10),
});

export interface BadgeAwardInput {
  cumulativeCount: number;
  criterion: BadgeCriterionView;
  alreadyAwarded: boolean;
}

/**
 * A badge-award input whose cumulative count sits just below, exactly at, or
 * above the criterion threshold (Req 5.5, 5.8).
 */
export const badgeAwardInputArb: fc.Arbitrary<BadgeAwardInput> = badgeCriterionArb
  .chain((criterion) =>
    fc
      .oneof(
        fc.constantFrom(
          criterion.threshold - 1,
          criterion.threshold,
          criterion.threshold + 1,
        ),
        fc.integer({ min: 0, max: criterion.threshold + 5 }),
      )
      .chain((cumulativeCount) =>
        fc.boolean().map((alreadyAwarded) => ({
          cumulativeCount: Math.max(0, cumulativeCount),
          criterion,
          alreadyAwarded,
        })),
      ),
  );

/**
 * A monotonic-then-receding sequence of cumulative counts around a threshold,
 * for asserting award-once-and-retained behavior across a run (Req 5.5, 5.8).
 */
export const cumulativeCountSequenceArb: fc.Arbitrary<number[]> = fc.array(
  fc.integer({ min: 0, max: 12 }),
  { minLength: 1, maxLength: 12 },
);

// ===========================================================================
// 14. Quest steps ~1/10, descriptions ~1/200, completion orders, agent status
// ===========================================================================

export interface QuestStepView {
  stepId: string;
  description: string;
  refAgentId?: string;
}

/** Quest step description lengths clustered around the 1/200 bounds. */
export const questStepDescriptionLengthArb: fc.Arbitrary<number> =
  fc.constantFrom(
    0,
    1,
    2,
    100,
    QUEST_STEP_DESC_MAX - 1,
    QUEST_STEP_DESC_MAX,
    QUEST_STEP_DESC_MAX + 1,
    QUEST_STEP_DESC_MAX + 20,
  );

/** A quest step description whose length hits the 1/200 boundaries. */
export const questStepDescriptionArb: fc.Arbitrary<string> =
  textOfBoundedLength(questStepDescriptionLengthArb);

/** A single quest step with a unique-ish id and optional referenced agent. */
export const questStepArb: fc.Arbitrary<QuestStepView> = fc.record({
  stepId: fc.string({ minLength: 1, maxLength: 5 }),
  description: questStepDescriptionArb,
  refAgentId: fc.option(agentIdArb, { nil: undefined }),
});

/**
 * A quest step array whose length clusters around the 1/10 bounds (including
 * the invalid 0 and 11 cases), with distinct stepIds.
 */
export const questStepsArb: fc.Arbitrary<QuestStepView[]> = fc
  .constantFrom(0, QUEST_STEPS_MIN, 2, 5, QUEST_STEPS_MAX, QUEST_STEPS_MAX + 1)
  .chain((n) =>
    fc
      .uniqueArray(fc.string({ minLength: 1, maxLength: 5 }), {
        minLength: n,
        maxLength: n,
        selector: (s) => s,
      })
      .chain((stepIds) =>
        fc
          .array(
            fc.tuple(questStepDescriptionArb, fc.option(agentIdArb, { nil: undefined })),
            { minLength: n, maxLength: n },
          )
          .map((pairs) =>
            stepIds.map((stepId, i) => ({
              stepId,
              description: pairs[i][0],
              refAgentId: pairs[i][1],
            })),
          ),
      ),
  );

export interface StepProgressView {
  stepId: string;
  complete: boolean;
  completedAt?: number;
}

/** Progress rows for a set of step ids, all incomplete (init shape). */
export function initStepProgress(stepIds: readonly string[]): StepProgressView[] {
  return stepIds.map((stepId) => ({ stepId, complete: false }));
}

/**
 * A completion attempt over a known set of step ids: a stepId that may be known
 * or unknown, a clock, and a referenced-agent status (published or not).
 */
export interface QuestStepCompletionInput {
  progress: StepProgressView[];
  stepId: string;
  now: number;
  refAgentStatus?: PublishState;
}

export const questStepCompletionInputArb: fc.Arbitrary<QuestStepCompletionInput> =
  fc
    .uniqueArray(fc.string({ minLength: 1, maxLength: 4 }), {
      minLength: 1,
      maxLength: 5,
      selector: (s) => s,
    })
    .chain((stepIds) =>
      fc
        .tuple(
          fc.constantFrom(...stepIds, "unknown_step"),
          fc.integer({ min: CLOCK_ANCHOR_MS, max: CLOCK_ANCHOR_MS + MS_PER_DAY }),
          fc.option(publishStateArb, { nil: undefined }),
          // Randomly pre-complete a subset so repeats/idempotency are exercised.
          fc.array(fc.boolean(), { minLength: stepIds.length, maxLength: stepIds.length }),
        )
        .map(([stepId, now, refAgentStatus, completedFlags]) => ({
          progress: stepIds.map((id, i) => ({
            stepId: id,
            complete: completedFlags[i] ?? false,
          })),
          stepId,
          now,
          refAgentStatus,
        })),
    );

/**
 * A sequence of stepId completions (with repeats) over a known step set, for
 * order-independence / idempotency properties (Req 6.3, 6.6).
 */
export interface StepCompletionSequence {
  stepIds: string[];
  order: string[];
}

export const stepCompletionSequenceArb: fc.Arbitrary<StepCompletionSequence> = fc
  .uniqueArray(fc.string({ minLength: 1, maxLength: 4 }), {
    minLength: 1,
    maxLength: 6,
    selector: (s) => s,
  })
  .chain((stepIds) =>
    fc
      .array(fc.constantFrom(...stepIds), { minLength: 0, maxLength: 15 })
      .map((order) => ({ stepIds, order })),
  );

/** An offering / referenced agent Publish_State for the accept/complete gates. */
export const offeringAgentStatusArb: fc.Arbitrary<PublishState> = publishStateArb;

// ===========================================================================
// 15. Companion interaction timelines with gaps ~5/30/60 minutes
// ===========================================================================

export interface CompanionStateView {
  sessionStartMs: number | null;
  lastInteractionMs: number | null;
  lastReminderMs: number | null;
  cumulativeMs: number;
  breaksShown: number;
}

/** A companion interaction state (possibly fresh / mid-session). */
export const companionStateArb: fc.Arbitrary<CompanionStateView> = fc.oneof(
  fc.constant<CompanionStateView>({
    sessionStartMs: null,
    lastInteractionMs: null,
    lastReminderMs: null,
    cumulativeMs: 0,
    breaksShown: 0,
  }),
  fc
    .tuple(
      fc.integer({ min: 0, max: 90 * MS_PER_MINUTE }),
      fc.integer({ min: 0, max: 90 * MS_PER_MINUTE }),
      fc.integer({ min: 0, max: 4 }),
    )
    .map(([cumulativeMs, sinceStart, breaksShown]) => ({
      sessionStartMs: CLOCK_ANCHOR_MS,
      lastInteractionMs: CLOCK_ANCHOR_MS + sinceStart,
      lastReminderMs: CLOCK_ANCHOR_MS,
      cumulativeMs,
      breaksShown,
    })),
);

/**
 * A timeline of interaction timestamps whose gaps cluster around the 5/30/60
 * minute marks that drive session boundaries, identity reminders, and
 * take-a-break notices (Req 7.4, 7.5).
 */
export const companionTimelineArb: fc.Arbitrary<number[]> = fc
  .array(
    fc.constantFrom(
      1 * MS_PER_MINUTE,
      4 * MS_PER_MINUTE,
      SESSION_GAP_MS,
      SESSION_GAP_MS + MS_PER_MINUTE,
      10 * MS_PER_MINUTE,
      IDENTITY_REMINDER_INTERVAL_MS,
      IDENTITY_REMINDER_INTERVAL_MS + MS_PER_MINUTE,
      BREAK_INTERVAL_MS,
      BREAK_INTERVAL_MS + MS_PER_MINUTE,
    ),
    { minLength: 0, maxLength: 20 },
  )
  .map((gaps) => {
    let cursor = CLOCK_ANCHOR_MS;
    const timeline = [cursor];
    for (const gap of gaps) {
      cursor += gap;
      timeline.push(cursor);
    }
    return timeline;
  });

// ===========================================================================
// 16. Age-marked content sets with minor/adult/unknown viewers
// ===========================================================================

export type AgeBand = "minor" | "adult" | "unknown";

/** A viewer age band, including the treated-as-unknown case. */
export const ageBandArb: fc.Arbitrary<AgeBand> = fc.constantFrom(
  "minor",
  "adult",
  "unknown",
);

export interface AgeMarkedContentView {
  id: string;
  ageAppropriateFor: AgeBand[];
}

/**
 * A content item carrying zero or more age-band markers (an empty marker set
 * models unmarked content, which minors must never see — Req 7.7).
 */
export const ageMarkedContentArb: fc.Arbitrary<AgeMarkedContentView> = fc.record(
  {
    id: fc.string({ minLength: 1, maxLength: 6 }),
    ageAppropriateFor: fc.uniqueArray(ageBandArb, { maxLength: 3 }),
  },
);

/** A set of age-marked content items to be filtered for a viewer. */
export const ageMarkedContentSetArb: fc.Arbitrary<AgeMarkedContentView[]> =
  fc.array(ageMarkedContentArb, { minLength: 0, maxLength: 20 });

export interface AgeFilterInput {
  items: AgeMarkedContentView[];
  viewerBand: AgeBand;
}

/** An age-appropriateness filter input: a content set plus a viewer band. */
export const ageFilterInputArb: fc.Arbitrary<AgeFilterInput> = fc.record({
  items: ageMarkedContentSetArb,
  viewerBand: ageBandArb,
});

// ===========================================================================
// 17. Voice-clone consent records (representsRealPerson × verified × method)
// ===========================================================================

/** A consent verification method, occasionally an invalid one. */
export const consentMethodArb: fc.Arbitrary<ConsentMethod> = fc.oneof(
  fc.constantFrom<ConsentMethod>(...CONSENT_METHODS),
  // Invalid methods, cast loosely so downstream can assert they never qualify.
  fc.constantFrom(
    "unknown_method" as ConsentMethod,
    "" as ConsentMethod,
  ),
);

/** A voice-clone consent record (agent × method × verified). */
export const consentRecordArb: fc.Arbitrary<ConsentRecordView> = fc.record({
  agentId: agentIdArb,
  method: consentMethodArb,
  verified: fc.boolean(),
});

/** An optional set of consent records to resolve the gate against. */
export const consentRecordsArb: fc.Arbitrary<
  readonly ConsentRecordView[] | undefined
> = fc.oneof(
  fc.constant(undefined),
  fc.array(consentRecordArb, { maxLength: 6 }),
);

export interface ConsentGateInputView {
  agentId: string;
  representsRealPerson: boolean;
  consents?: readonly ConsentRecordView[];
}

/** A consent-gate input (representsRealPerson × the consent record set). */
export const consentGateInputArb: fc.Arbitrary<ConsentGateInputView> = fc.record(
  {
    agentId: agentIdArb,
    representsRealPerson: fc.boolean(),
    consents: consentRecordsArb,
  },
);

// ===========================================================================
// 18. Usage states around the call-minutes tier limit
// ===========================================================================

/** An account tier (free | paid). */
export const accountTierArb: fc.Arbitrary<AccountTier> = fc.constantFrom(
  "free",
  "paid",
);

/**
 * Call-minutes-used values clustered around the free-tier limit so the gate's
 * strict-below boundary is exercised (Req 8.4, 8.5).
 */
export const callMinutesUsedArb: fc.Arbitrary<number> = fc.oneof(
  fc.constantFrom(
    0,
    1,
    FREE_TIER_LIMITS.callMinutes - 1,
    FREE_TIER_LIMITS.callMinutes,
    FREE_TIER_LIMITS.callMinutes + 1,
  ),
  fc.integer({ min: 0, max: FREE_TIER_LIMITS.callMinutes + 10 }),
);

export interface UsageStateInput {
  callMinutesUsed: number;
  tier: AccountTier;
}

/** A usage-gate input (call minutes used × tier). */
export const usageStateInputArb: fc.Arbitrary<UsageStateInput> = fc.record({
  callMinutesUsed: callMinutesUsedArb,
  tier: accountTierArb,
});

// ===========================================================================
// 19. Private-agent access tuples (visibility × owner × token validity)
// ===========================================================================

/** A Private_Link token record (active or revoked) for some agent. */
export const privateLinkRecordArb: fc.Arbitrary<PrivateLinkRecord> = fc.record({
  token: groupTokenArb,
  agentId: agentIdArb,
  status: fc.constantFrom("active", "revoked"),
});

/** The minimal agent view the access gate consumes. */
export const agentAccessViewArb: fc.Arbitrary<AgentAccessView> = fc.record({
  agentId: agentIdArb,
  ownerId: ownerIdArb,
  status: publishStateArb,
  visibility: visibilityArb,
});

export interface AccessRequestInput {
  agent: AgentAccessView | null | undefined;
  requesterId?: string | null;
  token?: string | null;
  privateLinks?: readonly PrivateLinkRecord[];
}

/**
 * A private-agent access request spanning the full space: present/absent agent,
 * public/private visibility, owner/non-owner requester, and
 * matching/mismatched/revoked/missing tokens (Req 8.6).
 */
export const accessRequestInputArb: fc.Arbitrary<AccessRequestInput> = fc.record(
  {
    agent: fc.option(agentAccessViewArb, { nil: undefined }),
    requesterId: fc.oneof(
      ownerIdArb,
      fc.constant<string | null | undefined>(null),
      fc.constant<string | null | undefined>(undefined),
    ),
    token: fc.oneof(
      groupTokenArb,
      fc.constant<string | null | undefined>(null),
      fc.constant<string | null | undefined>(undefined),
    ),
    privateLinks: fc.array(privateLinkRecordArb, { maxLength: 5 }),
  },
);
