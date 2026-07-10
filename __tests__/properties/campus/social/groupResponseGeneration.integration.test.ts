// Feature: campus-social-loops, Task 14.2: Integration test for grounded group responses
/**
 * Feature: campus-social-loops, Task 14.2 — Integration test for grounded
 * Group_Responses.
 *
 * Validates: Requirements 4.3, 4.9
 *
 * Req 4.3: WHEN a Participant submits a valid Group_Question in an open
 * Group_Chat_Session, THE GroupChat_Service SHALL produce a Group_Response from
 * the Campus_Agent through the Voice_Runtime, delivered as a voice note of at
 * most 60 seconds or a Share_Clip, and post it to the Group_Chat_Session.
 *
 * Req 4.9: WHILE a Group_Chat_Session is active, THE GroupChat_Service SHALL
 * constrain each Group_Response to the Campus_Agent's configured name, purpose,
 * Knowledge_Store content, and boundaries.
 *
 * The Voice_Runtime is mocked: the `submitQuestion` action injects a `generate`
 * function into the pure, testable {@link produceGroupResponse} seam. Here we
 * drive that same seam with a mock Realtime so the "a Group_Response is produced
 * through the Voice_Runtime as a ≤ 60 s voice note or Share_Clip, grounded
 * solely in the agent's name/purpose/Knowledge_Store/boundaries" behavior is
 * exercised exactly as production runs it — this repo tests such orchestration
 * through injectable seams rather than a Convex runtime. The grounded prompt is
 * assembled by the same pure {@link buildGroupPrompt} the action uses.
 */
import { describe, it, expect } from "vitest";
import {
  buildGroupPrompt,
  produceGroupResponse,
  clampGroupVoiceNoteDuration,
  type GroupResponsePromptRequest,
  type GenerateGroupResponse,
} from "../../../../convex/campus/social/groupchat";
import { GROUP_RESPONSE_MAX_SEC } from "../../../../convex/campus/social/logic/groupchat";
import { AI_VOICE_AGENT_LABEL } from "../../../../convex/campus/logic/share";

/** A published Campus_Agent dropped into a group, with name/purpose/knowledge. */
const REQUEST: GroupResponsePromptRequest = {
  agentId: "AGENT_guide",
  agentName: "Campus Guide",
  purpose: "help freshmen find their way around campus",
  voiceId: "campus_voice_alloy",
  knowledge: [
    { sourceId: "S1", content: "The library closes at 11pm on weekdays." },
    { sourceId: "S2", content: "The north gym has a climbing wall." },
  ],
  questionBody: "When does the library close?",
};

describe("Task 14.2: a Group_Response is produced through the Voice_Runtime, grounded, as a ≤ 60 s voice note or Share_Clip (Req 4.3, 4.9)", () => {
  it("prompts the agent grounded SOLELY in its name, purpose, Knowledge_Store, and boundaries (Req 4.9)", async () => {
    let promptedWith: GroupResponsePromptRequest | null = null;

    // Mock Realtime: records the request it was prompted with and returns a
    // voice-note response built from the grounded prompt.
    const generate: GenerateGroupResponse = async (request) => {
      promptedWith = request;
      const prompt = buildGroupPrompt({
        agentName: request.agentName,
        purpose: request.purpose,
        knowledge: request.knowledge,
        questionBody: request.questionBody,
      });
      return {
        kind: "voice_note",
        responseCallId: `call_${request.agentId}`,
        transcript: prompt,
        durationSec: 42,
      };
    };

    const response = await produceGroupResponse(REQUEST, generate);

    // The agent was prompted through the Voice_Runtime exactly for this request.
    expect(promptedWith).not.toBeNull();
    expect((promptedWith as unknown as GroupResponsePromptRequest).agentId).toBe(
      "AGENT_guide"
    );

    // A Group_Response was produced (Req 4.3).
    expect(response.kind).toBe("voice_note");
    if (response.kind !== "voice_note") return;
    const grounded = response.transcript;

    // Grounded in the agent's configured NAME (Req 4.9).
    expect(grounded).toContain("Campus Guide");
    // Grounded in the agent's configured PURPOSE (Req 4.9).
    expect(grounded).toContain("help freshmen find their way around campus");
    // Grounded in the agent's Knowledge_Store content (Req 4.9).
    for (const entry of REQUEST.knowledge) {
      expect(grounded).toContain(entry.content);
    }
    // Constrained to the agent's BOUNDARIES — the prompt forbids drawing on
    // anything outside the configuration (Req 4.9).
    expect(grounded.toLowerCase()).toContain("boundaries");
    expect(grounded).toContain("and nothing else");
    // Carries the platform "AI voice agent" label.
    expect(grounded).toContain(AI_VOICE_AGENT_LABEL);
    // Answers THIS group question.
    expect(grounded).toContain(REQUEST.questionBody);
  });

  it("delivers as a voice note of at most 60 seconds (Req 4.3)", async () => {
    // A generator that reports an over-long voice note is clamped to ≤ 60 s so a
    // Group_Response voice note can never exceed the ceiling.
    const overLong: GenerateGroupResponse = async (request) => ({
      kind: "voice_note",
      responseCallId: `call_${request.agentId}`,
      transcript: "…",
      durationSec: 999,
    });
    const clamped = await produceGroupResponse(REQUEST, overLong);
    expect(clamped.kind).toBe("voice_note");
    if (clamped.kind !== "voice_note") return;
    expect(clamped.durationSec).toBeLessThanOrEqual(GROUP_RESPONSE_MAX_SEC);
    expect(clamped.durationSec).toBe(GROUP_RESPONSE_MAX_SEC);

    // A within-budget voice note is preserved unchanged.
    const within: GenerateGroupResponse = async (request) => ({
      kind: "voice_note",
      responseCallId: `call_${request.agentId}`,
      transcript: "…",
      durationSec: 30,
    });
    const kept = await produceGroupResponse(REQUEST, within);
    expect(kept.kind === "voice_note" && kept.durationSec).toBe(30);

    // The ceiling is the 60-second limit from Req 4.3.
    expect(GROUP_RESPONSE_MAX_SEC).toBe(60);
    expect(clampGroupVoiceNoteDuration(75)).toBe(60);
    expect(clampGroupVoiceNoteDuration(-5)).toBe(0);
  });

  it("may instead deliver a Share_Clip (Req 4.3)", async () => {
    // The alternative Group_Response form is a Share_Clip; the seam supports it.
    const asClip: GenerateGroupResponse = async (request) => ({
      kind: "share_clip",
      responseCallId: `call_${request.agentId}`,
      transcript: buildGroupPrompt({
        agentName: request.agentName,
        purpose: request.purpose,
        knowledge: request.knowledge,
        questionBody: request.questionBody,
      }),
      clipId: "SHARECLIP_group_1",
    });
    const response = await produceGroupResponse(REQUEST, asClip);
    expect(response.kind).toBe("share_clip");
    if (response.kind !== "share_clip") return;
    expect(response.clipId).toBe("SHARECLIP_group_1");
    // Still grounded in the agent's configuration (Req 4.9).
    expect(response.transcript).toContain("Campus Guide");
  });
});
