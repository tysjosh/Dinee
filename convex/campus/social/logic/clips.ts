/**
 * Feature: campus-social-loops (Task 5.1)
 *
 * Pure, property-testable core for the `Clip_Studio` service, which extends the
 * existing Call_Clip pipeline (`decideCallClip`, `campusCallClips`,
 * `AI_VOICE_AGENT_LABEL`) into ready-to-post captioned Share_Clips. This module
 * carries NO Convex `ctx` and performs no I/O: it decides (1) whether a
 * completed call should surface a Clip_Suggestion, (2) how a requested clip
 * duration is clamped into the produced-clip bounds, and (3) whether a produced
 * clip is available for sharing after the consent + fail-closed screening
 * gates. It is imported by both the `convex/campus/social/clips.ts` service and
 * the property tests, so the rules the properties exercise are the rules
 * enforced at runtime — the same discipline as `convex/campus/logic/**`.
 *
 * The Safety_Service screening decision is reused verbatim: this module accepts
 * the existing {@link ScreeningDecision} rather than redefining screening
 * semantics, so Share_Clip availability inherits the platform's fail-closed
 * behavior (Req 3.6, 3.7, 3.10).
 *
 * Covered requirements: 3.1–3.11, 8.2.
 */

import {
  SCREENING_UNAVAILABLE_ERROR,
  type ScreeningDecision,
} from "../../logic/screening";

/**
 * Minimum recorded call length (seconds) for which a Clip_Suggestion is offered
 * (Req 3.1, 3.9). A source shorter than this presents no suggestion.
 */
export const SHARE_CLIP_MIN_SOURCE_SEC = 20;

/** Minimum produced Share_Clip duration in seconds (Req 3.2). */
export const SHARE_CLIP_MIN_SEC = 10;

/** Maximum produced Share_Clip duration in seconds (Req 3.2). */
export const SHARE_CLIP_MAX_SEC = 20;

// ---------------------------------------------------------------------------
// Clip suggestion gate (Req 3.1, 3.3, 3.9)
// ---------------------------------------------------------------------------

/**
 * The decision of whether a completed call should surface a Clip_Suggestion.
 *
 *   - `{ suggest: true }`: the call was recorded with Recording_Consent and its
 *     source duration is at least {@link SHARE_CLIP_MIN_SOURCE_SEC} (Req 3.1).
 *   - `{ suggest: false; reason: "no_recording_consent" }`: Recording_Consent
 *     was not granted, so a clip is available only for recorded calls (Req 3.3).
 *   - `{ suggest: false; reason: "source_too_short" }`: the call was recorded
 *     with consent but is shorter than the minimum source length (Req 3.9).
 */
export type SuggestionDecision =
  | { suggest: true }
  | { suggest: false; reason: "no_recording_consent" | "source_too_short" };

/**
 * Decides whether a Clip_Suggestion is offered for a completed call (Req 3.1,
 * 3.3, 3.9). Pure and deterministic.
 *
 * Recording_Consent is the primary gate: without it the call was never
 * recorded, so a clip cannot exist regardless of duration and the
 * "recorded calls only" path (`no_recording_consent`) applies (Req 3.3). With
 * consent, a source shorter than {@link SHARE_CLIP_MIN_SOURCE_SEC} is too short
 * to suggest (`source_too_short`, Req 3.9); a source of at least that length is
 * suggested (Req 3.1).
 */
export function decideClipSuggestion(input: {
  recordingConsent: boolean;
  sourceDurationSec: number;
}): SuggestionDecision {
  if (!input.recordingConsent) {
    return { suggest: false, reason: "no_recording_consent" };
  }
  if (!(input.sourceDurationSec >= SHARE_CLIP_MIN_SOURCE_SEC)) {
    return { suggest: false, reason: "source_too_short" };
  }
  return { suggest: true };
}

// ---------------------------------------------------------------------------
// Duration clamp (Req 3.2)
// ---------------------------------------------------------------------------

/**
 * Clamps a requested clip duration into the produced-clip bounds
 * `[SHARE_CLIP_MIN_SEC, SHARE_CLIP_MAX_SEC]` (Req 3.2). Pure and total: a
 * non-finite request (NaN / ±Infinity) fails safe to the minimum bound so a
 * produced clip is always within range.
 */
export function clampClipDuration(requestedSec: number): number {
  if (!Number.isFinite(requestedSec)) {
    return SHARE_CLIP_MIN_SEC;
  }
  return Math.max(SHARE_CLIP_MIN_SEC, Math.min(SHARE_CLIP_MAX_SEC, requestedSec));
}

// ---------------------------------------------------------------------------
// Produced clip + post-generation availability (Req 3.2, 3.4–3.7, 3.10, 8.2)
// ---------------------------------------------------------------------------

/**
 * A produced Share_Clip: a 10–20s captioned excerpt formatted for TikTok,
 * Instagram Reels, and Snapchat, carrying the visible "AI voice agent" label
 * and attribution to the Campus_Agent (Req 3.2, 8.2). Produced on top of the
 * reused Call_Clip pipeline, so `label` is always `AI_VOICE_AGENT_LABEL`.
 */
export interface ProducedShareClip {
  /** Produced clip duration in seconds, within [10, 20] (Req 3.2). */
  durationSec: number;
  /** Always `true` — a produced Share_Clip is captioned (Req 3.2). */
  captions: boolean;
  /** The social formats the clip is prepared for (Req 3.2, 3.8). */
  formats: readonly ("tiktok" | "reels" | "snap")[];
  /** Always `AI_VOICE_AGENT_LABEL` (Req 3.2, 8.2). */
  label: string;
  /** Attribution to the Campus_Agent that produced the clip (Req 3.2, 8.2). */
  agentId: string;
}

/**
 * The post-generation availability decision for a Share_Clip, combining the
 * Sharing_Consent gate with the fail-closed Safety_Service screening decision
 * (Req 3.4–3.7, 3.10).
 *
 *   - `{ status: "available"; clip }`: Sharing_Consent granted and screening
 *     completed cleanly — the clip may be surfaced through the share formats.
 *   - `{ status: "withheld_consent" }`: Sharing_Consent was not granted, so no
 *     clip is delivered and the source recording is retained unchanged
 *     (Req 3.5, and the discard path Req 3.11).
 *   - `{ status: "withheld_policy" }`: screening reported a policy violation, so
 *     the clip is withheld from all share formats and the source recording is
 *     retained unchanged (Req 3.10).
 *   - `{ status: "withheld_screening_error" }`: the screening dependency was
 *     unavailable, so the clip is withheld with a "screening could not
 *     complete" error and the source recording is retained unchanged (Req 3.7).
 */
export type ClipAvailability =
  | { status: "available"; clip: ProducedShareClip }
  | { status: "withheld_consent" }
  | { status: "withheld_policy" }
  | { status: "withheld_screening_error" };

/**
 * Decides whether a produced Share_Clip is available for sharing (Req 3.4–3.7,
 * 3.10). Pure and deterministic.
 *
 * The gate is consent-first, then fail-closed screened:
 *   1. Sharing_Consent must be granted; otherwise the clip is withheld and the
 *      source recording is retained unchanged (`withheld_consent`, Req 3.5).
 *   2. With consent granted, the reused {@link ScreeningDecision} is honored:
 *      a dependency-unavailable decision (carrying the
 *      `screening_unavailable` error) withholds with `withheld_screening_error`
 *      (Req 3.7); any other withheld/flagged decision is a policy violation and
 *      withholds with `withheld_policy` (Req 3.10). In every withheld case the
 *      source recording is retained unchanged.
 *   3. Only a granted consent with a screening decision that is neither withheld
 *      nor errored yields `available` (Req 3.4, 3.6, 3.8).
 */
export function decideClipAvailability(input: {
  sharingConsent: boolean;
  screening: ScreeningDecision;
  clip: ProducedShareClip;
}): ClipAvailability {
  // Consent gate first (Req 3.4, 3.5).
  if (!input.sharingConsent) {
    return { status: "withheld_consent" };
  }

  // Fail-closed screening: a dependency failure is distinguished from a policy
  // violation so the "screening could not complete" error can be surfaced
  // (Req 3.7 vs Req 3.10).
  if (input.screening.error === SCREENING_UNAVAILABLE_ERROR) {
    return { status: "withheld_screening_error" };
  }
  if (input.screening.withheld) {
    return { status: "withheld_policy" };
  }

  // Consent granted + clean screen: the sole available-and-delivered path.
  return { status: "available", clip: input.clip };
}
