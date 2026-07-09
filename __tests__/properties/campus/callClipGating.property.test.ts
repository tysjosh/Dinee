// Feature: dinee-campus, Property 39: Call clip generation is gated on recording and consent
/**
 * Feature: dinee-campus, Property 39: Call clip generation is gated on recording and consent
 *
 * Validates: Requirements 15.12, 15.13
 *
 * For any completed call, `decideCallClip` SHALL produce a Call_Clip if and only
 * if the call was recorded AND the Caller acknowledged the recording notice; a
 * produced clip SHALL carry the visible label "AI voice agent" and attribution
 * to the source Campus_Agent (Req 15.12). Any call that was not recorded, or for
 * which the notice was declined, SHALL yield a declined result whose message
 * indicates that clips are available only for recorded calls (Req 15.13).
 *
 * The pure decision under test is {@link decideCallClip}. `produced: true`
 * models "the Share_Service generates a labelled, attributed Call_Clip"; a
 * `produced: false` result with reason `clip_unavailable` and
 * {@link CLIP_UNAVAILABLE_MESSAGE} models the declined indication.
 *
 * The property asserts the biconditional: the clip is produced exactly when
 * both `recordingEnabled` and `callerAcknowledgedRecording` are true, and it
 * checks the shape of each branch (label + attribution on produce; reason +
 * message on decline).
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  decideCallClip,
  CLIP_UNAVAILABLE_MESSAGE,
  AI_VOICE_AGENT_LABEL,
  type CallClipRequest,
} from "../../../convex/campus/logic/share";

/**
 * Arbitrary spanning the full Call_Clip request space: identifiers plus the two
 * independent boolean gates (recording enabled, caller acknowledged notice) so
 * all four combinations of the gate are exercised.
 */
const callClipRequestArb: fc.Arbitrary<CallClipRequest> = fc.record({
  callId: fc.string({ minLength: 1, maxLength: 40 }),
  agentId: fc.string({ minLength: 1, maxLength: 40 }),
  agentName: fc.string({ maxLength: 60 }),
  recordingEnabled: fc.boolean(),
  callerAcknowledgedRecording: fc.boolean(),
});

describe("Property 39: Call clip generation is gated on recording and consent", () => {
  it("produces a clip iff the call was recorded AND the caller acknowledged the notice", () => {
    fc.assert(
      fc.property(callClipRequestArb, (request) => {
        const decision = decideCallClip(request);
        const shouldProduce =
          request.recordingEnabled && request.callerAcknowledgedRecording;
        expect(decision.produced).toBe(shouldProduce);
      }),
      { numRuns: 100 }
    );
  });

  it("labels and attributes a produced clip to the source Campus_Agent (Req 15.12)", () => {
    fc.assert(
      fc.property(callClipRequestArb, (request) => {
        const decision = decideCallClip({
          ...request,
          recordingEnabled: true,
          callerAcknowledgedRecording: true,
        });
        expect(decision.produced).toBe(true);
        if (decision.produced) {
          expect(decision.clip.callId).toBe(request.callId);
          expect(decision.clip.label).toBe(AI_VOICE_AGENT_LABEL);
          expect(decision.clip.attribution.agentId).toBe(request.agentId);
          expect(decision.clip.attribution.agentName).toBe(request.agentName);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("declines with the recorded-calls-only message when either gate is false (Req 15.13)", () => {
    const ungatedArb: fc.Arbitrary<CallClipRequest> = callClipRequestArb.filter(
      (r) => !(r.recordingEnabled && r.callerAcknowledgedRecording)
    );
    fc.assert(
      fc.property(ungatedArb, (request) => {
        const decision = decideCallClip(request);
        expect(decision.produced).toBe(false);
        if (!decision.produced) {
          expect(decision.reason).toBe("clip_unavailable");
          expect(decision.message).toBe(CLIP_UNAVAILABLE_MESSAGE);
        }
      }),
      { numRuns: 100 }
    );
  });
});
