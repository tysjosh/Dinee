// Feature: campus-social-loops, Property 8: Daily_Challenge windows are one-per-campus-per-local-day with bounded prompt and 24-hour windows
/**
 * Feature: campus-social-loops, Property 8: Daily_Challenge windows are
 * one-per-campus-per-local-day with bounded prompt and 24-hour windows
 *
 * Validates: Requirements 2.1
 *
 * Req 2.1: THE Challenge_Service SHALL publish exactly one Daily_Challenge per
 * campus per calendar day, determined in the campus's local time zone, each
 * Daily_Challenge carrying a Challenge_Prompt of 1 to 280 characters, a
 * submission window of 24 hours, and a voting period of 24 hours.
 *
 * The pure computations under test are {@link challengeWindows},
 * {@link isSubmissionOpen}, {@link isVotingOpen}, and
 * {@link isValidChallengePrompt}.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  challengeWindows,
  isSubmissionOpen,
  isVotingOpen,
  isValidChallengePrompt,
  CHALLENGE_SUBMISSION_WINDOW_MS,
  CHALLENGE_VOTING_WINDOW_MS,
  CHALLENGE_PROMPT_MIN,
  CHALLENGE_PROMPT_MAX,
} from "../../../../convex/campus/social/logic/challenges";
import {
  localDayStartArb,
  challengePromptArb,
} from "./arbitraries";

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * Offsets from a campus-local day start clustered around the submission-close
 * (24 h) and voting-close (48 h) boundaries so the half-open interval edges are
 * routinely exercised, plus a broad random offset spanning the two windows and
 * beyond.
 */
const nowOffsetArb: fc.Arbitrary<number> = fc.oneof(
  fc.constantFrom(
    -MS_PER_HOUR,
    -1,
    0,
    1,
    MS_PER_HOUR,
    MS_PER_DAY - 1,
    MS_PER_DAY,
    MS_PER_DAY + 1,
    MS_PER_DAY + MS_PER_HOUR,
    2 * MS_PER_DAY - 1,
    2 * MS_PER_DAY,
    2 * MS_PER_DAY + 1,
    2 * MS_PER_DAY + MS_PER_HOUR,
  ),
  fc.integer({ min: -MS_PER_DAY, max: 3 * MS_PER_DAY }),
);

describe("Property 8: Daily_Challenge windows and prompt bounds", () => {
  it("derives a 24-hour submission window followed by a contiguous 24-hour voting window", () => {
    fc.assert(
      fc.property(localDayStartArb, (dayStart) => {
        const w = challengeWindows(dayStart);

        // Submission opens at the local day start (Req 2.1).
        expect(w.submissionOpensAt).toBe(dayStart);

        // The submission window is exactly 24 hours.
        expect(w.submissionClosesAt - w.submissionOpensAt).toBe(
          CHALLENGE_SUBMISSION_WINDOW_MS,
        );
        expect(CHALLENGE_SUBMISSION_WINDOW_MS).toBe(MS_PER_DAY);

        // Voting opens exactly when submission closes (contiguous, no gap).
        expect(w.votingOpensAt).toBe(w.submissionClosesAt);

        // The voting period is exactly 24 hours.
        expect(w.votingClosesAt - w.votingOpensAt).toBe(
          CHALLENGE_VOTING_WINDOW_MS,
        );
        expect(CHALLENGE_VOTING_WINDOW_MS).toBe(MS_PER_DAY);

        // Windows advance strictly forward in time.
        expect(w.submissionOpensAt).toBeLessThan(w.submissionClosesAt);
        expect(w.votingOpensAt).toBeLessThan(w.votingClosesAt);
      }),
      { numRuns: 100 },
    );
  });

  it("isSubmissionOpen / isVotingOpen hold exactly on their half-open intervals and never overlap", () => {
    fc.assert(
      fc.property(localDayStartArb, nowOffsetArb, (dayStart, offset) => {
        const w = challengeWindows(dayStart);
        const now = dayStart + offset;

        const submissionOpen = isSubmissionOpen(w, now);
        const votingOpen = isVotingOpen(w, now);

        // Submission window is the half-open interval [opensAt, closesAt).
        expect(submissionOpen).toBe(
          now >= w.submissionOpensAt && now < w.submissionClosesAt,
        );

        // Voting window is the half-open interval [opensAt, closesAt).
        expect(votingOpen).toBe(
          now >= w.votingOpensAt && now < w.votingClosesAt,
        );

        // Submission and voting are disjoint: they can never both be open.
        expect(submissionOpen && votingOpen).toBe(false);

        // At the shared boundary submission has closed and voting has opened.
        if (now === w.submissionClosesAt) {
          expect(submissionOpen).toBe(false);
          expect(votingOpen).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("consecutive local days yield contiguous, non-overlapping submission windows (one per local day)", () => {
    fc.assert(
      fc.property(localDayStartArb, (dayStart) => {
        const today = challengeWindows(dayStart);
        const nextDay = challengeWindows(dayStart + MS_PER_DAY);

        // The next local day's submission window opens exactly where today's
        // closes: exactly one Daily_Challenge submission window covers each
        // local calendar day, with no overlap and no gap.
        expect(nextDay.submissionOpensAt).toBe(today.submissionClosesAt);
        expect(nextDay.submissionOpensAt).toBe(dayStart + MS_PER_DAY);
      }),
      { numRuns: 100 },
    );
  });

  it("isValidChallengePrompt accepts exactly the 1..280 character prompts", () => {
    fc.assert(
      fc.property(challengePromptArb, (prompt) => {
        const expected =
          prompt.length >= CHALLENGE_PROMPT_MIN &&
          prompt.length <= CHALLENGE_PROMPT_MAX;
        expect(isValidChallengePrompt(prompt)).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  it("rejects empty and over-280-character prompts and accepts the exact boundaries", () => {
    expect(isValidChallengePrompt("")).toBe(false);
    expect(isValidChallengePrompt("a")).toBe(true);
    expect(isValidChallengePrompt("a".repeat(CHALLENGE_PROMPT_MAX))).toBe(true);
    expect(isValidChallengePrompt("a".repeat(CHALLENGE_PROMPT_MAX + 1))).toBe(
      false,
    );
  });
});
