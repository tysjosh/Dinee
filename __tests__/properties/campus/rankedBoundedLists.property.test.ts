// Feature: dinee-campus, Property 20: Ranked analytics lists are frequency-sorted and bounded
/**
 * Feature: dinee-campus, Property 20: Ranked analytics lists are frequency-sorted and bounded
 *
 * Validates: Requirements 9.2, 9.3
 *
 * Req 9.2: THE Analytics_Dashboard SHALL display the top 10 most asked
 * questions ranked by descending frequency and the 20 most recent call
 * summaries for that Campus_Agent.
 * Req 9.3: WHERE a Campus_Agent's Agent_Type is study_agent, THE
 * Analytics_Dashboard SHALL display the top 10 most confusing topics and the
 * top 10 most requested explanations, each ranked by descending frequency.
 *
 * For any recorded activity, the ranked frequency lists (top questions, and for
 * study_agents the confusing-topics and requested-explanations lists) SHALL be
 * ordered by non-increasing occurrence count and bounded to at most
 * MAX_RANKED_ENTRIES (10) entries, and the recent-summaries list SHALL be
 * ordered most-recent-first and bounded to at most MAX_RECENT_SUMMARIES (20)
 * entries. Each ranked entry's count SHALL equal the true frequency of its
 * text among the non-blank inputs.
 *
 * The pure computations under test are {@link rankByFrequency},
 * {@link recentSummaries}, and {@link aggregateAnalytics}.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  rankByFrequency,
  recentSummaries,
  aggregateAnalytics,
  MAX_RANKED_ENTRIES,
  MAX_RECENT_SUMMARIES,
  type AnalyticsEvent,
  type CallSummary,
  type RankedEntry,
} from "../../../convex/campus/logic/analytics";

/**
 * A small pool of candidate texts (including blank/whitespace-only strings and
 * `undefined`) drawn repeatedly so the generated arrays contain genuine
 * frequency ties and hot entries, exercising the descending-frequency ordering
 * and the tie-break. Blank/undefined values must be ignored by the ranker.
 */
const textCandidateArb: fc.Arbitrary<string | undefined> = fc.constantFrom(
  "alpha",
  "beta",
  "gamma",
  "delta",
  "epsilon",
  "zeta",
  "eta",
  "theta",
  "iota",
  "kappa",
  "lambda",
  "mu",
  "",
  "   ",
  undefined
);

/** An array of candidate texts long enough to routinely overflow the ≤10 bound. */
const textsArb: fc.Arbitrary<(string | undefined)[]> = fc.array(
  textCandidateArb,
  { minLength: 0, maxLength: 60 }
);

/** The true frequency of each non-blank, trimmed text in the input. */
function trueFrequencies(
  texts: readonly (string | undefined)[]
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const raw of texts) {
    if (typeof raw !== "string") continue;
    const t = raw.trim();
    if (t.length === 0) continue;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return counts;
}

/** Asserts a ranked list is bounded, frequency-sorted, and count-accurate. */
function assertRankedInvariants(
  ranked: readonly RankedEntry[],
  source: readonly (string | undefined)[],
  limit: number
): void {
  // Bounded to at most `limit` entries.
  expect(ranked.length).toBeLessThanOrEqual(limit);

  const freq = trueFrequencies(source);

  // Cannot surface more distinct entries than exist, nor more than the limit.
  expect(ranked.length).toBe(Math.min(freq.size, limit));

  const seen = new Set<string>();
  for (let i = 0; i < ranked.length; i++) {
    const entry = ranked[i];

    // No blank texts and every entry is distinct.
    expect(entry.text.length).toBeGreaterThan(0);
    expect(seen.has(entry.text)).toBe(false);
    seen.add(entry.text);

    // Each count equals the true frequency of its text, and is a positive int.
    expect(entry.count).toBe(freq.get(entry.text));
    expect(Number.isInteger(entry.count)).toBe(true);
    expect(entry.count).toBeGreaterThan(0);

    // Non-increasing frequency ordering; ties broken by ascending text so the
    // ordering is total and deterministic.
    if (i > 0) {
      const prev = ranked[i - 1];
      expect(prev.count).toBeGreaterThanOrEqual(entry.count);
      if (prev.count === entry.count) {
        expect(prev.text.localeCompare(entry.text)).toBeLessThan(0);
      }
    }
  }

  // The surfaced entries are exactly the top-`limit` by frequency: no omitted
  // text may out-rank a surfaced one.
  const minSurfacedCount =
    ranked.length > 0 ? ranked[ranked.length - 1].count : Infinity;
  for (const [text, count] of freq.entries()) {
    if (seen.has(text)) continue;
    // An omitted entry can only be dropped because the list is full and it does
    // not beat the weakest surfaced entry (ties go to lexicographically smaller
    // text, so an equal-count omission must sort after the last surfaced text).
    expect(ranked.length).toBe(limit);
    expect(count).toBeLessThanOrEqual(minSurfacedCount);
    if (count === minSurfacedCount) {
      expect(ranked[ranked.length - 1].text.localeCompare(text)).toBeLessThan(0);
    }
  }
}

describe("Property 20: Ranked analytics lists are frequency-sorted and bounded", () => {
  it("rankByFrequency returns a bounded, descending-frequency list with accurate counts", () => {
    fc.assert(
      fc.property(textsArb, (texts) => {
        const ranked = rankByFrequency(texts);
        assertRankedInvariants(ranked, texts, MAX_RANKED_ENTRIES);
      }),
      { numRuns: 100 }
    );
  });

  it("rankByFrequency honours an arbitrary bound", () => {
    fc.assert(
      fc.property(
        textsArb,
        fc.integer({ min: 0, max: 15 }),
        (texts, limit) => {
          const ranked = rankByFrequency(texts, limit);
          assertRankedInvariants(ranked, texts, limit);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("recentSummaries is bounded to ≤20 and ordered most-recent-first", () => {
    const summaryArb: fc.Arbitrary<CallSummary> = fc.record({
      callId: fc.string({ minLength: 1, maxLength: 8 }),
      summary: fc.string({ minLength: 0, maxLength: 20 }),
      createdAt: fc.integer({ min: 0, max: 4_000_000_000_000 }),
    });

    fc.assert(
      fc.property(
        fc.array(summaryArb, { minLength: 0, maxLength: 60 }),
        (summaries) => {
          const recent = recentSummaries(summaries);

          // Bounded to at most 20, and never more than the input size.
          expect(recent.length).toBeLessThanOrEqual(MAX_RECENT_SUMMARIES);
          expect(recent.length).toBe(
            Math.min(summaries.length, MAX_RECENT_SUMMARIES)
          );

          // Most-recent-first: timestamps are non-increasing.
          for (let i = 1; i < recent.length; i++) {
            expect(recent[i - 1].createdAt).toBeGreaterThanOrEqual(
              recent[i].createdAt
            );
          }

          // Every surfaced summary is at least as recent as any dropped one:
          // the oldest surfaced timestamp bounds every timestamp in the input.
          if (recent.length > 0) {
            const oldestSurfaced = recent[recent.length - 1].createdAt;
            const surfacedCount = recent.filter(
              (r) => r.createdAt >= oldestSurfaced
            ).length;
            const inputAtLeastOldest = summaries.filter(
              (s) => s.createdAt > oldestSurfaced
            ).length;
            // No dropped summary is strictly newer than the oldest surfaced one.
            expect(inputAtLeastOldest).toBeLessThanOrEqual(recent.length);
            expect(surfacedCount).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("aggregateAnalytics ranked lists (top questions; study-agent topics/explanations) are bounded and frequency-sorted", () => {
    const questionEventArb: fc.Arbitrary<AnalyticsEvent> = fc.record({
      type: fc.constantFrom(
        "question" as const,
        "confusing_topic" as const,
        "explanation_request" as const,
        "call_completed" as const
      ),
      createdAt: fc.integer({ min: 0, max: 4_000_000_000_000 }),
      questionText: textCandidateArb,
    });

    fc.assert(
      fc.property(
        fc.array(questionEventArb, { minLength: 0, maxLength: 80 }),
        (events) => {
          const summary = aggregateAnalytics({
            events,
            agentType: "study_agent",
          });

          // Top questions: bounded + frequency-sorted against the question texts.
          const questionTexts = events
            .filter((e) => e.type === "question")
            .map((e) => e.questionText);
          assertRankedInvariants(
            summary.topQuestions,
            questionTexts,
            MAX_RANKED_ENTRIES
          );

          // study_agent type-specific ranked lists.
          const tm = summary.typeMetrics;
          expect(tm).toBeDefined();

          const confusingTexts = events
            .filter((e) => e.type === "confusing_topic")
            .map((e) => e.questionText);
          assertRankedInvariants(
            tm?.confusingTopics ?? [],
            confusingTexts,
            MAX_RANKED_ENTRIES
          );

          const explanationTexts = events
            .filter((e) => e.type === "explanation_request")
            .map((e) => e.questionText);
          assertRankedInvariants(
            tm?.requestedExplanations ?? [],
            explanationTexts,
            MAX_RANKED_ENTRIES
          );
        }
      ),
      { numRuns: 100 }
    );
  });
});
