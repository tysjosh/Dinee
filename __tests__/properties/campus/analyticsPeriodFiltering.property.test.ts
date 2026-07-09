// Feature: dinee-campus, Property 21: Analytics period filtering
/**
 * Feature: dinee-campus, Property 21: Analytics period filtering
 *
 * Validates: Requirements 9.8
 *
 * For any set of events and any selected reporting period, the aggregation
 * SHALL include exactly those events whose timestamp falls within the period
 * window, and when no period is selected the window SHALL be the trailing 30
 * days.
 *
 * The pure computations under test are {@link resolvePeriod} (which fixes the
 * reporting window, defaulting to the trailing {@link DEFAULT_PERIOD_DAYS}
 * days) and {@link filterEventsByPeriod} (which restricts a timestamped stream
 * to that window, inclusive on both ends). The properties assert:
 *   1. the filtered set is EXACTLY the events within `[startMs, endMs]`
 *      (nothing inside is dropped, nothing outside is kept, order preserved);
 *   2. when no period is selected the resolved window is the trailing 30 days
 *      ending at `now`.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  resolvePeriod,
  filterEventsByPeriod,
  isWithinPeriod,
  DEFAULT_PERIOD_DAYS,
  type Period,
} from "../../../convex/campus/logic/analytics";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** A timestamped item, standing in for any period-filterable analytics record. */
interface Timestamped {
  createdAt: number;
  id: number;
}

/** Wide but finite timestamp range, kept within safe integer bounds. */
const timestampArb = fc.integer({ min: 0, max: 4_000_000_000_000 });

/** A small stream of timestamped items with stable ids for identity checks. */
const itemsArb: fc.Arbitrary<Timestamped[]> = fc
  .array(timestampArb, { maxLength: 40 })
  .map((times) => times.map((createdAt, id) => ({ createdAt, id })));

/** An arbitrary well-formed period window with startMs <= endMs. */
const periodArb: fc.Arbitrary<Period> = fc
  .record({
    startMs: fc.integer({ min: 0, max: 4_000_000_000_000 }),
    spanMs: fc.integer({ min: 0, max: 90 * MS_PER_DAY }),
  })
  .map(({ startMs, spanMs }) => ({ startMs, endMs: startMs + spanMs }));

describe("Property 21: Analytics period filtering", () => {
  it("includes exactly the events whose timestamp falls within the window", () => {
    fc.assert(
      fc.property(itemsArb, periodArb, (items, period) => {
        const filtered = filterEventsByPeriod(items, period);

        // Every kept item is within the window, and none are duplicated.
        for (const item of filtered) {
          expect(isWithinPeriod(item.createdAt, period)).toBe(true);
        }

        // Nothing within the window is dropped: the kept set equals the set of
        // in-window items, by id.
        const expectedIds = items
          .filter((item) => isWithinPeriod(item.createdAt, period))
          .map((item) => item.id);
        const filteredIds = filtered.map((item) => item.id);
        expect(filteredIds).toEqual(expectedIds);

        // Partition is exact: kept + dropped == input, with no overlap.
        const droppedIds = items
          .filter((item) => !isWithinPeriod(item.createdAt, period))
          .map((item) => item.id);
        expect(new Set([...filteredIds, ...droppedIds]).size).toBe(items.length);
        expect(filteredIds.length + droppedIds.length).toBe(items.length);
      }),
      { numRuns: 100 }
    );
  });

  it("is inclusive on both endpoints of the window", () => {
    fc.assert(
      fc.property(periodArb, (period) => {
        const atBounds: Timestamped[] = [
          { createdAt: period.startMs, id: 0 },
          { createdAt: period.endMs, id: 1 },
        ];
        const filtered = filterEventsByPeriod(atBounds, period);
        // Both the start and end instants are retained.
        expect(filtered.map((item) => item.id)).toEqual([0, 1]);
      }),
      { numRuns: 100 }
    );
  });

  it("does not mutate its input array", () => {
    fc.assert(
      fc.property(itemsArb, periodArb, (items, period) => {
        const snapshot = items.map((item) => ({ ...item }));
        filterEventsByPeriod(items, period);
        expect(items).toEqual(snapshot);
      }),
      { numRuns: 100 }
    );
  });

  it("defaults to the trailing 30 days ending at now when no period is selected", () => {
    fc.assert(
      fc.property(timestampArb, (now) => {
        const period = resolvePeriod(now);
        expect(period.endMs).toBe(now);
        expect(period.startMs).toBe(now - DEFAULT_PERIOD_DAYS * MS_PER_DAY);
        // The window spans exactly 30 days.
        expect(period.endMs - period.startMs).toBe(DEFAULT_PERIOD_DAYS * MS_PER_DAY);
      }),
      { numRuns: 100 }
    );
  });

  it("treats an empty selection object the same as no selection (trailing 30 days)", () => {
    fc.assert(
      fc.property(timestampArb, (now) => {
        const period = resolvePeriod(now, {});
        expect(period.endMs).toBe(now);
        expect(period.startMs).toBe(now - DEFAULT_PERIOD_DAYS * MS_PER_DAY);
      }),
      { numRuns: 100 }
    );
  });

  it("honors an explicitly selected window and falls back per missing bound", () => {
    fc.assert(
      fc.property(
        timestampArb,
        fc.integer({ min: 0, max: 4_000_000_000_000 }),
        fc.integer({ min: 0, max: 4_000_000_000_000 }),
        (now, start, end) => {
          // Fully specified selection is used verbatim.
          const full = resolvePeriod(now, { startMs: start, endMs: end });
          expect(full).toEqual({ startMs: start, endMs: end });

          // Missing start falls back to the trailing-30-day start; end honored.
          const noStart = resolvePeriod(now, { endMs: end });
          expect(noStart.startMs).toBe(now - DEFAULT_PERIOD_DAYS * MS_PER_DAY);
          expect(noStart.endMs).toBe(end);

          // Missing end falls back to now; start honored.
          const noEnd = resolvePeriod(now, { startMs: start });
          expect(noEnd.startMs).toBe(start);
          expect(noEnd.endMs).toBe(now);
        }
      ),
      { numRuns: 100 }
    );
  });
});
