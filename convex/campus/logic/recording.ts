/**
 * Feature: dinee-campus (Task 16.1)
 *
 * Pure, property-testable core for the Privacy_Controls recording/summary
 * snapshot and the Caller decline-override. These functions carry NO Convex
 * `ctx` and perform no I/O, so they can be exercised directly by unit and
 * property tests and imported by the Convex services that wrap them
 * (`convex/campus/privacy.ts` `setRecordingEnabled`/`setSummariesEnabled`, and
 * the Voice_Runtime that snapshots the effective setting into the `calls` row's
 * `recordingEnabled` field at call start).
 *
 * Covered behaviors:
 *   - 12.5 / 12.6 (Property 31): a change to an agent's recording-enabled or
 *     summaries-enabled setting made at time T applies ONLY to calls started at
 *     or after T. A call started before T retains the setting value that was in
 *     effect at its start. The effective value for a call is therefore the value
 *     of the most recent setting change whose effective time is at or before the
 *     call's start time (or the agent's initial default when no change precedes
 *     the call).
 *   - 12.8 (Property 32): a Caller who declines the recording-and-summarization
 *     notice forces the call to be NEITHER recorded NOR summarized, regardless of
 *     the agent's recording or summary settings.
 *
 * The two concerns compose: first resolve the setting values in effect at call
 * start (the snapshot), then apply the Caller's acknowledgement (the override).
 */

// ---------------------------------------------------------------------------
// Setting-change history (Req 12.5, 12.6 — future-only application)
// ---------------------------------------------------------------------------

/**
 * A single recorded change to a boolean privacy setting (recording-enabled or
 * summaries-enabled). `effectiveAtMs` is the wall-clock time, in milliseconds,
 * at which the Student_Creator made the change; `value` is the setting value
 * from that moment onward. A change made at time T applies to every call
 * started at or after T (Req 12.5, 12.6).
 */
export interface SettingChange {
  effectiveAtMs: number;
  value: boolean;
}

/**
 * Returns the boolean setting value that was in effect at `callStartMs`, given
 * the agent's initial `defaultValue` and its chronological `changes`
 * (Req 12.5, 12.6, Property 31).
 *
 * The value in effect at call start is the `value` of the change with the
 * greatest `effectiveAtMs` that is at or before `callStartMs`; when no change
 * precedes (or coincides with) the call start, the agent's `defaultValue` is
 * returned. A change made at exactly `callStartMs` DOES apply to the call
 * ("started at or after T"). When two changes share the same `effectiveAtMs`,
 * the one appearing later in `changes` (the more recently recorded) wins.
 *
 * The input array is neither required to be sorted nor mutated. Pure.
 */
export function settingInEffectAt(
  changes: readonly SettingChange[],
  callStartMs: number,
  defaultValue: boolean
): boolean {
  let effectiveValue = defaultValue;
  let effectiveAtMs = -Infinity;
  for (const change of changes) {
    // A change at or before the call start is in effect for the call; on ties
    // (`>=`) the later-listed change wins, matching "most recent setting".
    if (change.effectiveAtMs <= callStartMs && change.effectiveAtMs >= effectiveAtMs) {
      effectiveAtMs = change.effectiveAtMs;
      effectiveValue = change.value;
    }
  }
  return effectiveValue;
}

// ---------------------------------------------------------------------------
// Call privacy snapshot + decline override (Req 12.5, 12.6, 12.8)
// ---------------------------------------------------------------------------

/**
 * The recording/summary settings for a Campus_Agent: the initial defaults plus
 * the chronological change history for each. Structurally satisfied by the
 * agent record's `recordingEnabled`/`summariesEnabled` fields together with a
 * change log resolved by the Convex service. A missing change log is treated as
 * "no changes" (the default stays in effect).
 */
export interface AgentPrivacySettings {
  recordingDefault: boolean;
  summariesDefault: boolean;
  recordingChanges?: readonly SettingChange[];
  summariesChanges?: readonly SettingChange[];
}

/**
 * The recording/summary decision for a single call: whether the call is
 * recorded and whether a summary is generated for it. This is the value the
 * Voice_Runtime snapshots into the `calls` row at call start.
 */
export interface CallPrivacyDecision {
  recordingEnabled: boolean;
  summariesEnabled: boolean;
}

/**
 * Resolves the recording/summary settings in effect for a call started at
 * `callStartMs`, applying each setting's change history so that a setting change
 * affects only calls started at or after the change (Req 12.5, 12.6,
 * Property 31). This is the "snapshot" taken at call start; it does NOT yet
 * account for the Caller's acknowledgement of the notice.
 *
 * Pure and non-mutating.
 */
export function snapshotPrivacyAtCallStart(
  settings: AgentPrivacySettings,
  callStartMs: number
): CallPrivacyDecision {
  return {
    recordingEnabled: settingInEffectAt(
      settings.recordingChanges ?? [],
      callStartMs,
      settings.recordingDefault
    ),
    summariesEnabled: settingInEffectAt(
      settings.summariesChanges ?? [],
      callStartMs,
      settings.summariesDefault
    ),
  };
}

/**
 * Applies the Caller's response to the recording-and-summarization notice to a
 * snapshotted privacy decision (Req 12.8, Property 32).
 *
 * When the Caller declines the notice (`callerAcknowledgedNotice` is `false`),
 * the call is NEITHER recorded NOR summarized regardless of the agent's
 * settings, so both flags are forced to `false`. When the Caller acknowledges
 * the notice, the snapshotted decision is preserved unchanged.
 *
 * Pure and non-mutating.
 */
export function applyDeclineOverride(
  snapshot: CallPrivacyDecision,
  callerAcknowledgedNotice: boolean
): CallPrivacyDecision {
  if (!callerAcknowledgedNotice) {
    return { recordingEnabled: false, summariesEnabled: false };
  }
  return {
    recordingEnabled: snapshot.recordingEnabled,
    summariesEnabled: snapshot.summariesEnabled,
  };
}

/**
 * Computes the effective recording/summary decision for a call
 * (Req 12.5, 12.6, 12.8). This is the single entry point the Voice_Runtime uses
 * at call start: it first snapshots the settings in effect at `callStartMs`
 * (future-only application of setting changes, Property 31) and then applies the
 * Caller's acknowledgement of the notice (a decline forces neither-recorded-
 * nor-summarized, Property 32).
 *
 * Pure and non-mutating.
 */
export function computeEffectiveCallPrivacy(request: {
  settings: AgentPrivacySettings;
  callStartMs: number;
  callerAcknowledgedNotice: boolean;
}): CallPrivacyDecision {
  const snapshot = snapshotPrivacyAtCallStart(
    request.settings,
    request.callStartMs
  );
  return applyDeclineOverride(snapshot, request.callerAcknowledgedNotice);
}
