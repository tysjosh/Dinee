/**
 * Feature: dinee-voice-platform — unit tests for the pack-driven session config builder.
 *
 * Validates: Requirements 3.3, 3.4
 *
 * The builder loads the tool definitions and system prompt from the resolved
 * VoiceDomainPack and shapes them into the OpenAI `session.update` payload that
 * the runtime applies before the agent's first spoken response.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildSessionConfig } from "../../src/app/ws-server/runtime/sessionConfig";
import {
  clearRegistry,
  registerVoiceDomainPack,
} from "../../src/lib/modules/voiceDomainPackRegistry";
import type { VoiceDomainPack } from "../../src/lib/modules/voiceDomainPack";

function makePack(): VoiceDomainPack {
  return {
    id: "test_pack",
    name: "Test Product",
    description: "A test voice domain pack.",
    defaultPrompt: "Default system prompt.",
    conversationTypes: [
      {
        type: "override_convo",
        prompt: "Overridden prompt.",
        initialPhase: "start",
        transcriptMetadata: { fields: {} },
        fallbackBehavior: { kind: "escalate" },
      },
      {
        type: "default_convo",
        initialPhase: "start",
        transcriptMetadata: { fields: {} },
        fallbackBehavior: { kind: "escalate" },
      },
    ],
    phases: [{ id: "start", transitions: [] }],
    tools: [
      {
        name: "free_tool",
        description: "Needs no integration.",
        parameters: { type: "object", properties: {} },
        allowedPhases: ["start"],
        readOnly: true,
        handler: "freeHandler",
      },
      {
        name: "gated_tool",
        description: "Requires the test integration.",
        parameters: { type: "object", properties: {} },
        allowedPhases: ["start"],
        requiresIntegration: "test_integration",
        readOnly: true,
        handler: "gatedHandler",
      },
    ],
    escalationRules: [],
    integrations: [{ id: "test_integration", required: false }],
  };
}

describe("buildSessionConfig", () => {
  beforeEach(() => {
    clearRegistry();
    const result = registerVoiceDomainPack(makePack());
    expect(result.ok).toBe(true);
  });

  afterEach(() => {
    clearRegistry();
  });

  it("uses the conversation prompt override when present", () => {
    const payload = buildSessionConfig(makePack(), "override_convo", []);
    expect(payload.type).toBe("session.update");
    expect(payload.session.instructions).toBe("Overridden prompt.");
  });

  it("falls back to the pack default prompt when the conversation has none", () => {
    const payload = buildSessionConfig(makePack(), "default_convo", []);
    expect(payload.session.instructions).toBe("Default system prompt.");
  });

  it("excludes integration-gated tools when the integration is disabled", () => {
    const payload = buildSessionConfig(makePack(), "default_convo", []);
    const names = payload.session.tools.map((tool) => tool.name);
    expect(names).toEqual(["free_tool"]);
  });

  it("includes integration-gated tools when the integration is enabled", () => {
    const payload = buildSessionConfig(makePack(), "default_convo", [
      "test_integration",
    ]);
    const names = payload.session.tools.map((tool) => tool.name);
    expect(names).toEqual(["free_tool", "gated_tool"]);
  });

  it("shapes tools into the OpenAI function-tool form", () => {
    const payload = buildSessionConfig(makePack(), "default_convo", []);
    expect(payload.session.tools[0]).toEqual({
      type: "function",
      name: "free_tool",
      description: "Needs no integration.",
      parameters: { type: "object", properties: {} },
    });
  });

  it("includes the transcription hint derived from the pack name by default", () => {
    const payload = buildSessionConfig(makePack(), "default_convo", []);
    expect(payload.session.input_audio_transcription).toEqual({
      model: "gpt-4o-mini-transcribe",
      prompt: "Expect words related to Test Product.",
      language: "en",
    });
  });

  it("throws when the conversation type is not owned by the pack", () => {
    expect(() =>
      buildSessionConfig(makePack(), "unknown_convo", [])
    ).toThrow();
  });
});
