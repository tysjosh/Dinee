// Feature: campus-social-loops, Property 14: A produced Share_Clip is 10–20 seconds, captioned, formatted, labeled, and attributed
/**
 * Feature: campus-social-loops, Property 14: A produced Share_Clip is 10–20
 * seconds, captioned, formatted, labeled, and attributed
 *
 * Validates: Requirements 3.2, 8.2
 *
 * A produced Share_Clip SHALL be an excerpt between 10 and 20 seconds in
 * duration, carry captions, be formatted for TikTok, Instagram Reels, and
 * Snapchat, carry the visible "AI voice agent" label, and be attributed to the
 * source Campus_Agent (Req 3.2, 8.2).
 *
 * Two pure behaviours back this property:
 *   - {@link clampClipDuration} guarantees the produced-clip duration always
 *     lands in `[10, 20]` for ANY requested duration (including out-of-range,
 *     negative, and non-finite requests); and
 *   - a produced clip that clears the consent + fail-closed screening gates
 *     ({@link decideClipAvailability} ⇒ `available`) preserves the captioned,
 *     tri-format, "AI voice agent"-labeled, agent-attributed shape.
 *
 * The Safety_Service screening decision is reused verbatim: the shared
 * arbitraries emit a {@link ScreeningOutcome}, which is mapped to the
 * {@link ScreeningDecision} the clip logic consumes via {@link decideScreening}.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  clampClipDuration,
  decideClipAvailability,
  SHARE_CLIP_MIN_SEC,
  SHARE_CLIP_MAX_SEC,
  type ProducedShareClip,
} from "../../../../convex/campus/social/logic/clips";
import { decideScreening } from "../../../../convex/campus/logic/screening";
import { AI_VOICE_AGENT_LABEL } from "../../../../convex/campus/logic/share";
import {
  clipRequestedDurationSecArb,
  agentIdArb,
  cleanScreeningOutcomeArb,
} from "./arbitraries";

/** The three social formats a produced Share_Clip is prepared for (Req 3.2). */
const EXPECTED_FORMATS = ["tiktok", "reels", "snap"] as const;

describe("Property 14: A produced Share_Clip is 10–20 seconds, captioned, formatted, labeled, and attributed", () => {
  it("clamps any requested duration into the 10–20 s produced-clip bounds (Req 3.2)", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          clipRequestedDurationSecArb,
          fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY)
        ),
        (requestedSec) => {
          const clamped = clampClipDuration(requestedSec);
          expect(clamped).toBeGreaterThanOrEqual(SHARE_CLIP_MIN_SEC);
          expect(clamped).toBeLessThanOrEqual(SHARE_CLIP_MAX_SEC);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("surfaces a produced clip that is 10–20 s, captioned, tri-formatted, labeled, and attributed (Req 3.2, 8.2)", () => {
    fc.assert(
      fc.property(
        clipRequestedDurationSecArb,
        agentIdArb,
        cleanScreeningOutcomeArb,
        (requestedSec, agentId, cleanOutcome) => {
          // Build the produced clip on top of the reused Call_Clip pipeline:
          // duration is clamped into range, captions on, tri-format, labeled,
          // attributed to the Campus_Agent.
          const clip: ProducedShareClip = {
            durationSec: clampClipDuration(requestedSec),
            captions: true,
            formats: [...EXPECTED_FORMATS],
            label: AI_VOICE_AGENT_LABEL,
            agentId,
          };

          const availability = decideClipAvailability({
            sharingConsent: true,
            screening: decideScreening(cleanOutcome),
            clip,
          });

          // A consented + cleanly-screened clip is the sole delivered path.
          expect(availability.status).toBe("available");
          if (availability.status === "available") {
            const produced = availability.clip;
            // 10–20 seconds (Req 3.2).
            expect(produced.durationSec).toBeGreaterThanOrEqual(SHARE_CLIP_MIN_SEC);
            expect(produced.durationSec).toBeLessThanOrEqual(SHARE_CLIP_MAX_SEC);
            // Captioned (Req 3.2).
            expect(produced.captions).toBe(true);
            // Formatted for TikTok, Reels, and Snap (Req 3.2, 8.2).
            expect([...produced.formats].sort()).toEqual([...EXPECTED_FORMATS].sort());
            // Carries the visible "AI voice agent" label (Req 3.2, 8.2).
            expect(produced.label).toBe(AI_VOICE_AGENT_LABEL);
            // Attributed to the source Campus_Agent (Req 3.2, 8.2).
            expect(produced.agentId).toBe(agentId);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
