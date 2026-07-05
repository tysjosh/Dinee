// Feature: dinee-voice-platform, Property 3: Tool phase references must be defined phases
//
// Validates: Requirements 2.6
//
// When a VoiceDomainPack defines a tool that permits a call phase not present
// in the pack's call-phase definitions, the VoiceDomainPack_Registry rejects
// the registration with an `invalid_tool_phase` error whose detail names the
// offending (undefined) phase, and leaves the set of registered packs
// unchanged. When every tool references only defined phases (and the pack is
// otherwise valid), registration succeeds.
import { describe, it, expect, beforeEach } from "vitest";
import * as fc from "fast-check";
import type {
  CallPhaseDefinition,
  VoiceDomainPack,
  VoiceToolDefinition,
  JSONSchema,
} from "../../src/lib/modules/voiceDomainPack";
import {
  registerVoiceDomainPack,
  resolvePackByConversationType,
  clearRegistry,
} from "../../src/lib/modules/voiceDomainPackRegistry";

// Two disjoint pools: phases drawn from VALID_PHASE_POOL may be *defined* on the
// pack; ids in INVALID_PHASE_POOL are never defined, so any tool referencing one
// is guaranteed to be referencing an undefined phase.
const VALID_PHASE_POOL = [
  "phase_alpha",
  "phase_beta",
  "phase_gamma",
  "phase_delta",
  "phase_epsilon",
];
const INVALID_PHASE_POOL = ["undef_one", "undef_two", "undef_three", "undef_four"];

const CONVERSATION_TYPE = "ct_main";
const EMPTY_PARAMS: JSONSchema = { type: "object" };

function makeTool(name: string, allowedPhases: string[]): VoiceToolDefinition {
  return {
    name,
    description: "a tool",
    parameters: EMPTY_PARAMS,
    allowedPhases,
    readOnly: true,
    handler: "handler_key",
  };
}

interface Scenario {
  definedPhases: string[];
  initialPhase: string;
  tools: Array<{ name: string; allowedPhases: string[] }>;
}

const scenarioArb: fc.Arbitrary<Scenario> = fc
  .uniqueArray(fc.constantFrom(...VALID_PHASE_POOL), {
    minLength: 1,
    maxLength: VALID_PHASE_POOL.length,
  })
  .chain((definedPhases) => {
    // Tools may reference any defined phase or any (always-undefined) invalid phase.
    const toolPhasePool = [...definedPhases, ...INVALID_PHASE_POOL];
    return fc.record({
      definedPhases: fc.constant(definedPhases),
      initialPhase: fc.constantFrom(...definedPhases),
      tools: fc.array(
        fc.record({
          name: fc.string({ minLength: 1, maxLength: 12 }),
          allowedPhases: fc.array(fc.constantFrom(...toolPhasePool), {
            minLength: 0,
            maxLength: 5,
          }),
        }),
        { minLength: 0, maxLength: 6 }
      ),
    });
  });

function buildPack(scenario: Scenario): VoiceDomainPack {
  const phases: CallPhaseDefinition[] = scenario.definedPhases.map((id) => ({
    id,
    transitions: [],
  }));
  const tools = scenario.tools.map((tool, index) =>
    makeTool(tool.name || `tool_${index}`, tool.allowedPhases)
  );
  return {
    id: "phase_test_pack",
    name: "Phase Test Pack",
    description: "",
    conversationTypes: [
      {
        type: CONVERSATION_TYPE,
        initialPhase: scenario.initialPhase,
        transcriptMetadata: { fields: {} },
        fallbackBehavior: { kind: "apologize_and_end" },
      },
    ],
    tools,
    phases,
    defaultPrompt: "prompt",
    escalationRules: [],
    integrations: [],
  };
}

describe("Property 3: Tool phase references must be defined phases", () => {
  beforeEach(() => {
    clearRegistry();
  });

  it("rejects tools that reference undefined phases naming the offending phase, leaving the registry unchanged", () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        clearRegistry();

        const definedSet = new Set(scenario.definedPhases);
        const offendingPhases: string[] = [];
        for (const tool of scenario.tools) {
          for (const phase of tool.allowedPhases) {
            if (!definedSet.has(phase)) {
              offendingPhases.push(phase);
            }
          }
        }
        const hasInvalidPhase = offendingPhases.length > 0;

        const pack = buildPack(scenario);
        const result = registerVoiceDomainPack(pack);

        if (hasInvalidPhase) {
          expect(result.ok).toBe(false);
          if (!result.ok) {
            // Rejects with invalid_tool_phase (Req 2.6).
            expect(result.error.code).toBe("invalid_tool_phase");
            // Detail names an undefined phase — one of the offending references.
            expect(definedSet.has(result.error.detail)).toBe(false);
            expect(offendingPhases).toContain(result.error.detail);
          }
          // Registry left unchanged: the pack was never inserted.
          expect(resolvePackByConversationType(CONVERSATION_TYPE)).toBeNull();
        } else {
          // Every tool references only defined phases → registration succeeds.
          expect(result.ok).toBe(true);
          expect(resolvePackByConversationType(CONVERSATION_TYPE)).not.toBeNull();
        }
      }),
      { numRuns: 100 }
    );
  });
});
