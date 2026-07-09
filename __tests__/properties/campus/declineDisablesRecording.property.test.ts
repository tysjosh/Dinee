// Feature: dinee-campus, Property 32: Declining the notice disables recording and summarization for that call
/**
 * Feature: dinee-campus, Property 32: Declining the notice disables recording and summarization for that call
 *
 * Validates: Requirements 12.8
 *
 * For any call in which the Caller declines the recording-and-summarization
 * notice, that call SHALL be neither recorded nor summarized regardless of the
 * agent's recording or summary settings (Req 12.8).
 *
 * The pure decision under test is {@link computeEffectiveCallPrivacy}, the entry
 * point the Voice_Runtime uses at call start. It snapshots the settings in
 * effect at `callStartMs` (future-only application of setting changes,
 * Property 31) and then applies the Caller's acknowledgement of the notice. A
 * decline (`callerAcknowledgedNotice === false`) forces both `recordingEnabled`
 * and `summariesEnabled` to `false`, and an acknowledgement preserves the
 * snapshotted decision unchanged.
 *
 * The property spans the full agent-settings space (arbitrary defaults and
 * arbitrary change histories) crossed with an arbitrary call start time and the
 * Caller's boolean acknowledgement, so every combination of settings that could
 * otherwise enable recording or summaries is exercised against a decline.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  computeEffectiveCallPrivacy,
  snapshotPrivacyAtCallStart,
  type AgentPrivacySettings,
  type SettingChange,
} from "../../../convex/campus/logic/recording";

/** A single chronological privacy setting change. */
const settingChangeArb: fc.Arbitrary<SettingChange> = fc.record({
  effectiveAtMs: fc.integer({ min: 0, max: 10_000_000 }),
  value: fc.boolean(),
});

/**
 * Arbitrary spanning the agent's recording/summary settings: independent
 * boolean defaults plus (optionally absent) chronological change histories for
 * each setting.
 */
const agentPrivacySettingsArb: fc.Arbitrary<AgentPrivacySettings> = fc.record({
  recordingDefault: fc.boolean(),
  summariesDefault: fc.boolean(),
  recordingChanges: fc.option(fc.array(settingChangeArb, { maxLength: 8 }), {
    nil: undefined,
  }),
  summariesChanges: fc.option(fc.array(settingChangeArb, { maxLength: 8 }), {
    nil: undefined,
  }),
});

const callStartMsArb = fc.integer({ min: 0, max: 10_000_000 });

describe("Property 32: Declining the notice disables recording and summarization for that call", () => {
  it("forces neither-recorded-nor-summarized when the Caller declines, regardless of settings", () => {
    fc.assert(
      fc.property(agentPrivacySettingsArb, callStartMsArb, (settings, callStartMs) => {
        const decision = computeEffectiveCallPrivacy({
          settings,
          callStartMs,
          callerAcknowledgedNotice: false,
        });
        expect(decision.recordingEnabled).toBe(false);
        expect(decision.summariesEnabled).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it("preserves the snapshotted decision when the Caller acknowledges the notice", () => {
    fc.assert(
      fc.property(agentPrivacySettingsArb, callStartMsArb, (settings, callStartMs) => {
        const snapshot = snapshotPrivacyAtCallStart(settings, callStartMs);
        const decision = computeEffectiveCallPrivacy({
          settings,
          callStartMs,
          callerAcknowledgedNotice: true,
        });
        expect(decision.recordingEnabled).toBe(snapshot.recordingEnabled);
        expect(decision.summariesEnabled).toBe(snapshot.summariesEnabled);
      }),
      { numRuns: 100 }
    );
  });
});
