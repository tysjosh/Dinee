// Feature: dinee-campus, call-minutes metering from call duration (Req 13.6)
/**
 * Feature: dinee-campus — call-minutes metering.
 *
 * Validates the pure {@link callMinutesFromDuration} helper used by
 * `endBrowserCall` to advance the owning account's monthly call-minutes usage
 * (Req 13.6). A partial minute rounds up so any real conversation consumes at
 * least one minute; a zero/negative/non-finite duration consumes none.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { callMinutesFromDuration } from "../../../convex/campus/logic/callDuration";

describe("Call-minutes metering rounds partial minutes up", () => {
  it("equals ceil(durationSeconds / 60) for any positive duration", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 86_400 }), (durationSeconds) => {
        const minutes = callMinutesFromDuration(durationSeconds);
        expect(minutes).toBe(Math.ceil(durationSeconds / 60));
        // A real conversation always consumes at least one minute.
        expect(minutes).toBeGreaterThanOrEqual(1);
        // Never more than one minute beyond the exact quotient.
        expect(minutes).toBeLessThanOrEqual(Math.floor(durationSeconds / 60) + 1);
        expect(Number.isInteger(minutes)).toBe(true);
      })
    );
  });

  it("meters exact boundaries correctly", () => {
    expect(callMinutesFromDuration(1)).toBe(1);
    expect(callMinutesFromDuration(59)).toBe(1);
    expect(callMinutesFromDuration(60)).toBe(1);
    expect(callMinutesFromDuration(61)).toBe(2);
    expect(callMinutesFromDuration(120)).toBe(2);
    expect(callMinutesFromDuration(121)).toBe(3);
  });

  it("consumes no minutes for a zero/negative/non-finite duration", () => {
    expect(callMinutesFromDuration(0)).toBe(0);
    fc.assert(
      fc.property(fc.integer({ min: -86_400, max: 0 }), (nonPositive) => {
        expect(callMinutesFromDuration(nonPositive)).toBe(0);
      })
    );
    expect(callMinutesFromDuration(Number.NaN)).toBe(0);
    expect(callMinutesFromDuration(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
