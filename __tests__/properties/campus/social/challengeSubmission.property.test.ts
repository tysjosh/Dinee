// Feature: campus-social-loops, Property 9: Challenge submission is accepted only for an owned, published agent within an open window and not already entered
/**
 * Feature: campus-social-loops, Property 9: Challenge submission is accepted
 * only for an owned, published agent within an open window and not already
 * entered
 *
 * Validates: Requirements 2.2, 2.3, 2.4, 2.5
 *
 * Req 2.2: a Challenge_Entry submitted for a Daily_Challenge whose submission
 * window is open using an owned, published Campus_Agent is recorded.
 * Req 2.3: a submission using an unowned or non-published agent is rejected with
 * an indication identifying the reason.
 * Req 2.4: a second submission for the same agent in the same Daily_Challenge is
 * rejected with an "already entered" indication.
 * Req 2.5: a submission after the submission window has closed is rejected with
 * a "challenge is closed" indication.
 *
 * The pure computation under test is {@link validateChallengeEntry}.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { validateChallengeEntry } from "../../../../convex/campus/social/logic/challenges";
import { challengeSubmissionInputArb } from "./arbitraries";

describe("Property 9: Challenge submission validation", () => {
  it("accepts iff owner AND published AND submission open AND not already entered", () => {
    fc.assert(
      fc.property(challengeSubmissionInputArb, (input) => {
        const result = validateChallengeEntry(input);

        const shouldAccept =
          input.isOwner &&
          input.agentStatus === "published" &&
          input.submissionOpen &&
          !input.agentAlreadyEntered;

        expect(result.accepted).toBe(shouldAccept);
      }),
      { numRuns: 100 },
    );
  });

  it("identifies the first failing condition in ownership -> published -> window -> already-entered order", () => {
    fc.assert(
      fc.property(challengeSubmissionInputArb, (input) => {
        const result = validateChallengeEntry(input);

        if (result.accepted) {
          // Nothing further to check for the accept path here.
          return;
        }

        // The rejection reason follows the documented precedence order.
        let expectedReason:
          | "not_owner"
          | "not_published"
          | "submission_closed"
          | "already_entered";
        if (!input.isOwner) {
          expectedReason = "not_owner";
        } else if (input.agentStatus !== "published") {
          expectedReason = "not_published";
        } else if (!input.submissionOpen) {
          expectedReason = "submission_closed";
        } else {
          expectedReason = "already_entered";
        }

        expect(result.reason).toBe(expectedReason);

        // Every rejection carries a non-empty, user-facing indication.
        expect(typeof result.message).toBe("string");
        expect(result.message.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });

  it("covers each specific rejection reason on a representative input", () => {
    expect(
      validateChallengeEntry({
        isOwner: false,
        agentStatus: "published",
        submissionOpen: true,
        agentAlreadyEntered: false,
      }),
    ).toMatchObject({ accepted: false, reason: "not_owner" });

    expect(
      validateChallengeEntry({
        isOwner: true,
        agentStatus: "draft",
        submissionOpen: true,
        agentAlreadyEntered: false,
      }),
    ).toMatchObject({ accepted: false, reason: "not_published" });

    expect(
      validateChallengeEntry({
        isOwner: true,
        agentStatus: "published",
        submissionOpen: false,
        agentAlreadyEntered: false,
      }),
    ).toMatchObject({ accepted: false, reason: "submission_closed" });

    expect(
      validateChallengeEntry({
        isOwner: true,
        agentStatus: "published",
        submissionOpen: true,
        agentAlreadyEntered: true,
      }),
    ).toMatchObject({ accepted: false, reason: "already_entered" });

    expect(
      validateChallengeEntry({
        isOwner: true,
        agentStatus: "published",
        submissionOpen: true,
        agentAlreadyEntered: false,
      }),
    ).toEqual({ accepted: true });
  });
});
