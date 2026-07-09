// Feature: dinee-campus, Property 19: Analytics aggregation invariants
/**
 * Feature: dinee-campus, Property 19: Analytics aggregation invariants
 *
 * Validates: Requirements 9.1, 9.4, 9.5, 9.7
 *
 * For any set of recorded interaction events for an agent (including the empty
 * set), the computed metrics SHALL satisfy:
 *   - all counts (calls, unique callers, shares, saves/remixes, and every
 *     type-specific count) are non-negative integers;
 *   - average call duration equals total duration divided by call count and is
 *     >= 0 (0 when there are no calls);
 *   - average rating, when at least one rating exists, lies within [1, 5] and
 *     is rounded to one decimal place (null otherwise);
 *   - when the event set is empty the aggregation reports an empty-state with
 *     all counts equal to zero.
 *
 * The pure computation under test is {@link aggregateAnalytics}.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  aggregateAnalytics,
  RATING_SCALE_MIN,
  RATING_SCALE_MAX,
  type AnalyticsEvent,
  type AnalyticsEventType,
  type AnalyticsInput,
  type RatingRecord,
  type CallSummary,
} from "../../../convex/campus/logic/analytics";

/** All recordable interaction-event kinds. */
const EVENT_TYPES: readonly AnalyticsEventType[] = [
  "call_completed",
  "share",
  "save",
  "remix",
  "question",
  "event_interest",
  "join_intent",
  "contact_click",
  "conversion_click",
  "quiz_completed",
  "confusing_topic",
  "explanation_request",
];

/**
 * Arbitrary producing a single interaction event. Optional fields
 * (callerKey, questionText, durationSeconds) are sometimes present and
 * sometimes absent so the generator exercises the de-duplication and
 * duration-summation branches. Durations may be zero, positive, or negative
 * to confirm the aggregator only sums valid positive spans.
 */
const eventArb: fc.Arbitrary<AnalyticsEvent> = fc.record(
  {
    type: fc.constantFrom(...EVENT_TYPES),
    createdAt: fc.integer({ min: 0, max: 4_000_000_000_000 }),
    callId: fc.option(
      fc.string({ minLength: 0, maxLength: 8 }),
      { nil: undefined }
    ),
    callerKey: fc.option(
      fc.string({ minLength: 0, maxLength: 6 }),
      { nil: undefined }
    ),
    questionText: fc.option(
      fc.string({ minLength: 0, maxLength: 10 }),
      { nil: undefined }
    ),
    durationSeconds: fc.option(
      fc.integer({ min: -100, max: 10_000 }),
      { nil: undefined }
    ),
  },
  { requiredKeys: ["type", "createdAt"] }
);

/** Arbitrary producing a valid 1..5 rating record. */
const ratingArb: fc.Arbitrary<RatingRecord> = fc.record({
  value: fc.integer({ min: RATING_SCALE_MIN, max: RATING_SCALE_MAX }),
  createdAt: fc.integer({ min: 0, max: 4_000_000_000_000 }),
});

/** Arbitrary producing a call summary. */
const summaryArb: fc.Arbitrary<CallSummary> = fc.record({
  callId: fc.string({ minLength: 1, maxLength: 8 }),
  summary: fc.string({ minLength: 0, maxLength: 20 }),
  createdAt: fc.integer({ min: 0, max: 4_000_000_000_000 }),
});

/** Arbitrary producing a full analytics input bundle. */
const inputArb: fc.Arbitrary<AnalyticsInput> = fc.record(
  {
    events: fc.array(eventArb, { maxLength: 40 }),
    ratings: fc.array(ratingArb, { maxLength: 20 }),
    summaries: fc.array(summaryArb, { maxLength: 30 }),
    agentType: fc.constantFrom(
      undefined,
      "ai_twin" as const,
      "study_agent" as const,
      "club_agent" as const
    ),
    hasMonetizationLink: fc.boolean(),
  },
  { requiredKeys: ["events"] }
);

/** All numeric counts a summary can carry, for a single non-negative-integer check. */
function collectCounts(summary: ReturnType<typeof aggregateAnalytics>): number[] {
  const counts: number[] = [
    summary.callCount,
    summary.uniqueCallerCount,
    summary.shareCount,
    summary.saveRemixCount,
  ];
  const tm = summary.typeMetrics;
  if (tm) {
    if (typeof tm.quizCompletions === "number") counts.push(tm.quizCompletions);
    if (typeof tm.eventInterest === "number") counts.push(tm.eventInterest);
    if (typeof tm.joinIntent === "number") counts.push(tm.joinIntent);
    if (typeof tm.contactClicks === "number") counts.push(tm.contactClicks);
    for (const e of tm.confusingTopics ?? []) counts.push(e.count);
    for (const e of tm.requestedExplanations ?? []) counts.push(e.count);
  }
  for (const q of summary.topQuestions) counts.push(q.count);
  if (typeof summary.conversionClickCount === "number") {
    counts.push(summary.conversionClickCount);
  }
  return counts;
}

describe("Property 19: Analytics aggregation invariants", () => {
  it("all counts are non-negative integers, duration is total/callCount >= 0, and rating is a rounded value in [1,5] or null", () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const summary = aggregateAnalytics(input);

        // All counts are non-negative integers.
        for (const count of collectCounts(summary)) {
          expect(Number.isInteger(count)).toBe(true);
          expect(count).toBeGreaterThanOrEqual(0);
        }

        // Average call duration equals total / callCount and is >= 0
        // (exactly 0 when there are no calls).
        const totalDuration = input.events
          .filter((e) => e.type === "call_completed")
          .reduce((sum, e) => {
            const d = e.durationSeconds;
            return sum +
              (typeof d === "number" && Number.isFinite(d) && d > 0 ? d : 0);
          }, 0);
        expect(summary.averageCallDurationSeconds).toBeGreaterThanOrEqual(0);
        if (summary.callCount === 0) {
          expect(summary.averageCallDurationSeconds).toBe(0);
        } else {
          expect(summary.averageCallDurationSeconds).toBe(
            totalDuration / summary.callCount
          );
        }

        // Average rating: null when no ratings, else in [1,5] rounded to 1 dp.
        const ratings = input.ratings ?? [];
        if (ratings.length === 0) {
          expect(summary.averageRating).toBeNull();
        } else {
          const avg = summary.averageRating;
          expect(avg).not.toBeNull();
          expect(avg as number).toBeGreaterThanOrEqual(RATING_SCALE_MIN);
          expect(avg as number).toBeLessThanOrEqual(RATING_SCALE_MAX);
          // Rounded to one decimal place: x*10 is an integer.
          expect(Number.isInteger(Math.round((avg as number) * 10))).toBe(true);
          expect((avg as number) * 10).toBe(Math.round((avg as number) * 10));
        }
      }),
      { numRuns: 100 }
    );
  });

  it("reports an empty-state with all counts zero when no activity is recorded", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          undefined,
          "ai_twin" as const,
          "study_agent" as const,
          "club_agent" as const
        ),
        fc.boolean(),
        (agentType, hasMonetizationLink) => {
          const summary = aggregateAnalytics({
            events: [],
            ratings: [],
            summaries: [],
            agentType,
            hasMonetizationLink,
          });

          expect(summary.isEmpty).toBe(true);
          for (const count of collectCounts(summary)) {
            expect(count).toBe(0);
          }
          expect(summary.averageCallDurationSeconds).toBe(0);
          expect(summary.averageRating).toBeNull();
          expect(summary.topQuestions).toEqual([]);
          expect(summary.recentSummaries).toEqual([]);
        }
      ),
      { numRuns: 100 }
    );
  });
});
