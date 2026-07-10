// Feature: campus-social-loops, Task 11.2: Integration test for battle response generation
/**
 * Feature: campus-social-loops, Task 11.2 — Integration test for battle
 * response generation.
 *
 * Validates: Requirement 1.3
 *
 * WHEN an Agent_Battle is created, THE Battle_Service SHALL prompt each
 * Battle_Participant through the Voice_Runtime to produce a voice response for
 * the selected Battle_Format within 30 seconds, grounded in that Campus_Agent's
 * configured personality and Knowledge_Store (Req 1.3).
 *
 * The Voice_Runtime is mocked: the `createBattle` action injects a `generate`
 * function into the pure, testable {@link generateBattleResponses} seam. Here we
 * drive that same seam with a mock Realtime so the "each participant is
 * prompted, grounded, within 30 s" behavior is exercised exactly as production
 * runs it — this repo tests such orchestration through injectable seams rather
 * than a Convex runtime. The grounded prompt is assembled by the same pure
 * {@link buildBattlePrompt} the action uses.
 */
import { describe, it, expect } from "vitest";
import {
  generateBattleResponses,
  buildBattlePrompt,
  BATTLE_RESPONSE_TIMEOUT_MS,
  type BattlePromptRequest,
  type BattleParticipantResponse,
  type GenerateBattleResponse,
} from "../../../../convex/campus/social/battles";

/** Two Battle_Participants with distinct personalities + Knowledge_Store. */
const REQUESTS: BattlePromptRequest[] = [
  {
    agentId: "AGENT_alpha",
    ownerId: "OWNER_a",
    agentName: "Alpha",
    voiceId: "campus_voice_alloy",
    personalityTone: "witty and sharp",
    format: "roast_battle",
    knowledge: [
      { sourceId: "S1", content: "Alpha knows the dining hall hours." },
      { sourceId: "S2", content: "Alpha tracks the shuttle schedule." },
    ],
  },
  {
    agentId: "AGENT_beta",
    ownerId: "OWNER_b",
    agentName: "Beta",
    voiceId: "campus_voice_verse",
    personalityTone: "calm and encouraging",
    format: "roast_battle",
    knowledge: [{ sourceId: "S3", content: "Beta knows the library floor map." }],
  },
];

describe("Task 11.2: each participant is prompted through the Voice_Runtime, grounded, within 30s (Req 1.3)", () => {
  it("prompts every participant exactly once, grounded in personality + Knowledge_Store", async () => {
    const seen: BattlePromptRequest[] = [];

    // Mock Realtime: records the request it was prompted with and returns a
    // response correlated to the participant.
    const generate: GenerateBattleResponse = async (request) => {
      seen.push(request);
      const prompt = buildBattlePrompt({
        format: request.format,
        agentName: request.agentName,
        personalityTone: request.personalityTone,
        knowledge: request.knowledge,
      });
      return {
        agentId: request.agentId,
        responseCallId: `call_${request.agentId}`,
        transcript: prompt,
      };
    };

    const outcome = await generateBattleResponses(REQUESTS, generate);

    // Each Battle_Participant was prompted through the Voice_Runtime exactly once.
    expect(seen).toHaveLength(REQUESTS.length);
    expect(seen.map((r) => r.agentId).sort()).toEqual(
      ["AGENT_alpha", "AGENT_beta"]
    );

    // The battle can open: every participant produced a response (Req 1.3).
    expect(outcome.status).toBe("open");
    if (outcome.status !== "open") return;
    expect(outcome.responses).toHaveLength(REQUESTS.length);
    for (const request of REQUESTS) {
      const response = outcome.responses.find((r) => r.agentId === request.agentId);
      expect(response).toBeDefined();
      const grounded = (response as BattleParticipantResponse).transcript;

      // Grounded in the agent's configured personality/tone (Req 1.3).
      expect(grounded).toContain(request.personalityTone);
      // Grounded in the agent's Knowledge_Store content (Req 1.3).
      for (const entry of request.knowledge) {
        expect(grounded).toContain(entry.content);
      }
      // Scoped to the selected Battle_Format (Req 1.3).
      expect(grounded).toContain("roast battle");
    }
  });

  it("opens only when both responses arrive within the 30-second budget (Req 1.3)", async () => {
    // A generator that resolves well inside the budget yields an open battle.
    const fast: GenerateBattleResponse = async (request) => ({
      agentId: request.agentId,
      responseCallId: `call_${request.agentId}`,
      transcript: "ok",
    });
    const openOutcome = await generateBattleResponses(REQUESTS, fast);
    expect(openOutcome.status).toBe("open");

    // A generator that exceeds the response budget causes the start to fail —
    // the battle is NOT opened for voting. A small budget stands in for the
    // 30-second deadline so the timeout path is exercised deterministically.
    const slow: GenerateBattleResponse = (request) =>
      new Promise((resolve) => {
        setTimeout(
          () =>
            resolve({
              agentId: request.agentId,
              responseCallId: `call_${request.agentId}`,
              transcript: "late",
            }),
          80
        );
      });
    const timedOut = await generateBattleResponses(REQUESTS, slow, 20);
    expect(timedOut.status).toBe("start_failed");

    // The production budget is the 30-second deadline from Req 1.3.
    expect(BATTLE_RESPONSE_TIMEOUT_MS).toBe(30_000);
  });
});
