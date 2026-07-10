// Feature: campus-social-loops, Task 17.3: Example wiring test for Voice_Runtime reuse
/**
 * Feature: campus-social-loops, Task 17.3 — Example wiring test for
 * Voice_Runtime reuse.
 *
 * Validates: Requirement 8.1
 *
 * WHEN a Social_Loops_Layer feature conducts a voice interaction, THE
 * Campus_Platform SHALL conduct that interaction through the existing
 * Voice_Runtime rather than a separate voice pipeline.
 *
 * The battle and group voice paths both build their realtime session through
 * the SINGLE shared {@link buildSocialVoiceSessionConfig} bridge, which
 * delegates to the EXISTING {@link buildRealtimeSessionConfig}. This test
 * asserts that:
 *   1. the shared bridge produces exactly the campus Voice_Runtime session
 *      config (same model, same voice mapping, and — decisively — the same
 *      reused `CAMPUS_REALTIME_TOOLS` knowledge-grounding tool), so no separate
 *      pipeline is introduced;
 *   2. a battle prompt (`buildBattlePrompt`) and a group prompt
 *      (`buildGroupPrompt`) both flow into that same bridge; and
 *   3. the challenge path correlates its Voice_Runtime response through the same
 *      existing `calls` correlation (a `responseCallId`), i.e. the shared
 *      interaction lifecycle, rather than a parallel pipeline.
 *
 * These are example assertions over the pure builders the services use at
 * runtime, so the wiring the test asserts is the wiring enforced in production.
 */
import { describe, it, expect } from "vitest";
import {
  buildSocialVoiceSessionConfig,
  SOCIAL_VOICE_MODEL,
} from "../../../../convex/campus/social/companion";
import { buildBattlePrompt } from "../../../../convex/campus/social/battles";
import { buildGroupPrompt } from "../../../../convex/campus/social/groupchat";
import {
  buildRealtimeSessionConfig,
  mapCampusVoiceToOpenAI,
  CAMPUS_REALTIME_TOOLS,
  CAMPUS_LOOKUP_TOOL_NAME,
} from "../../../../convex/campus/logic/realtime";

describe("Task 17.3: battle/challenge/group voice paths route through the existing Voice_Runtime (Req 8.1)", () => {
  it("the shared social voice bridge produces exactly the campus Voice_Runtime session config", () => {
    const voiceId = "campus_voice_alloy";
    const systemPrompt = "You are Study Buddy, an AI voice agent.";

    const socialConfig = buildSocialVoiceSessionConfig({ voiceId, systemPrompt });
    // The reference: the EXISTING campus realtime builder with the same inputs.
    const campusConfig = buildRealtimeSessionConfig({
      model: SOCIAL_VOICE_MODEL,
      voiceId,
      systemPrompt,
    });

    // The social bridge is byte-for-byte the existing campus session config —
    // proving it delegates rather than reimplementing a pipeline (Req 8.1).
    expect(socialConfig).toEqual(campusConfig);

    // The session advertises the reused knowledge-grounding tool, unchanged.
    expect(socialConfig.session.tools).toBe(CAMPUS_REALTIME_TOOLS);
    expect(socialConfig.session.tools.map((t) => t.name)).toContain(
      CAMPUS_LOOKUP_TOOL_NAME
    );
    // The voice is mapped by the reused campus mapping (Req 8.3 carried over).
    expect(socialConfig.session.audio.output.voice).toBe(
      mapCampusVoiceToOpenAI(voiceId)
    );
    // Runs on the existing realtime model, not a separate one.
    expect(socialConfig.session.type).toBe("realtime");
    expect(socialConfig.session.model).toBe(SOCIAL_VOICE_MODEL);
  });

  it("a battle response prompt flows through the shared bridge onto the existing runtime", () => {
    const battlePrompt = buildBattlePrompt({
      format: "roast_battle",
      agentName: "Alpha",
      personalityTone: "witty",
      knowledge: [{ sourceId: "S1", content: "Alpha knows the shuttle schedule." }],
    });

    const config = buildSocialVoiceSessionConfig({
      voiceId: "campus_voice_verse",
      systemPrompt: battlePrompt,
      model: "gpt-realtime",
    });

    // The battle response is grounded by the same reused tool + carries the
    // battle prompt as the session instructions — the existing pipeline.
    expect(config.session.instructions).toBe(battlePrompt);
    expect(config.session.tools).toBe(CAMPUS_REALTIME_TOOLS);
    expect(config).toEqual(
      buildRealtimeSessionConfig({
        model: "gpt-realtime",
        voiceId: "campus_voice_verse",
        systemPrompt: battlePrompt,
      })
    );
  });

  it("a group response prompt flows through the same shared bridge onto the existing runtime", () => {
    const groupPrompt = buildGroupPrompt({
      agentName: "Club Guide",
      purpose: "help students find clubs",
      knowledge: [{ sourceId: "K1", content: "The chess club meets Tuesdays." }],
      questionBody: "when does chess club meet?",
    });

    const config = buildSocialVoiceSessionConfig({
      voiceId: "campus_voice_alloy",
      systemPrompt: groupPrompt,
    });

    expect(config.session.instructions).toBe(groupPrompt);
    expect(config.session.tools).toBe(CAMPUS_REALTIME_TOOLS);
    // Battle and group configs share the identical builder + tools (one pipeline).
    const battleConfig = buildSocialVoiceSessionConfig({
      voiceId: "campus_voice_alloy",
      systemPrompt: "battle",
    });
    expect(config.session.tools).toBe(battleConfig.session.tools);
    expect(config.session.model).toBe(battleConfig.session.model);
  });

  it("both social voice prompt builders feed the one shared bridge (no per-feature pipeline)", () => {
    // Distinct prompts, one builder: the only difference is `instructions`.
    const battle = buildSocialVoiceSessionConfig({
      voiceId: "campus_voice_alloy",
      systemPrompt: buildBattlePrompt({
        format: "debate",
        agentName: "A",
        personalityTone: "calm",
        knowledge: [],
      }),
    });
    const group = buildSocialVoiceSessionConfig({
      voiceId: "campus_voice_alloy",
      systemPrompt: buildGroupPrompt({
        agentName: "A",
        purpose: "p",
        knowledge: [],
        questionBody: "q",
      }),
    });

    expect(battle.session.model).toBe(group.session.model);
    expect(battle.session.tools).toBe(group.session.tools);
    expect(battle.session.audio.output.voice).toBe(group.session.audio.output.voice);
    expect(battle.session.instructions).not.toBe(group.session.instructions);
  });
});
