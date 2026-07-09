// Feature: dinee-campus, Property 1: Student-facing copy excludes business terminology
//
// Validates: Requirements 1.6, 2.6
//
// Req 1.6: THE Campus_Platform SHALL exclude, case-insensitively, every term in
// the Business_Terminology_Exclusion_List from the student landing page and
// SHALL include the student-oriented terms "student" and "campus".
// Req 2.6: THE Onboarding_Flow SHALL exclude, case-insensitively, every term in
// the Business_Terminology_Exclusion_List and SHALL use the defined per-field
// labels for every field and instruction.
//
// The Business_Terminology_Exclusion_List is { "restaurant", "tenant", "branch" }.
// This property exercises the pure copy corpus and its helpers: across every
// student-facing string in the corpus and across arbitrary case-foldings of the
// forbidden terms, no corpus string may contain any forbidden term, while the
// corpus as a whole must contain the required student-oriented terms.
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  campusCopy,
  getAllCampusCopyStrings,
  containsBusinessTerminology,
  corpusIncludesRequiredStudentTerms,
  BUSINESS_TERMINOLOGY_EXCLUSION_LIST,
  REQUIRED_STUDENT_TERMS,
} from "../../../convex/campus/logic/copy";

/** Every student-facing string in the corpus, enumerated once. */
const CORPUS_STRINGS = getAllCampusCopyStrings(campusCopy);

/**
 * Randomly re-cases each character of `value`, producing an arbitrary mix of
 * upper/lower case. Used to prove the exclusion is enforced case-insensitively
 * rather than only against a single fixed casing (Req 1.6, 2.6).
 */
function reCase(value: string, uppers: boolean[]): string {
  return value
    .split("")
    .map((ch, i) => (uppers[i] ? ch.toUpperCase() : ch.toLowerCase()))
    .join("");
}

/** A forbidden term drawn from the Business_Terminology_Exclusion_List. */
const forbiddenTermArb: fc.Arbitrary<string> = fc.constantFrom(
  ...BUSINESS_TERMINOLOGY_EXCLUSION_LIST
);

/** An index into the enumerated corpus strings. */
const corpusIndexArb: fc.Arbitrary<number> = fc.integer({
  min: 0,
  max: CORPUS_STRINGS.length - 1,
});

describe("Property 1: Student-facing copy excludes business terminology", () => {
  it("no corpus string contains any forbidden term under any casing", () => {
    fc.assert(
      fc.property(
        corpusIndexArb,
        forbiddenTermArb,
        fc.array(fc.boolean(), { minLength: 0, maxLength: 32 }),
        (index, term, uppers) => {
          const corpusString = CORPUS_STRINGS[index];
          // The forbidden term, folded to an arbitrary mixed casing.
          const casings = Array.from(
            { length: term.length },
            (_, i) => uppers[i] ?? false
          );
          const foldedTerm = reCase(term, casings);

          // The corpus string, lowercased, must not contain the forbidden term
          // (which is itself lowercased for the comparison). Case-insensitive
          // exclusion means neither casing of either side may reveal a match.
          expect(corpusString.toLowerCase().includes(foldedTerm.toLowerCase())).toBe(
            false
          );
          // And the shared helper agrees the string is clean.
          expect(containsBusinessTerminology(corpusString)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("containsBusinessTerminology detects an injected forbidden term regardless of casing and surrounding text", () => {
    // The exclusion helper is the oracle the corpus is checked against, so it
    // must actually catch forbidden terms. Inject a re-cased forbidden term into
    // arbitrary surrounding text and assert detection.
    fc.assert(
      fc.property(
        forbiddenTermArb,
        fc.array(fc.boolean(), { minLength: 0, maxLength: 32 }),
        fc.string(),
        fc.string(),
        (term, uppers, prefix, suffix) => {
          const casings = Array.from(
            { length: term.length },
            (_, i) => uppers[i] ?? false
          );
          const injected = `${prefix}${reCase(term, casings)}${suffix}`;
          expect(containsBusinessTerminology(injected)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("the corpus as a whole includes every required student-oriented term", () => {
    // Req 1.6 / 2.6 also mandate the student-oriented terms are present.
    expect(corpusIncludesRequiredStudentTerms(campusCopy)).toBe(true);

    const haystack = CORPUS_STRINGS.join(" ").toLowerCase();
    for (const term of REQUIRED_STUDENT_TERMS) {
      expect(haystack.includes(term)).toBe(true);
    }
  });

  it("every corpus string is clean when scanned directly for each forbidden term", () => {
    // A non-random exhaustive cross-check complementing the randomized property:
    // every (string, forbidden-term) pair is clean.
    for (const s of CORPUS_STRINGS) {
      const lower = s.toLowerCase();
      for (const term of BUSINESS_TERMINOLOGY_EXCLUSION_LIST) {
        expect(lower.includes(term)).toBe(false);
      }
    }
  });
});
