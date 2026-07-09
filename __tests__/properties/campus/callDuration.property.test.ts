// Feature: dinee-campus, Property 17: Recorded call duration is a non-negative integer number of seconds
/**
 * Feature: dinee-campus, Property 17: Recorded call duration is a non-negative
 * integer number of seconds
 *
 * Validates: Requirements 8.8
 *
 * For any completed call with a start time no later than its end time, the
 * duration written to the `calls` table SHALL equal floor((endMs − startMs) /
 * 1000) and SHALL be an integer greater than or equal to zero.
 *
 * The pure computation under test is {@link computeCallDurationSeconds}. The
 * property asserts that, for a start no later than the end, the result equals
 * the floored elapsed seconds and is always a non-negative integer.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { computeCallDurationSeconds } from "../../../convex/campus/logic/callDuration";

/**
 * Arbitrary producing a completed call whose start time is no later than its
 * end time: a start timestamp in milliseconds plus a non-negative elapsed span.
 * Bounds are wide but finite so the millisecond difference stays within safe
 * integer range.
 */
const completedCallArb: fc.Arbitrary<{ startMs: number; endMs: number }> = fc
  .record({
    startMs: fc.integer({ min: 0, max: 4_000_000_000_000 }),
    elapsedMs: fc.integer({ min: 0, max: 86_400_000 }),
  })
  .map(({ startMs, elapsedMs }) => ({ startMs, endMs: startMs + elapsedMs }));

describe("Property 17: Recorded call duration is a non-negative integer number of seconds", () => {
  it("equals floor((endMs − startMs) / 1000) and is a non-negative integer for start ≤ end", () => {
    fc.assert(
      fc.property(completedCallArb, ({ startMs, endMs }) => {
        const duration = computeCallDurationSeconds(startMs, endMs);

        // Matches the specified formula.
        expect(duration).toBe(Math.floor((endMs - startMs) / 1000));
        // Is a whole number of seconds.
        expect(Number.isInteger(duration)).toBe(true);
        // Is never negative.
        expect(duration).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 100 }
    );
  });

  it("stays a non-negative integer even when start is after end (clock adjustment)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 4_000_000_000_000 }),
        fc.integer({ min: 1, max: 86_400_000 }),
        (endMs, backwardsMs) => {
          const startMs = endMs + backwardsMs;
          const duration = computeCallDurationSeconds(startMs, endMs);

          expect(Number.isInteger(duration)).toBe(true);
          expect(duration).toBeGreaterThanOrEqual(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});
