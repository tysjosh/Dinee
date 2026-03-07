/**
 * Property 9: KPI Attribution — Single Period Assignment
 * Validates: Requirements 15.8, 15.9
 *
 * For any call with a given endedAt timestamp (UTC), the call SHALL be
 * attributed to exactly one daily, weekly, and monthly period.
 * New businesses created within the current period are excluded from churn.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  getDailyPeriod,
  getWeeklyPeriod,
  getMonthlyPeriod,
  getPeriodBounds,
  isWithinAttributionWindow,
  isExcludedFromChurn,
  ATTRIBUTION_WINDOWS,
} from "../../src/lib/kpi/kpiComputation";

describe("Property 9: KPI Attribution — Single Period Assignment", () => {
  // Feature: ai-reception-os-pivot, Property 9: KPI Attribution

  it("should assign each call to exactly one daily period", () => {
    fc.assert(
      fc.property(
        // Random UTC timestamp within a reasonable range (2020-2030)
        fc.integer({
          min: new Date("2020-01-01T00:00:00Z").getTime(),
          max: new Date("2030-12-31T23:59:59Z").getTime(),
        }),
        (endedAt) => {
          const period = getDailyPeriod(endedAt);

          // Call must fall within the period
          expect(endedAt).toBeGreaterThanOrEqual(period.periodStart);
          expect(endedAt).toBeLessThan(period.periodEnd);

          // Period must be exactly 24 hours
          expect(period.periodEnd - period.periodStart).toBe(24 * 60 * 60 * 1000);

          // Period start must be at midnight UTC
          const startDate = new Date(period.periodStart);
          expect(startDate.getUTCHours()).toBe(0);
          expect(startDate.getUTCMinutes()).toBe(0);
          expect(startDate.getUTCSeconds()).toBe(0);
          expect(startDate.getUTCMilliseconds()).toBe(0);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("should assign each call to exactly one weekly period (ISO week, Monday start)", () => {
    fc.assert(
      fc.property(
        fc.integer({
          min: new Date("2020-01-01T00:00:00Z").getTime(),
          max: new Date("2030-12-31T23:59:59Z").getTime(),
        }),
        (endedAt) => {
          const period = getWeeklyPeriod(endedAt);

          // Call must fall within the period
          expect(endedAt).toBeGreaterThanOrEqual(period.periodStart);
          expect(endedAt).toBeLessThan(period.periodEnd);

          // Period must be exactly 7 days
          expect(period.periodEnd - period.periodStart).toBe(7 * 24 * 60 * 60 * 1000);

          // Period start must be a Monday
          const startDate = new Date(period.periodStart);
          expect(startDate.getUTCDay()).toBe(1); // Monday
        }
      ),
      { numRuns: 200 }
    );
  });

  it("should assign each call to exactly one monthly period", () => {
    fc.assert(
      fc.property(
        fc.integer({
          min: new Date("2020-01-01T00:00:00Z").getTime(),
          max: new Date("2030-12-31T23:59:59Z").getTime(),
        }),
        (endedAt) => {
          const period = getMonthlyPeriod(endedAt);

          // Call must fall within the period
          expect(endedAt).toBeGreaterThanOrEqual(period.periodStart);
          expect(endedAt).toBeLessThan(period.periodEnd);

          // Period start must be first of month at midnight UTC
          const startDate = new Date(period.periodStart);
          expect(startDate.getUTCDate()).toBe(1);
          expect(startDate.getUTCHours()).toBe(0);
          expect(startDate.getUTCMinutes()).toBe(0);

          // Period end must be first of next month
          const endDate = new Date(period.periodEnd);
          expect(endDate.getUTCDate()).toBe(1);
          expect(endDate.getUTCHours()).toBe(0);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("should handle boundary timestamps correctly (midnight UTC)", () => {
    // Midnight UTC should belong to the new day, not the previous
    const midnight = new Date("2025-06-15T00:00:00Z").getTime();
    const daily = getDailyPeriod(midnight);
    expect(daily.periodStart).toBe(midnight);
    expect(midnight).toBeGreaterThanOrEqual(daily.periodStart);
    expect(midnight).toBeLessThan(daily.periodEnd);

    // First of month should belong to that month
    const firstOfMonth = new Date("2025-03-01T00:00:00Z").getTime();
    const monthly = getMonthlyPeriod(firstOfMonth);
    const monthStart = new Date(monthly.periodStart);
    expect(monthStart.getUTCMonth()).toBe(2); // March = 2
    expect(monthStart.getUTCDate()).toBe(1);
  });

  it("should never assign a call to zero or multiple periods of the same type", () => {
    fc.assert(
      fc.property(
        fc.integer({
          min: new Date("2020-01-01T00:00:00Z").getTime(),
          max: new Date("2030-12-31T23:59:59Z").getTime(),
        }),
        fc.constantFrom("day" as const, "week" as const, "month" as const),
        (endedAt, periodType) => {
          const period = getPeriodBounds(endedAt, periodType);

          // Exactly one period: timestamp is >= start and < end
          expect(endedAt >= period.periodStart && endedAt < period.periodEnd).toBe(true);

          // Adjacent period should NOT contain this timestamp
          // Next period starts at periodEnd
          const nextPeriod = getPeriodBounds(period.periodEnd, periodType);
          expect(endedAt < nextPeriod.periodStart || endedAt >= nextPeriod.periodEnd || endedAt < period.periodEnd).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("should respect attribution windows per vertical", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1000000000000, max: 2000000000000 }), // callEndedAt
        fc.constantFrom("restaurant", "logistics", "general_services"),
        (callEndedAt, vertical) => {
          const window = ATTRIBUTION_WINDOWS[vertical];

          // Outcome exactly at call end → within window
          expect(isWithinAttributionWindow(callEndedAt, callEndedAt, vertical)).toBe(true);

          // Outcome at call end + window → within window (boundary)
          expect(isWithinAttributionWindow(callEndedAt, callEndedAt + window, vertical)).toBe(true);

          // Outcome 1ms after window → outside
          expect(isWithinAttributionWindow(callEndedAt, callEndedAt + window + 1, vertical)).toBe(false);

          // Outcome before call end → outside
          expect(isWithinAttributionWindow(callEndedAt, callEndedAt - 1, vertical)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("should exclude new businesses from churn in their creation period", () => {
    fc.assert(
      fc.property(
        fc.integer({
          min: new Date("2020-01-01T00:00:00Z").getTime(),
          max: new Date("2030-12-31T23:59:59Z").getTime(),
        }),
        (timestamp) => {
          const period = getDailyPeriod(timestamp);

          // Business created within the period → excluded from churn
          expect(isExcludedFromChurn(timestamp, period.periodStart, period.periodEnd)).toBe(true);

          // Business created before the period → NOT excluded
          expect(isExcludedFromChurn(period.periodStart - 1, period.periodStart, period.periodEnd)).toBe(false);

          // Business created at period end → NOT excluded (belongs to next period)
          expect(isExcludedFromChurn(period.periodEnd, period.periodStart, period.periodEnd)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});
