// Feature: dinee-campus, browser voice transport: realtime session config + capability gate
/**
 * Feature: dinee-campus — browser voice transport (WebRTC).
 *
 * Validates the pure realtime-config logic that backs the token route
 * (`/campus/api/realtime-token`) and the `getCallRealtimeConfig` capability
 * gate:
 *   - the Campus_Agent → OpenAI voice mapping always yields a supported voice
 *     and preserves the known mappings (Req 8.3);
 *   - the ephemeral-session config carries the requested model, the agent's
 *     system prompt as the instructions, and the mapped voice (Req 8.3, 8.4);
 *   - a realtime session is configurable only for an active campus call, so a
 *     guessed/expired/non-campus call id yields no config (Req 8.1).
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  buildRealtimeSessionConfig,
  mapCampusVoiceToOpenAI,
  isCallRealtimeEligible,
  CAMPUS_VOICE_TO_OPENAI,
  OPENAI_REALTIME_VOICES,
  DEFAULT_REALTIME_VOICE,
} from "../../../convex/campus/logic/realtime";

const KNOWN_CAMPUS_VOICES = Object.keys(CAMPUS_VOICE_TO_OPENAI);
const OPENAI_VOICE_SET = new Set<string>(OPENAI_REALTIME_VOICES);

describe("Realtime voice mapping is total and supported", () => {
  it("maps every known campus voice to its declared OpenAI voice", () => {
    for (const [campusVoice, openAiVoice] of Object.entries(
      CAMPUS_VOICE_TO_OPENAI
    )) {
      expect(mapCampusVoiceToOpenAI(campusVoice)).toBe(openAiVoice);
    }
  });

  it("maps any arbitrary voice id to a supported OpenAI voice (default for unknown)", () => {
    fc.assert(
      fc.property(fc.string(), (voiceId) => {
        const mapped = mapCampusVoiceToOpenAI(voiceId);
        // Always a voice OpenAI actually supports.
        expect(OPENAI_VOICE_SET.has(mapped)).toBe(true);
        // Unknown ids fall back to the neutral default.
        if (!KNOWN_CAMPUS_VOICES.includes(voiceId)) {
          expect(mapped).toBe(DEFAULT_REALTIME_VOICE);
        }
      })
    );
  });
});

describe("Realtime session config reflects the requested model, prompt, and voice", () => {
  it("carries model + instructions verbatim and the mapped voice", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.string(),
        fc.string(),
        (model, voiceId, systemPrompt) => {
          const cfg = buildRealtimeSessionConfig({
            model,
            voiceId,
            systemPrompt,
          });
          expect(cfg.session.type).toBe("realtime");
          expect(cfg.session.model).toBe(model);
          expect(cfg.session.instructions).toBe(systemPrompt);
          expect(cfg.session.audio.output.voice).toBe(
            mapCampusVoiceToOpenAI(voiceId)
          );
          expect(OPENAI_VOICE_SET.has(cfg.session.audio.output.voice)).toBe(true);
        }
      )
    );
  });
});

describe("Realtime capability gate admits only active campus calls", () => {
  const statusArb = fc.constantFrom(
    "active",
    "completed",
    "failed",
    "queued",
    ""
  );

  it("is eligible iff the call is active AND correlated to a campus agent", () => {
    fc.assert(
      fc.property(
        fc.option(
          fc.record({
            status: statusArb,
            campusAgentId: fc.option(fc.string(), { nil: undefined }),
          }),
          { nil: null }
        ),
        (call) => {
          const eligible = isCallRealtimeEligible(call);
          const expected =
            call !== null &&
            call.status === "active" &&
            typeof call.campusAgentId === "string" &&
            call.campusAgentId.length > 0;
          expect(eligible).toBe(expected);
        }
      )
    );
  });

  it("rejects a null/undefined call", () => {
    expect(isCallRealtimeEligible(null)).toBe(false);
    expect(isCallRealtimeEligible(undefined)).toBe(false);
  });

  it("rejects an active call with no campus agent (non-campus call)", () => {
    expect(isCallRealtimeEligible({ status: "active" })).toBe(false);
    expect(
      isCallRealtimeEligible({ status: "active", campusAgentId: "" })
    ).toBe(false);
  });

  it("rejects an ended campus call (already completed)", () => {
    expect(
      isCallRealtimeEligible({ status: "completed", campusAgentId: "agent_1" })
    ).toBe(false);
  });
});
