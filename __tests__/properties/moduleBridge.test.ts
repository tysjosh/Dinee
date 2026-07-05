/**
 * Feature: dinee-voice-platform, Task 2.9: Module_Pack_System bridge example tests
 *
 * Validates: Requirements 2.8, 2.9
 *
 * A VoiceDomainPack BRIDGES to the existing Module_Pack_System instead of
 * duplicating it. These example tests pin down the two observable guarantees:
 *
 *   1. Reuse without duplication (Req 2.9): a pack whose `moduleBridge` links an
 *      already-registered tool pack in `reuse` mode is accepted, derives its
 *      exposed tool set from that linked tool pack's membership, and does NOT
 *      create a parallel Module_Pack_System registration.
 *   2. Missing-target rejection (Req 2.8, 2.9): a bridge that names a
 *      `verticalPackId` or a `reuseToolPackId` absent from the Module_Pack_System
 *      is rejected with `unknown_module_bridge` (detail = the missing id) and
 *      leaves the voice registry unchanged.
 */
import { describe, it, expect, beforeEach } from "vitest";
import type {
  VoiceDomainPack,
  VoiceToolDefinition,
} from "../../src/lib/modules/voiceDomainPack";
import type { ToolDefinition } from "../../src/lib/modules/types";
import {
  registerVoiceDomainPack,
  resolvePackByConversationType,
  resolveToolSet,
  clearRegistry as clearVoiceRegistry,
} from "../../src/lib/modules/voiceDomainPackRegistry";
import {
  registerToolPack,
  getRegisteredToolPack,
  hasToolPack,
  clearRegistry as clearModuleRegistry,
} from "../../src/lib/modules/toolPackRegistry";

// The Module_Pack_System key the voice pack bridges to.
const BRIDGE_KEY = "logistics";

/** Two module tools already registered in the Module_Pack_System. */
const logisticsModuleTools: ToolDefinition[] = [
  {
    name: "create_shipment",
    description: "Create a new shipment",
    parameters: {},
    handler: "api/shipments/create",
  },
  {
    name: "assign_rider",
    description: "Assign a rider to a shipment",
    parameters: {},
    handler: "api/riders/assign",
  },
];

/** Voice tools that reuse the module tools above (reuse mode). */
function reusingVoiceTools(): VoiceToolDefinition[] {
  return [
    {
      name: "voice_create_shipment",
      description: "d",
      parameters: { type: "object" },
      allowedPhases: ["p1"],
      readOnly: false,
      handler: "voice/create_shipment",
      reusesModuleTool: "create_shipment",
    },
    {
      name: "voice_assign_rider",
      description: "d",
      parameters: { type: "object" },
      allowedPhases: ["p1"],
      readOnly: false,
      handler: "voice/assign_rider",
      reusesModuleTool: "assign_rider",
    },
  ];
}

/** Builds a minimal valid VoiceDomainPack with the given tools and optional bridge. */
function makePack(
  overrides: Partial<VoiceDomainPack> = {}
): VoiceDomainPack {
  return {
    id: "voice_logistics",
    name: "Voice Logistics",
    description: "",
    conversationTypes: [
      {
        type: "ct_logistics",
        initialPhase: "p1",
        transcriptMetadata: { fields: {} },
        fallbackBehavior: { kind: "escalate" },
      },
    ],
    tools: reusingVoiceTools(),
    phases: [{ id: "p1", transitions: [] }],
    defaultPrompt: "prompt",
    escalationRules: [],
    integrations: [],
    ...overrides,
  };
}

describe("Module_Pack_System bridge (Req 2.8, 2.9)", () => {
  beforeEach(() => {
    clearVoiceRegistry();
    clearModuleRegistry();
  });

  describe("reuse without duplication (Req 2.9)", () => {
    it("accepts a reuse-mode bridge to an existing tool pack and reuses its membership", () => {
      registerToolPack(BRIDGE_KEY, logisticsModuleTools);

      const pack = makePack({
        moduleBridge: {
          verticalPackId: BRIDGE_KEY,
          reuseToolPackIds: [BRIDGE_KEY],
          mode: "reuse",
        },
      });

      const result = registerVoiceDomainPack(pack);
      expect(result.ok).toBe(true);

      // The pack is resolvable by its conversation type.
      expect(resolvePackByConversationType("ct_logistics")).toBe(pack);

      // The exposed tool set is DERIVED from the linked tool pack's membership:
      // each exposed voice tool reuses one of the module tools, one-to-one.
      const exposed = resolveToolSet(pack, []);
      expect(exposed.map((t) => t.name).sort()).toEqual([
        "voice_assign_rider",
        "voice_create_shipment",
      ]);
      for (const tool of exposed) {
        expect(tool.reusesModuleTool).toBeDefined();
        expect(
          logisticsModuleTools.some(
            (mt) => mt.name === tool.reusesModuleTool
          )
        ).toBe(true);
      }
    });

    it("does not create a parallel Module_Pack_System registration", () => {
      registerToolPack(BRIDGE_KEY, logisticsModuleTools);

      const pack = makePack({
        moduleBridge: {
          verticalPackId: BRIDGE_KEY,
          reuseToolPackIds: [BRIDGE_KEY],
          mode: "reuse",
        },
      });
      expect(registerVoiceDomainPack(pack).ok).toBe(true);

      // The Module_Pack_System still holds ONLY the original registration:
      // no new key for the voice pack, and the linked pack is untouched.
      expect(hasToolPack(BRIDGE_KEY)).toBe(true);
      expect(hasToolPack(pack.id)).toBe(false);
      expect(hasToolPack("ct_logistics")).toBe(false);
      expect(getRegisteredToolPack(BRIDGE_KEY, []).map((t) => t.name)).toEqual([
        "create_shipment",
        "assign_rider",
      ]);
    });
  });

  describe("missing-target rejection (Req 2.8, 2.9)", () => {
    it("rejects a bridge to a missing verticalPackId with unknown_module_bridge and leaves the registry unchanged", () => {
      // Note: no tool pack registered — the bridge target does not exist.
      const pack = makePack({
        moduleBridge: {
          verticalPackId: "does_not_exist",
          reuseToolPackIds: [],
          mode: "reuse",
        },
      });

      const result = registerVoiceDomainPack(pack);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("unknown_module_bridge");
        expect(result.error.detail).toBe("does_not_exist");
      }

      // Registry unchanged: the rejected pack is not resolvable.
      expect(resolvePackByConversationType("ct_logistics")).toBeNull();
    });

    it("rejects a bridge whose reuseToolPackId is missing with unknown_module_bridge naming that id", () => {
      // The verticalPackId exists, but a reused tool-pack id does not.
      registerToolPack(BRIDGE_KEY, logisticsModuleTools);

      const pack = makePack({
        moduleBridge: {
          verticalPackId: BRIDGE_KEY,
          reuseToolPackIds: ["missing_tool_pack"],
          mode: "reuse",
        },
      });

      const result = registerVoiceDomainPack(pack);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("unknown_module_bridge");
        expect(result.error.detail).toBe("missing_tool_pack");
      }

      // Registry unchanged: the rejected pack is not resolvable.
      expect(resolvePackByConversationType("ct_logistics")).toBeNull();
    });
  });
});
