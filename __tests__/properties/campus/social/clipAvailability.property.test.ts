// Feature: campus-social-loops, Property 15: Share_Clip availability is consent-gated then fail-closed screened
/**
 * Feature: campus-social-loops, Property 15: Share_Clip availability is
 * consent-gated then fail-closed screened
 *
 * Validates: Requirements 3.4, 3.5, 3.6, 3.7, 3.8, 3.10, 3.11, 7.8, 7.9
 *
 * A produced Share_Clip is made available for sharing if and only if
 * Sharing_Consent was granted AND the Safety_Service screening completed
 * cleanly (Req 3.4, 3.6, 3.8). The gate is consent-first, then fail-closed:
 *   - no Sharing_Consent ⇒ `withheld_consent`, source recording retained
 *     unchanged (Req 3.5, and the discard path Req 3.11);
 *   - consent granted but the screening dependency is unavailable ⇒
 *     `withheld_screening_error` ("screening could not complete", Req 3.7);
 *   - consent granted but screening reports a policy violation ⇒
 *     `withheld_policy`, withheld from all share formats, source retained
 *     unchanged (Req 3.10);
 *   - consent granted + clean screen ⇒ `available` (Req 3.4, 3.6, 3.8).
 * In every withheld case no clip is delivered (the source recording is retained
 * unchanged — Req 3.5, 3.10, 3.7, 3.11).
 *
 * The pure decision under test is {@link decideClipAvailability}. The reused
 * fail-closed screening semantics are honored verbatim: the shared arbitraries
 * emit a {@link ScreeningOutcome} (clean / violation / dependency-unavailable),
 * which is mapped to the {@link ScreeningDecision} the clip logic consumes via
 * {@link decideScreening} (Req 7.8, 7.9).
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  decideClipAvailability,
  type ProducedShareClip,
} from "../../../../convex/campus/social/logic/clips";
import { decideScreening } from "../../../../convex/campus/logic/screening";
import {
  clipAvailabilityInputArb,
  cleanScreeningOutcomeArb,
  violatingScreeningOutcomeArb,
  unavailableScreeningOutcomeArb,
  producedShareClipArb,
} from "./arbitraries";

describe("Property 15: Share_Clip availability is consent-gated then fail-closed screened", () => {
  it("makes a clip available iff Sharing_Consent is granted AND screening completed cleanly (Req 3.4, 3.6, 3.8)", () => {
    fc.assert(
      fc.property(clipAvailabilityInputArb, (input) => {
        const screening = decideScreening(input.screening);
        const availability = decideClipAvailability({
          sharingConsent: input.sharingConsent,
          screening,
          clip: input.clip as ProducedShareClip,
        });

        const screenedClean = !screening.withheld && screening.error === undefined;
        const shouldBeAvailable = input.sharingConsent && screenedClean;

        expect(availability.status === "available").toBe(shouldBeAvailable);
        // A withheld decision never carries a delivered clip: the source
        // recording is retained unchanged (Req 3.5, 3.7, 3.10, 3.11).
        if (availability.status !== "available") {
          expect("clip" in availability).toBe(false);
        } else {
          // The available path preserves the produced clip verbatim (Req 3.8).
          expect(availability.clip).toEqual(input.clip);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("withholds on missing Sharing_Consent regardless of screening outcome (Req 3.5, 3.11)", () => {
    fc.assert(
      fc.property(clipAvailabilityInputArb, (input) => {
        const availability = decideClipAvailability({
          sharingConsent: false,
          screening: decideScreening(input.screening),
          clip: input.clip as ProducedShareClip,
        });
        expect(availability.status).toBe("withheld_consent");
      }),
      { numRuns: 100 }
    );
  });

  it("withholds with a screening error when consent is granted but the dependency is unavailable (Req 3.7, 7.9)", () => {
    fc.assert(
      fc.property(producedShareClipArb, unavailableScreeningOutcomeArb, (clip, outcome) => {
        const availability = decideClipAvailability({
          sharingConsent: true,
          screening: decideScreening(outcome),
          clip: clip as ProducedShareClip,
        });
        expect(availability.status).toBe("withheld_screening_error");
      }),
      { numRuns: 100 }
    );
  });

  it("withholds on a policy violation when consent is granted (Req 3.10, 7.8)", () => {
    fc.assert(
      fc.property(producedShareClipArb, violatingScreeningOutcomeArb, (clip, outcome) => {
        const availability = decideClipAvailability({
          sharingConsent: true,
          screening: decideScreening(outcome),
          clip: clip as ProducedShareClip,
        });
        expect(availability.status).toBe("withheld_policy");
      }),
      { numRuns: 100 }
    );
  });

  it("makes the clip available when consent is granted and screening is clean (Req 3.4, 3.6, 3.8)", () => {
    fc.assert(
      fc.property(producedShareClipArb, cleanScreeningOutcomeArb, (clip, outcome) => {
        const availability = decideClipAvailability({
          sharingConsent: true,
          screening: decideScreening(outcome),
          clip: clip as ProducedShareClip,
        });
        expect(availability.status).toBe("available");
        if (availability.status === "available") {
          expect(availability.clip).toEqual(clip);
        }
      }),
      { numRuns: 100 }
    );
  });
});
