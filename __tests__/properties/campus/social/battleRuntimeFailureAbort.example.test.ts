// Feature: campus-social-loops, Task 11.3: Example test for runtime-failure abort
/**
 * Feature: campus-social-loops, Task 11.3 — Example test for runtime-failure
 * abort.
 *
 * Validates: Requirement 1.11
 *
 * IF the Voice_Runtime fails to produce a voice response for a
 * Battle_Participant, THEN THE Battle_Service SHALL not open the Agent_Battle
 * for voting and SHALL present an error indication that the Agent_Battle could
 * not be started (Req 1.11).
 *
 * The `createBattle` action drives the pure {@link generateBattleResponses}
 * seam, then persists `start_failed` (never `open`) whenever that seam reports
 * a failure. These example assertions exercise the seam directly with a mock
 * Realtime that fails, proving the decision the action acts on: a runtime
 * failure yields `start_failed` with an error indication, and the battle is
 * never opened for voting.
 */
import { describe, it, expect } from "vitest";
import {
  generateBattleResponses,
  type BattlePromptRequest,
  type GenerateBattleResponse,
} from "../../../../convex/campus/social/battles";

const REQUESTS: BattlePromptRequest[] = [
  {
    agentId: "AGENT_alpha",
    ownerId: "OWNER_a",
    agentName: "Alpha",
    voiceId: "campus_voice_alloy",
    personalityTone: "witty",
    format: "debate",
    knowledge: [],
  },
  {
    agentId: "AGENT_beta",
    ownerId: "OWNER_b",
    agentName: "Beta",
    voiceId: "campus_voice_verse",
    personalityTone: "calm",
    format: "debate",
    knowledge: [],
  },
];

describe("Task 11.3: a Voice_Runtime failure leaves the battle start_failed and not opened for voting (Req 1.11)", () => {
  it("reports start_failed with an error indication when a participant's response fails", async () => {
    // Mock Realtime: the second participant's response fails.
    const generate: GenerateBattleResponse = async (request) => {
      if (request.agentId === "AGENT_beta") {
        throw new Error("voice_runtime_unavailable");
      }
      return {
        agentId: request.agentId,
        responseCallId: `call_${request.agentId}`,
        transcript: "ok",
      };
    };

    const outcome = await generateBattleResponses(REQUESTS, generate);

    // The battle is NOT opened for voting (Req 1.11).
    expect(outcome.status).toBe("start_failed");
    if (outcome.status !== "start_failed") return;

    // An error indication is present, identifying the failing participant.
    expect(outcome.error).toBe("voice_runtime_unavailable");
    expect(outcome.failedAgentId).toBe("AGENT_beta");
  });

  it("reports start_failed when a response times out rather than opening the battle (Req 1.11)", async () => {
    // Mock Realtime: a participant never responds within the budget.
    const neverResponds: GenerateBattleResponse = (request) =>
      new Promise((resolve) => {
        setTimeout(
          () =>
            resolve({
              agentId: request.agentId,
              responseCallId: `call_${request.agentId}`,
              transcript: "late",
            }),
          100
        );
      });

    const outcome = await generateBattleResponses(REQUESTS, neverResponds, 10);

    expect(outcome.status).toBe("start_failed");
    if (outcome.status !== "start_failed") return;
    expect(outcome.error).toBe("battle_response_timeout");
  });

  it("does not open a battle when the very first participant fails", async () => {
    const failFirst: GenerateBattleResponse = async (request) => {
      if (request.agentId === "AGENT_alpha") {
        throw new Error("runtime_error");
      }
      return {
        agentId: request.agentId,
        responseCallId: `call_${request.agentId}`,
        transcript: "ok",
      };
    };

    const outcome = await generateBattleResponses(REQUESTS, failFirst);
    expect(outcome.status).not.toBe("open");
    expect(outcome.status).toBe("start_failed");
  });
});
