// Feature: campus-social-loops, Property 29: Minors see only content explicitly marked age-appropriate
/**
 * Feature: campus-social-loops, Property 29: Minors see only content explicitly
 * marked age-appropriate
 *
 * Validates: Requirements 7.7
 *
 * The pure logic under test is {@link filterAgeAppropriate} from
 * `convex/campus/social/logic/companion.ts`. Req 7.7 requires that where a
 * viewer is a minor, presented Social_Loops_Layer content (Daily_Challenges,
 * Agent_Battles, Campus_Quests) is restricted to items explicitly marked
 * age-appropriate for the minor band, excluding anything not so marked
 * (including unmarked content). Other bands (`adult`, `unknown`) are
 * unaffected.
 *
 * The properties below assert this at the requirement level: for a minor, the
 * result is exactly the marked-for-minor items (nothing marked is dropped,
 * nothing unmarked slips through), order and identity are preserved, and for
 * every other band the input is returned unchanged.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import { filterAgeAppropriate } from "../../../../convex/campus/social/logic/companion";
import {
  ageFilterInputArb,
  ageMarkedContentSetArb,
} from "./arbitraries";

/** A viewer band that is not `minor` (content is unaffected — Req 7.7). */
const nonMinorBandArb = fc.constantFrom("adult", "unknown");

describe("Property 29: Minors see only content explicitly marked age-appropriate", () => {
  it("for a minor viewer, returns exactly the items explicitly marked for minors and excludes everything else", () => {
    fc.assert(
      fc.property(ageMarkedContentSetArb, (items) => {
        const result = filterAgeAppropriate(items, "minor");

        // Every surfaced item is explicitly marked appropriate for minors.
        for (const item of result) {
          expect(item.ageAppropriateFor.includes("minor")).toBe(true);
        }

        // Every input item marked for minors is surfaced; every unmarked item
        // (including items with no markers at all) is excluded.
        const surfacedIds = new Set(result.map((i) => i.id));
        for (const item of items) {
          const markedForMinor = item.ageAppropriateFor.includes("minor");
          if (markedForMinor) {
            expect(surfacedIds.has(item.id)).toBe(true);
          }
        }

        // The result is a subset drawn from the input in original order.
        const inputMarked = items.filter((i) =>
          i.ageAppropriateFor.includes("minor"),
        );
        expect(result).toEqual(inputMarked);
      }),
      { numRuns: 100 },
    );
  });

  it("never surfaces unmarked content to a minor", () => {
    fc.assert(
      fc.property(ageMarkedContentSetArb, (items) => {
        const result = filterAgeAppropriate(items, "minor");
        const unmarked = items.filter(
          (i) => !i.ageAppropriateFor.includes("minor"),
        );
        const surfacedIds = new Set(result.map((i) => i.id));
        for (const item of unmarked) {
          // An unmarked item may share an id only with a marked item; ensure no
          // purely-unmarked item is surfaced.
          const anyMarkedWithSameId = items.some(
            (o) => o.id === item.id && o.ageAppropriateFor.includes("minor"),
          );
          if (!anyMarkedWithSameId) {
            expect(surfacedIds.has(item.id)).toBe(false);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it("leaves content unaffected for non-minor viewers (adult / unknown)", () => {
    fc.assert(
      fc.property(ageMarkedContentSetArb, nonMinorBandArb, (items, band) => {
        const result = filterAgeAppropriate(items, band);
        // Every item is returned, in the same order, unchanged.
        expect(result).toEqual(items);
      }),
      { numRuns: 100 },
    );
  });

  it("is idempotent: filtering an already-filtered set yields the same set for any viewer band", () => {
    fc.assert(
      fc.property(ageFilterInputArb, ({ items, viewerBand }) => {
        const once = filterAgeAppropriate(items, viewerBand);
        const twice = filterAgeAppropriate(once, viewerBand);
        expect(twice).toEqual(once);
      }),
      { numRuns: 100 },
    );
  });
});
