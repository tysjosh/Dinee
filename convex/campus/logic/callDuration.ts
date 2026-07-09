/**
 * Feature: dinee-campus (Task 10.1)
 *
 * Pure call-duration computation for the Voice_Runtime. This function carries
 * NO Convex `ctx` and performs no I/O, so it can be exercised directly by unit
 * and property tests and imported by the Convex service functions that record
 * the completed call in the `calls` table.
 *
 * Requirement 8.8: WHEN a voice conversation ends, THE Voice_Runtime SHALL
 * record the call duration in whole seconds in the `calls` table.
 *
 * The duration is `floor((endMs − startMs) / 1000)` — the elapsed wall-clock
 * time in whole seconds (Property 17). For any completed call whose start time
 * is no later than its end time, the result is an integer greater than or equal
 * to zero. To keep that guarantee even when clocks report a start after the end
 * (e.g. a clock adjustment), a negative elapsed span is clamped to zero rather
 * than producing a negative or non-integer duration.
 */

/**
 * Computes the duration of a completed call in whole seconds (Req 8.8).
 *
 * `duration = floor((endMs − startMs) / 1000)`, computed from the call's start
 * and end timestamps in milliseconds. The result is always an integer ≥ 0: when
 * `startMs ≤ endMs` it is the floored elapsed seconds, and when `startMs > endMs`
 * it is clamped to `0` so a recorded duration is never negative.
 *
 * Pure and non-mutating.
 *
 * @param startMs - the conversation start time, in milliseconds
 * @param endMs - the conversation end time, in milliseconds
 * @returns the call duration in whole seconds (integer ≥ 0)
 */
export function computeCallDurationSeconds(
  startMs: number,
  endMs: number
): number {
  const elapsedMs = endMs - startMs;
  if (elapsedMs <= 0) {
    return 0;
  }
  return Math.floor(elapsedMs / 1000);
}

/**
 * Converts a whole-second call duration into the number of call MINUTES metered
 * against the owning account's Usage_Limit (Req 13.6). Any partial minute is
 * rounded up so a conversation always consumes at least one minute, and a
 * zero/negative/non-finite duration consumes none.
 *
 * Pure and non-mutating.
 *
 * @param durationSeconds - the call duration in whole seconds (integer ≥ 0)
 * @returns the billable whole minutes (integer ≥ 0)
 */
export function callMinutesFromDuration(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return 0;
  }
  return Math.ceil(durationSeconds / 60);
}
