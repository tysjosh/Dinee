// Feature: dinee-campus, Property 9: Out-of-knowledge questions produce a no-answer signal
/**
 * Feature: dinee-campus, Property 9: Out-of-knowledge questions produce a no-answer signal
 *
 * Validates: Requirements 5.5, 8.5
 *
 * IF the Voice_Runtime receives a question whose answer is not present in the
 * associated (approved) Knowledge_Store content, THEN it SHALL respond with a
 * fallback indicating it cannot answer from the available knowledge rather than
 * generating an unsupported answer (Req 5.5, 8.5).
 *
 * The pure function under test is {@link retrieveGrounding}: an out-of-knowledge
 * question yields `{ answered: false, fallback: CANNOT_ANSWER_FALLBACK }`, which
 * the runtime maps to the "cannot answer" fallback.
 *
 * The generators are constrained so that "out-of-knowledge" is guaranteed by
 * construction: question tokens are drawn from a namespace disjoint from the
 * knowledge tokens (distinct alphabetic prefixes), so they can never share a
 * meaningful token. A complementary case confirms the signal is *specific* —
 * an in-knowledge question is answered rather than falling back.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  retrieveGrounding,
  CANNOT_ANSWER_FALLBACK,
  type GroundingEntry,
} from "../../../convex/campus/logic/session";

/** A lowercase alphabetic word arbitrary (matches the ≥3-char token rule). */
const wordArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz".split("")), {
    minLength: 3,
    maxLength: 8,
  })
  .map((chars) => chars.join(""));

/**
 * A word confined to the QUESTION namespace: a fixed "qz" prefix guarantees the
 * whole alphanumeric run is disjoint from any knowledge word (which uses "kx").
 * Since {@link tokenize} keeps whole alnum runs, "qz…" can never equal "kx…".
 */
const questionWordArb: fc.Arbitrary<string> = wordArb.map((w) => `qz${w}`);

/** A word confined to the KNOWLEDGE namespace ("kx" prefix). */
const knowledgeWordArb: fc.Arbitrary<string> = wordArb.map((w) => `kx${w}`);

/** A free-form question built from one or more question-namespace words. */
const outOfKnowledgeQuestionArb: fc.Arbitrary<string> = fc
  .array(questionWordArb, { minLength: 1, maxLength: 8 })
  .map((words) => words.join(" "));

/**
 * A grounding entry whose content — and optional explicit keywords — live
 * entirely in the knowledge namespace, so it shares no token with any
 * question-namespace question. `keywords` is sometimes present to exercise the
 * explicit-keyword matching path in addition to the derived-from-content path.
 */
const knowledgeEntryArb: fc.Arbitrary<GroundingEntry> = fc.record(
  {
    sourceId: fc.uuid(),
    content: fc
      .array(knowledgeWordArb, { minLength: 1, maxLength: 6 })
      .map((words) => words.join(" ")),
    keywords: fc.option(fc.array(knowledgeWordArb, { minLength: 1, maxLength: 4 }), {
      nil: undefined,
    }),
  },
  { requiredKeys: ["sourceId", "content"] }
);

describe("Property 9: Out-of-knowledge questions produce a no-answer signal", () => {
  it("returns the cannot-answer fallback when the question shares no token with any approved knowledge (Req 5.5, 8.5)", () => {
    fc.assert(
      fc.property(
        outOfKnowledgeQuestionArb,
        fc.array(knowledgeEntryArb, { minLength: 1, maxLength: 10 }),
        (question, entries) => {
          const result = retrieveGrounding(question, entries);
          expect(result.answered).toBe(false);
          if (result.answered === false) {
            expect(result.fallback).toBe(CANNOT_ANSWER_FALLBACK);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("returns the cannot-answer fallback for any question when there is no approved knowledge at all (Req 5.5, 8.5)", () => {
    fc.assert(
      fc.property(fc.string(), (question) => {
        const result = retrieveGrounding(question, []);
        expect(result.answered).toBe(false);
        if (result.answered === false) {
          expect(result.fallback).toBe(CANNOT_ANSWER_FALLBACK);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("does NOT fall back when the question shares a token with approved knowledge (the no-answer signal is specific) (Req 5.5, 8.5)", () => {
    fc.assert(
      fc.property(
        fc.array(knowledgeEntryArb, { minLength: 1, maxLength: 10 }),
        fc.nat(),
        (entries, pick) => {
          // Choose an existing entry and derive a question from one of its
          // knowledge-namespace tokens, guaranteeing a shared meaningful token.
          const target = entries[pick % entries.length];
          const source =
            target.keywords && target.keywords.length > 0
              ? target.keywords.join(" ")
              : target.content;
          const token = source
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .find((t) => t.length >= 3);

          // Skip degenerate cases where no meaningful token exists.
          fc.pre(token !== undefined);

          const result = retrieveGrounding(`tell me about ${token}`, entries);
          expect(result.answered).toBe(true);
          if (result.answered === true) {
            expect(result.matches.length).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
