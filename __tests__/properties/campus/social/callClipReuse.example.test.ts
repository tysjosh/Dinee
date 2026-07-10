// Feature: campus-social-loops, Task 13.2: Example wiring test for Call_Clip reuse
/**
 * Feature: campus-social-loops, Task 13.2 — Example wiring test for Call_Clip reuse.
 *
 * Validates: Requirement 8.2
 *
 * The Clip_Studio does NOT introduce a parallel clip pipeline: a Share_Clip is
 * produced THROUGH the existing Call_Clip pipeline (`decideCallClip`,
 * `AI_VOICE_AGENT_LABEL`, attribution) and therefore inherits the platform's
 * recording+consent gate and its visible "AI voice agent" label + Campus_Agent
 * attribution (Req 8.2).
 *
 * These are example (not property) assertions over the pure `buildShareClip`
 * bridge exported by the `convex/campus/social/clips.ts` service — the same
 * function the `generateShareClip` action uses at runtime — so the wiring the
 * test asserts is the wiring enforced in production.
 */
import { describe, it, expect } from "vitest";
import {
  buildShareClip,
  SHARE_CLIP_FORMATS,
} from "../../../../convex/campus/social/clips";
import {
  decideCallClip,
  AI_VOICE_AGENT_LABEL,
  CLIP_UNAVAILABLE_MESSAGE,
  type CallClipRequest,
} from "../../../../convex/campus/logic/share";

/** A recorded, consented source call for a specific Campus_Agent. */
const recordedRequest: CallClipRequest = {
  callId: "CALL_recorded_123",
  agentId: "AGENT_studybuddy",
  agentName: "Study Buddy",
  recordingEnabled: true,
  callerAcknowledgedRecording: true,
};

describe("Task 13.2: Share_Clip is produced through the existing Call_Clip pipeline (Req 8.2)", () => {
  it("produces a Share_Clip through decideCallClip, carrying the 'AI voice agent' label + agent attribution", () => {
    const built = buildShareClip({
      callClipRequest: recordedRequest,
      requestedDurationSec: 15,
    });

    expect(built.produced).toBe(true);
    if (!built.produced) return;

    // The Share_Clip carries the platform "AI voice agent" label (Req 8.2)...
    expect(built.clip.label).toBe(AI_VOICE_AGENT_LABEL);
    // ...and attribution to the source Campus_Agent (Req 8.2).
    expect(built.clip.agentId).toBe(recordedRequest.agentId);

    // The label and attribution are exactly those the reused Call_Clip pipeline
    // stamps — proving the Share_Clip flows THROUGH decideCallClip, not a
    // parallel pipeline.
    const callClip = decideCallClip(recordedRequest);
    expect(callClip.produced).toBe(true);
    if (callClip.produced) {
      expect(built.clip.label).toBe(callClip.clip.label);
      expect(built.clip.agentId).toBe(callClip.clip.attribution.agentId);
    }
  });

  it("produces a captioned 10–20s clip formatted for TikTok/Reels/Snap (Req 3.2, 8.2)", () => {
    const built = buildShareClip({
      callClipRequest: recordedRequest,
      requestedDurationSec: 15,
    });
    expect(built.produced).toBe(true);
    if (!built.produced) return;

    expect(built.clip.captions).toBe(true);
    expect(built.clip.durationSec).toBeGreaterThanOrEqual(10);
    expect(built.clip.durationSec).toBeLessThanOrEqual(20);
    expect([...built.clip.formats].sort()).toEqual(
      [...SHARE_CLIP_FORMATS].sort()
    );
    expect([...built.clip.formats].sort()).toEqual(["reels", "snap", "tiktok"]);
  });

  it("declines through the same pipeline with the recorded-calls-only indication when the source was not recorded (Req 3.3)", () => {
    const built = buildShareClip({
      callClipRequest: {
        ...recordedRequest,
        recordingEnabled: false,
        callerAcknowledgedRecording: false,
      },
      requestedDurationSec: 15,
    });

    expect(built.produced).toBe(false);
    if (built.produced) return;
    expect(built.reason).toBe("clip_unavailable");
    // The decline message is the reused Call_Clip pipeline's own indication.
    expect(built.message).toBe(CLIP_UNAVAILABLE_MESSAGE);
  });
});
