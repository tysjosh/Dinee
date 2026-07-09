// Feature: dinee-campus, live knowledge-lookup tool output formatting (Req 5.5, 8.4, 8.5)
/**
 * Feature: dinee-campus — live knowledge grounding (browser voice path).
 *
 * Validates {@link formatGroundingToolOutput}, which turns the pure
 * `retrieveGrounding` result into the plain-text tool output returned to the
 * Realtime model:
 *   - a no-answer result returns the fallback verbatim, so the model tells the
 *     Caller it doesn't know rather than fabricating an answer (Req 5.5, 8.5);
 *   - an answered result returns only the matched approved-knowledge content
 *     (Req 8.4), blank entries dropped.
 *
 * Also checks it composes correctly with the real `retrieveGrounding` matcher:
 * a question sharing a token with an entry is answered from that content, and a
 * question with no approved knowledge yields the fallback.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  formatGroundingToolOutput,
  type GroundingToolResult,
} from "../../../convex/campus/logic/realtime";
import {
  retrieveGrounding,
  CANNOT_ANSWER_FALLBACK,
  type GroundingEntry,
} from "../../../convex/campus/logic/session";

describe("Grounding tool output formatting", () => {
  it("returns the fallback verbatim for a no-answer result", () => {
    fc.assert(
      fc.property(fc.string(), (fallback) => {
        const result: GroundingToolResult = { answered: false, fallback };
        expect(formatGroundingToolOutput(result)).toBe(fallback);
      })
    );
  });

  it("returns only non-blank matched content, joined, for an answered result", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string(), { minLength: 1, maxLength: 6 }),
        (contents) => {
          const result: GroundingToolResult = {
            answered: true,
            matches: contents.map((content) => ({ content })),
          };
          const output = formatGroundingToolOutput(result);
          const expected = contents
            .map((c) => c.trim())
            .filter((c) => c.length > 0)
            .join("\n\n");
          expect(output).toBe(expected);
          // No blank-only fragment ever leaks into the output.
          if (expected.length === 0) {
            expect(output).toBe("");
          }
        }
      )
    );
  });
});

describe("Grounding tool output composes with retrieveGrounding", () => {
  it("answers from approved knowledge that shares a token with the question", () => {
    const entries: GroundingEntry[] = [
      { sourceId: "s1", content: "The library closes at 9pm on weekdays." },
    ];
    const result = retrieveGrounding("When does the library close?", entries);
    const output = formatGroundingToolOutput(result);
    expect(result.answered).toBe(true);
    expect(output).toContain("library");
  });

  it("falls back to the cannot-answer message when no knowledge exists", () => {
    const result = retrieveGrounding("anything at all", []);
    expect(result.answered).toBe(false);
    expect(formatGroundingToolOutput(result)).toBe(CANNOT_ANSWER_FALLBACK);
  });
});
