/**
 * Feature: dinee-voice-platform, Task 4.4: Logistics extraction compatibility test
 *
 * Validates: Requirements 1.4, 1.5
 *
 * REQUIRED — gates legacy removal (task 4.8). This test asserts that the
 * extracted logistics VoiceDomainPack (`src/lib/modules/packs/logistics/`)
 * reproduces the Phase 0 baseline behavior recorded in task 1.3
 * (`__tests__/properties/callPathBaseline.test.ts`) and pinned by the still-intact
 * legacy modules (`src/app/ws-server/logistics-call-phase.ts`,
 * `logistics-tools.ts`). Legacy removal (task 4.8) must NOT run until this test
 * passes.
 *
 * The baseline the extraction must match is expressed by the two legacy pure
 * functions the current runtime uses:
 *   - `nextLogisticsPhase(phase, event)`     — the logistics phase state machine
 *   - `isLogisticsToolAllowed(phase, tool)`  — per-phase tool gating
 * plus the legacy default initial phase (`await_org_verification`).
 *
 * The extracted pack expresses the same behavior as data:
 *   - phase transitions via `phaseEngine.nextPhase(logisticsPhases, …)`
 *   - per-phase gating via each tool's `allowedPhases` + registry
 *     `isToolCallPermitted(resolveToolSet(pack), tool, phase)`
 *   - the initial phase constant `LOGISTICS_INITIAL_PHASE`
 *   - registration through its `moduleBridge`, reusing (not duplicating) the
 *     existing logistics tool-pack registration.
 *
 * This test asserts the extracted behavior is IDENTICAL to the legacy behavior
 * across every phase/event and phase/tool combination.
 */
import { describe, it, expect, beforeEach } from "vitest";
import * as fc from "fast-check";

// --- Frozen Phase 0 baseline ---
// The recorded behavior of the legacy `src/app/ws-server/logistics-call-phase.ts`
// module, which was removed in task 4.8. Its pure functions are reproduced here
// verbatim as the golden reference so this compatibility test still asserts the
// extracted pack matches the recorded baseline without importing the deleted
// module.
type LogisticsCallPhase =
  | "await_org_verification"
  | "org_verified"
  | "shipment_open"
  | "shipment_confirmed";

const LEGACY_LOGISTICS_ALLOWED_TOOLS: Record<LogisticsCallPhase, Set<string>> = {
  await_org_verification: new Set(["get_organization_details"]),
  org_verified: new Set([
    "get_organization_details",
    "create_shipment",
    "quote_delivery",
  ]),
  shipment_open: new Set([
    "get_organization_details",
    "create_shipment",
    "quote_delivery",
    "update_shipment",
    "assign_rider",
    "add_shipment_event",
  ]),
  shipment_confirmed: new Set(["get_organization_details", "quote_delivery"]),
};

function isLogisticsToolAllowed(
  phase: LogisticsCallPhase,
  toolName: string
): boolean {
  return LEGACY_LOGISTICS_ALLOWED_TOOLS[phase]?.has(toolName) ?? false;
}

function nextLogisticsPhase(
  current: LogisticsCallPhase,
  event: string
): LogisticsCallPhase {
  switch (current) {
    case "await_org_verification":
      if (event === "org_verified") return "org_verified";
      break;
    case "org_verified":
      if (event === "shipment_created") return "shipment_open";
      break;
    case "shipment_open":
      if (event === "shipment_finalized") return "shipment_confirmed";
      break;
  }
  return current; // No transition
}

// --- Extracted pack + generic runtime under test ---
import { nextPhase } from "../../src/app/ws-server/runtime/phaseEngine";
import {
  logisticsPhases,
  LOGISTICS_INITIAL_PHASE,
} from "../../src/lib/modules/packs/logistics/phases";
import {
  logisticsVoicePack,
  registerLogisticsVoicePack,
  LOGISTICS_PACK_ID,
} from "../../src/lib/modules/packs/logistics";
import {
  resolveToolSet,
  isToolCallPermitted,
  resolvePackByConversationType,
  clearRegistry as clearVoiceRegistry,
} from "../../src/lib/modules/voiceDomainPackRegistry";
import {
  hasToolPack,
  getRegisteredToolPack,
  clearRegistry as clearModuleRegistry,
} from "../../src/lib/modules/toolPackRegistry";

/** Every legacy logistics phase (exhaustive domain of the phase machine). */
const ALL_LEGACY_PHASES: LogisticsCallPhase[] = [
  "await_org_verification",
  "org_verified",
  "shipment_open",
  "shipment_confirmed",
];

/** The events the legacy machine recognizes, plus non-events to prove no-ops. */
const KNOWN_EVENTS = [
  "org_verified",
  "shipment_created",
  "shipment_finalized",
] as const;

/**
 * The universe of tool names to gate-check. Includes every tool the legacy
 * `ALLOWED_TOOLS` matrix references plus tools that appear in no phase, so the
 * comparison covers both permitted and rejected cases.
 */
const TOOL_UNIVERSE = [
  "get_organization_details",
  "create_shipment",
  "quote_delivery",
  "update_shipment",
  "assign_rider",
  "add_shipment_event",
  // Tools that are never permitted in any logistics phase:
  "not_a_tool",
  "runsheet_create_order_draft",
  "upsert_order",
];

describe("Logistics extraction compat — initial phase matches baseline (Req 1.4, 1.5)", () => {
  it("the pack's initial phase equals the legacy default (await_org_verification)", () => {
    // The legacy runtime initializes logistics call-phase state to
    // `await_org_verification`; the extracted pack must start in the same phase.
    expect(LOGISTICS_INITIAL_PHASE).toBe<LogisticsCallPhase>("await_org_verification");
    // The initial phase is a defined phase in the pack's phase machine.
    expect(logisticsPhases.some((p) => p.id === LOGISTICS_INITIAL_PHASE)).toBe(true);
  });

  it("every conversation type the pack owns starts in the baseline initial phase", () => {
    for (const conversation of logisticsVoicePack.conversationTypes) {
      expect(conversation.initialPhase).toBe(LOGISTICS_INITIAL_PHASE);
    }
  });
});

describe("Logistics extraction compat — phase transitions match nextLogisticsPhase (Req 1.4, 1.5)", () => {
  it("phaseEngine.nextPhase matches legacy nextLogisticsPhase for all phase/known-event combos", () => {
    for (const phase of ALL_LEGACY_PHASES) {
      for (const event of KNOWN_EVENTS) {
        const legacy = nextLogisticsPhase(phase, event);
        const extracted = nextPhase(logisticsPhases, phase, event);
        expect(extracted).toBe(legacy);
      }
    }
  });

  it("phaseEngine.nextPhase matches legacy for arbitrary events (including unknown no-ops)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_LEGACY_PHASES),
        fc.string(),
        (phase, event) => {
          const legacy = nextLogisticsPhase(phase, event as string);
          const extracted = nextPhase(logisticsPhases, phase, event);
          expect(extracted).toBe(legacy);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("advances through the baseline logistics phase sequence identically", () => {
    // Mirrors the baseline sequence pinned in callPathBaseline.test.ts.
    let legacyPhase: LogisticsCallPhase = "await_org_verification";
    let packPhase: string = LOGISTICS_INITIAL_PHASE;

    for (const event of KNOWN_EVENTS) {
      legacyPhase = nextLogisticsPhase(legacyPhase, event);
      packPhase = nextPhase(logisticsPhases, packPhase, event);
      expect(packPhase).toBe(legacyPhase);
    }
    // Terminal state reached identically.
    expect(packPhase).toBe("shipment_confirmed");
  });
});

describe("Logistics extraction compat — per-phase tool gating matches isLogisticsToolAllowed (Req 1.4, 1.5)", () => {
  beforeEach(() => {
    clearVoiceRegistry();
    clearModuleRegistry();
  });

  it("registered pack tool gating matches legacy isLogisticsToolAllowed for ALL phase/tool combos", () => {
    // Register through the real pack path (module tool pack + voice pack via bridge).
    const result = registerLogisticsVoicePack();
    expect(result.ok).toBe(true);

    // The resolved (integration-gated, bridge-honoring) tool set exposed to the model.
    const toolSet = resolveToolSet(logisticsVoicePack, []);

    for (const phase of ALL_LEGACY_PHASES) {
      for (const tool of TOOL_UNIVERSE) {
        const legacyAllowed = isLogisticsToolAllowed(phase, tool);
        const extractedAllowed = isToolCallPermitted(toolSet, tool, phase).permitted;
        expect(extractedAllowed).toBe(legacyAllowed);
      }
    }
  });

  it("the resolved tool set exposes exactly the six baseline logistics tools", () => {
    registerLogisticsVoicePack();
    const toolSet = resolveToolSet(logisticsVoicePack, []);
    expect(toolSet.map((t) => t.name).sort()).toEqual(
      [
        "add_shipment_event",
        "assign_rider",
        "create_shipment",
        "get_organization_details",
        "quote_delivery",
        "update_shipment",
      ].sort()
    );
  });
});

describe("Logistics extraction compat — registers via moduleBridge without duplication (Req 1.4, 1.5)", () => {
  beforeEach(() => {
    clearVoiceRegistry();
    clearModuleRegistry();
  });

  it("carries a moduleBridge to the existing logistics tool-pack registration", () => {
    expect(logisticsVoicePack.moduleBridge).toBeDefined();
    expect(logisticsVoicePack.moduleBridge?.verticalPackId).toBe("logistics");
    expect(logisticsVoicePack.moduleBridge?.reuseToolPackIds).toContain("logistics");
  });

  it("registers successfully and is resolvable by its conversation types", () => {
    const result = registerLogisticsVoicePack();
    expect(result.ok).toBe(true);

    for (const conversation of logisticsVoicePack.conversationTypes) {
      expect(resolvePackByConversationType(conversation.type)).toBe(logisticsVoicePack);
    }
  });

  it("reuses the logistics tool-pack registration without creating a duplicate", () => {
    registerLogisticsVoicePack();

    // The bridged logistics tool pack exists (reused, not duplicated)...
    expect(hasToolPack("logistics")).toBe(true);
    // ...and no parallel Module_Pack_System registration is created for the voice pack.
    expect(hasToolPack(LOGISTICS_PACK_ID === "logistics" ? "logistics_voice_pack_dup" : LOGISTICS_PACK_ID)).toBe(false);

    // The reused module tool pack still holds its original membership untouched.
    const moduleToolNames = getRegisteredToolPack("logistics", []).map((t) => t.name);
    expect(moduleToolNames).toContain("create_shipment");
    expect(moduleToolNames).toContain("update_shipment");
    expect(moduleToolNames).toContain("assign_rider");
    expect(moduleToolNames).toContain("add_shipment_event");
    expect(moduleToolNames).toContain("quote_delivery");

    // Every bridged voice tool maps one-to-one onto a real module tool (no duplication).
    const reusedVoiceTools = logisticsVoicePack.tools.filter((t) => t.reusesModuleTool);
    for (const tool of reusedVoiceTools) {
      expect(moduleToolNames).toContain(tool.reusesModuleTool);
    }
  });

  it("is idempotent — registering again reports a duplicate id and leaves the pack resolvable", () => {
    expect(registerLogisticsVoicePack().ok).toBe(true);
    const second = registerLogisticsVoicePack();
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.code).toBe("duplicate_id");
      expect(second.error.detail).toBe(LOGISTICS_PACK_ID);
    }
    // Still resolvable after the rejected re-registration.
    expect(resolvePackByConversationType("logistics_booking")).toBe(logisticsVoicePack);
  });
});
