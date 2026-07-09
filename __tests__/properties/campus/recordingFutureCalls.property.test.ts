// Feature: dinee-campus, Property 31: Recording and summary settings apply only to future calls
/**
 * Feature: dinee-campus, Property 31: Recording and summary settings apply only to future calls
 *
 * Validates: Requirements 12.5, 12.6
 *
 * For any change to an agent's recording-enabled or summaries-enabled setting at
 * time T, every call started at or after T SHALL carry the new setting value,
 * while calls started before T SHALL retain the setting value in effect at their
 * start (Req 12.5, 12.6).
 *
 * The pure core under test is {@link settingInEffectAt}, which resolves the value
 * in effect at a call's start from the agent's default and its chronological
 * change history, and {@link snapshotPrivacyAtCallStart}, which applies that
 * resolution independently to the recording and summary settings — the snapshot
 * the Voice_Runtime records on the `calls` row at call start.
 *
 * Properties asserted:
 *   1. Oracle agreement: the resolved value equals the value of the most recent
 *      change whose effective time is at or before the call start, or the default
 *      when no change precedes the call. This is checked against an independent
 *      oracle rather than a copy of the implementation.
 *   2. Future-only application: introducing a change at time T never alters the
 *      resolved value for any call started strictly before T (calls before T
 *      retain their prior effective value).
 *   3. Future value adoption: a change at T that is the most recent change is
 *      carried by every call started at or after T.
 *   4. Snapshot composition: the snapshot resolves recording and summaries
 *      independently, each matching {@link settingInEffectAt}.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  settingInEffectAt,
  snapshotPrivacyAtCallStart,
  type SettingChange,
  type AgentPrivacySettings,
} from "../../../convex/campus/logic/recording";

/**
 * A change history with DISTINCT effective times, so the "most recent change at
 * or before the call start" is unambiguous and can be checked against a simple
 * oracle without depending on tie-break ordering. Timestamps are drawn from a
 * bounded set and de-duplicated; the array order is intentionally left
 * unsorted to exercise `settingInEffectAt`'s order-independence.
 */
const distinctChangesArb: fc.Arbitrary<SettingChange[]> = fc
  .uniqueArray(fc.integer({ min: 0, max: 1_000 }), { maxLength: 12 })
  .chain((times) =>
    fc.tuple(
      ...times.map((t) =>
        fc.boolean().map((value) => ({ effectiveAtMs: t, value }))
      )
    )
  )
  .map((changes) => changes as SettingChange[]);

/** Call start time drawn from the same span as change times (plus margins). */
const callStartArb = fc.integer({ min: -50, max: 1_050 });

/**
 * Independent oracle: the setting value in effect at `callStartMs` is the value
 * of the change with the greatest effective time that is at or before the call
 * start, or `defaultValue` when no such change exists. Requires distinct
 * effective times (guaranteed by {@link distinctChangesArb}).
 */
function expectedSettingInEffect(
  changes: readonly SettingChange[],
  callStartMs: number,
  defaultValue: boolean
): boolean {
  const applicable = changes
    .filter((c) => c.effectiveAtMs <= callStartMs)
    .sort((a, b) => a.effectiveAtMs - b.effectiveAtMs);
  return applicable.length === 0
    ? defaultValue
    : applicable[applicable.length - 1].value;
}

describe("Property 31: Recording and summary settings apply only to future calls", () => {
  it("resolves the value of the most recent change at or before call start, else the default (Req 12.5, 12.6)", () => {
    fc.assert(
      fc.property(
        distinctChangesArb,
        callStartArb,
        fc.boolean(),
        (changes, callStartMs, defaultValue) => {
          expect(settingInEffectAt(changes, callStartMs, defaultValue)).toBe(
            expectedSettingInEffect(changes, callStartMs, defaultValue)
          );
        }
      ),
      { numRuns: 100 }
    );
  });

  it("a change at T never alters the value for any call started strictly before T (Req 12.5, 12.6)", () => {
    fc.assert(
      fc.property(
        distinctChangesArb,
        fc.integer({ min: 0, max: 1_000 }),
        fc.boolean(),
        fc.boolean(),
        (changes, changeTimeMs, changeValue, defaultValue) => {
          const withoutChange = changes.filter(
            (c) => c.effectiveAtMs !== changeTimeMs
          );
          const withChange: SettingChange[] = [
            ...withoutChange,
            { effectiveAtMs: changeTimeMs, value: changeValue },
          ];
          // Any call started strictly before the change is unaffected by it.
          for (let callStartMs = -10; callStartMs < changeTimeMs; callStartMs++) {
            expect(
              settingInEffectAt(withChange, callStartMs, defaultValue)
            ).toBe(settingInEffectAt(withoutChange, callStartMs, defaultValue));
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("a call started at or after the most recent change carries that change's value (Req 12.5, 12.6)", () => {
    fc.assert(
      fc.property(
        distinctChangesArb,
        fc.boolean(),
        fc.boolean(),
        fc.integer({ min: 0, max: 200 }),
        (priorChanges, latestValue, defaultValue, offset) => {
          // Place the new change strictly after every prior change so it is the
          // most recent; calls at or after its time must adopt its value.
          const maxPriorTime = priorChanges.reduce(
            (max, c) => Math.max(max, c.effectiveAtMs),
            -1
          );
          const changeTimeMs = maxPriorTime + 1;
          const changes: SettingChange[] = [
            ...priorChanges,
            { effectiveAtMs: changeTimeMs, value: latestValue },
          ];
          const callStartMs = changeTimeMs + offset;
          expect(settingInEffectAt(changes, callStartMs, defaultValue)).toBe(
            latestValue
          );
        }
      ),
      { numRuns: 100 }
    );
  });

  it("snapshots recording and summaries independently, each future-only (Req 12.5, 12.6)", () => {
    const settingsArb: fc.Arbitrary<AgentPrivacySettings> = fc.record({
      recordingDefault: fc.boolean(),
      summariesDefault: fc.boolean(),
      recordingChanges: distinctChangesArb,
      summariesChanges: distinctChangesArb,
    });
    fc.assert(
      fc.property(settingsArb, callStartArb, (settings, callStartMs) => {
        const snapshot = snapshotPrivacyAtCallStart(settings, callStartMs);
        expect(snapshot.recordingEnabled).toBe(
          settingInEffectAt(
            settings.recordingChanges ?? [],
            callStartMs,
            settings.recordingDefault
          )
        );
        expect(snapshot.summariesEnabled).toBe(
          settingInEffectAt(
            settings.summariesChanges ?? [],
            callStartMs,
            settings.summariesDefault
          )
        );
      }),
      { numRuns: 100 }
    );
  });
});
