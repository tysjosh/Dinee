// Feature: campus-social-loops, Task 14.3: Example test for asynchronous delivery
/**
 * Feature: campus-social-loops, Task 14.3 — Example test for asynchronous
 * Group_Response delivery.
 *
 * Validates: Requirement 4.4
 *
 * Req 4.4: THE GroupChat_Service SHALL deliver each Group_Response
 * asynchronously so that a Participant can submit a Group_Question without
 * another Participant being present.
 *
 * The GroupChat_Service produces a Group_Response purely from the asking
 * Participant's Group_Question and the session's Campus_Agent configuration —
 * it never waits on, or depends on, any OTHER Participant. This repo tests such
 * orchestration through the injectable {@link produceGroupResponse} seam (the
 * same seam `submitQuestion` drives in production), so this example verifies
 * that a lone Participant's question yields a Group_Response with no other
 * Participant present.
 */
import { describe, it, expect } from "vitest";
import {
  buildGroupPrompt,
  produceGroupResponse,
  type GroupResponsePromptRequest,
  type GenerateGroupResponse,
} from "../../../../convex/campus/social/groupchat";
import {
  admitParticipant,
  GROUP_RESPONSE_MAX_SEC,
} from "../../../../convex/campus/social/logic/groupchat";

/** The session's Campus_Agent. */
const REQUEST: GroupResponsePromptRequest = {
  agentId: "AGENT_solo",
  agentName: "Study Buddy",
  purpose: "quiz you before exams",
  voiceId: "campus_voice_verse",
  knowledge: [{ sourceId: "S1", content: "Chapter 3 covers thermodynamics." }],
  questionBody: "What does chapter 3 cover?",
};

/** A Voice_Runtime that answers the lone Participant's question. */
const generate: GenerateGroupResponse = async (request) => ({
  kind: "voice_note",
  responseCallId: `call_${request.agentId}`,
  transcript: buildGroupPrompt({
    agentName: request.agentName,
    purpose: request.purpose,
    knowledge: request.knowledge,
    questionBody: request.questionBody,
  }),
  durationSec: 20,
});

describe("Task 14.3: a Participant receives a Group_Response with no other Participant present (Req 4.4)", () => {
  it("the first and only Participant is admitted", () => {
    // A single Participant joins an empty session — no one else is present.
    const admission = admitParticipant({ currentCount: 0, alreadyMember: false });
    expect(admission.admitted).toBe(true);
  });

  it("that lone Participant's Group_Question yields a Group_Response", async () => {
    // With exactly one Participant present (the asker), submitting a question
    // still produces a Group_Response — delivery does not wait on any other
    // Participant (Req 4.4).
    const response = await produceGroupResponse(REQUEST, generate);

    expect(response.kind).toBe("voice_note");
    if (response.kind !== "voice_note") return;
    expect(response.responseCallId).toBe("call_AGENT_solo");
    expect(response.durationSec).toBeLessThanOrEqual(GROUP_RESPONSE_MAX_SEC);
    // The response answers the asker's own question, grounded in the agent.
    expect(response.transcript).toContain("Study Buddy");
    expect(response.transcript).toContain(REQUEST.questionBody);
  });

  it("the Group_Response does not depend on any other Participant being present", async () => {
    // The generator is a pure function of the asking Participant's request; no
    // other Participant identity or presence is an input to producing the
    // Group_Response. Producing twice with the same lone-Participant request is
    // deterministic and requires no second Participant.
    const first = await produceGroupResponse(REQUEST, generate);
    const second = await produceGroupResponse(REQUEST, generate);
    expect(first).toEqual(second);
  });
});
