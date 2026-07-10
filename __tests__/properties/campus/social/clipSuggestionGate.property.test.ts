// Feature: campus-social-loops, Property 13: A Clip_Suggestion is offered exactly when the call was recorded with consent and its duration is at least 20 seconds
/**
 * Feature: campus-social-loops, Property 13: A Clip_Suggestion is offered
 * exactly when the call was recorded with consent and its duration is at least
 * 20 seconds
 *
 * Validates: Requirements 3.1, 3.3, 3.9
 *
 * For any completed call, `decideClipSuggestion` SHALL offer a Clip_Suggestion
 * if and only if Recording_Consent was granted AND the recorded source duration
 * is at least {@link SHARE_CLIP_MIN_SOURCE_SEC} (20 s) — Req 3.1. When
 * Recording_Consent was not granted, no suggestion is offered and the
 * "recorded calls only" path (`no_recording_consent`) applies (Req 3.3). When
 * Recording_Consent was granted but the source is shorter than the minimum, no
 * suggestion is offered (`source_too_short`, Req 3.9).
 *
 * The pure decision under test is {@link decideClipSuggestion}, exercised with
 * the shared {@link clipSuggestionInputArb} generator (recording consent ×
 * source durations clustered around the 20 s boundary).
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  decideClipSuggestion,
  SHARE_CLIP_MIN_SOURCE_SEC,
} from "../../../../convex/campus/social/logic/clips";
import { clipSuggestionInputArb } from "./arbitraries";

describe("Property 13: A Clip_Suggestion is offered exactly when the call was recorded with consent and its duration is at least 20 seconds", () => {
  it("offers a suggestion iff Recording_Consent was granted AND the source is ≥ 20 s (Req 3.1, 3.3, 3.9)", () => {
    fc.assert(
      fc.property(clipSuggestionInputArb, (input) => {
        const decision = decideClipSuggestion(input);
        const shouldSuggest =
          input.recordingConsent &&
          input.sourceDurationSec >= SHARE_CLIP_MIN_SOURCE_SEC;
        expect(decision.suggest).toBe(shouldSuggest);
      }),
      { numRuns: 100 }
    );
  });

  it("uses the recorded-calls-only path when Recording_Consent is absent, regardless of duration (Req 3.3)", () => {
    fc.assert(
      fc.property(
        clipSuggestionInputArb.filter((i) => !i.recordingConsent),
        (input) => {
          const decision = decideClipSuggestion(input);
          expect(decision.suggest).toBe(false);
          if (!decision.suggest) {
            expect(decision.reason).toBe("no_recording_consent");
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("declines a consented-but-too-short source with source_too_short (Req 3.9)", () => {
    fc.assert(
      fc.property(
        clipSuggestionInputArb.filter(
          (i) => i.recordingConsent && i.sourceDurationSec < SHARE_CLIP_MIN_SOURCE_SEC
        ),
        (input) => {
          const decision = decideClipSuggestion(input);
          expect(decision.suggest).toBe(false);
          if (!decision.suggest) {
            expect(decision.reason).toBe("source_too_short");
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
