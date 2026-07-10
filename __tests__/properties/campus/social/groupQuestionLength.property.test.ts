// Feature: campus-social-loops, Property 18: Group questions are valid only at 1–500 characters
/**
 * Feature: campus-social-loops, Property 18: Group questions are valid only at
 * 1–500 characters.
 *
 * Validates: Requirements 4.2, 4.11
 *
 * Req 4.2: a Participant may submit Group_Questions of 1 to 500 characters.
 * Req 4.11: a Group_Question that is empty or exceeds 500 characters is
 * rejected with an "invalid message" indication.
 *
 * The pure validator under test is {@link validateGroupQuestion}. A body is
 * valid iff its length is within [GROUP_QUESTION_MIN, GROUP_QUESTION_MAX]
 * (1–500). A zero-length body is `empty`; a body above 500 is `too_long`. The
 * emptiness check precedes the ceiling so a 0-length body is always `empty`.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  validateGroupQuestion,
  GROUP_QUESTION_MIN,
  GROUP_QUESTION_MAX,
} from "../../../../convex/campus/social/logic/groupchat";
import { groupQuestionArb, groupQuestionLengthArb } from "./arbitraries";

describe("Property 18: group questions are valid only at 1–500 characters", () => {
  it("accepts iff length is within [1, 500], reporting empty below and too_long above", () => {
    fc.assert(
      fc.property(groupQuestionArb, (body) => {
        const result = validateGroupQuestion(body);
        const len = body.length;

        if (len >= GROUP_QUESTION_MIN && len <= GROUP_QUESTION_MAX) {
          expect(result.valid).toBe(true);
        } else {
          expect(result.valid).toBe(false);
          const reason = result.valid ? undefined : result.reason;
          if (len < GROUP_QUESTION_MIN) {
            expect(reason).toBe("empty");
          } else {
            expect(reason).toBe("too_long");
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  it("treats the exact boundaries (1 and 500) as valid and 0/501 as invalid", () => {
    fc.assert(
      fc.property(groupQuestionLengthArb, (len) => {
        const body = "x".repeat(len);
        const result = validateGroupQuestion(body);
        const withinBounds =
          len >= GROUP_QUESTION_MIN && len <= GROUP_QUESTION_MAX;
        expect(result.valid).toBe(withinBounds);
      }),
      { numRuns: 100 }
    );
  });
});
