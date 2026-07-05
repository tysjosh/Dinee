/**
 * Feature: dinee-voice-platform, Task 4.2 — Restaurant extraction compatibility
 *
 * Validates: Requirements 1.4, 1.5
 *
 * Purpose: Assert the extracted restaurant VoiceDomainPack behaves IDENTICALLY
 * to the legacy `src/app/ws-server/call-phase.ts` state machine that the Phase 0
 * baseline (`__tests__/properties/callPathBaseline.test.ts`) pins. This is a
 * required prerequisite for the legacy-removal task 4.8: legacy branching may be
 * deleted only once this compatibility test is green.
 *
 * Three equivalences are proven, for ALL phase / event / tool combinations:
 *   1. Phase transitions — the generic `phaseEngine.nextPhase(restaurantInboundPhases, …)`
 *      reproduces the legacy `nextPhase(current, event)` exactly.
 *   2. Per-phase tool gating — the pack's per-tool `allowedPhases` (as resolved
 *      through `resolveToolSet` + `isToolCallPermitted`) matches the legacy
 *      `isToolAllowed(phase, tool)` exactly.
 *   3. Initial phase — the pack's inbound initial phase equals the legacy
 *      initial phase (`await_restaurant_id`).
 *
 * The legacy module (`call-phase.ts`) is the recorded baseline; the pack modules
 * (`src/lib/modules/packs/restaurant/`) are the extracted behavior.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// Frozen Phase 0 baseline — the recorded behavior of the legacy
// `src/app/ws-server/call-phase.ts` module, which was removed in task 4.8. The
// legacy pure functions are reproduced here verbatim as the golden reference so
// this compatibility test still asserts the extracted pack matches the recorded
// baseline without importing the deleted module.
type CallPhase =
  | "await_restaurant_id"
  | "restaurant_verified"
  | "order_open"
  | "order_finalized";

const LEGACY_ALLOWED_TOOLS: Record<CallPhase, Set<string>> = {
  await_restaurant_id: new Set(["get_restaurant_details"]),
  restaurant_verified: new Set([
    "upsert_call_data",
    "add_transcript_dialogue",
    "generate_order_id",
  ]),
  order_open: new Set([
    "upsert_order",
    "add_transcript_dialogue",
    "generate_order_id",
  ]),
  order_finalized: new Set(["add_transcript_dialogue"]),
};

function legacyIsToolAllowed(phase: CallPhase, toolName: string): boolean {
  return LEGACY_ALLOWED_TOOLS[phase]?.has(toolName) ?? false;
}

function legacyNextPhase(current: CallPhase, event: string): CallPhase {
  switch (current) {
    case "await_restaurant_id":
      if (event === "restaurant_verified") return "restaurant_verified";
      break;
    case "restaurant_verified":
      if (event === "order_id_generated") return "order_open";
      break;
    case "order_open":
      if (event === "order_finalized") return "order_finalized";
      break;
  }
  return current; // No transition
}

// Extracted restaurant pack + generic runtime.
import { nextPhase as enginePhase } from "../../src/app/ws-server/runtime/phaseEngine";
import {
  restaurantInboundPhases,
  RESTAURANT_INBOUND_INITIAL_PHASE,
} from "../../src/lib/modules/packs/restaurant/phases";
import { restaurantVoicePack } from "../../src/lib/modules/packs/restaurant";
import {
  resolveToolSet,
  isToolCallPermitted,
} from "../../src/lib/modules/voiceDomainPackRegistry";

/**
 * Every phase in the legacy state machine. Iterating this set exhaustively lets
 * us assert equivalence over the full phase domain rather than a sample.
 */
const ALL_PHASES: CallPhase[] = [
  "await_restaurant_id",
  "restaurant_verified",
  "order_open",
  "order_finalized",
];

/**
 * The legacy initial phase, as the runtime (`index.ts`) starts a restaurant
 * inbound-order call. The extracted pack must start in the same phase.
 */
const LEGACY_INITIAL_PHASE: CallPhase = "await_restaurant_id";

/**
 * Every transition event the legacy `nextPhase` recognizes, plus a couple of
 * unrecognized events to prove both engines treat unknown events as no-ops.
 */
const KNOWN_EVENTS = [
  "restaurant_verified",
  "order_id_generated",
  "order_finalized",
];
const UNKNOWN_EVENTS = ["", "unknown_event", "shipment_created", "order_open"];
const ALL_EVENTS = [...KNOWN_EVENTS, ...UNKNOWN_EVENTS];

/**
 * The universe of tool names to gate-check: every tool named in the legacy
 * `ALLOWED_TOOLS` map plus every tool the pack declares, plus a couple of names
 * neither side knows (to confirm both reject them everywhere).
 */
const LEGACY_TOOL_NAMES = [
  "get_restaurant_details",
  "upsert_call_data",
  "add_transcript_dialogue",
  "generate_order_id",
  "upsert_order",
];
const UNKNOWN_TOOL_NAMES = ["create_shipment", "nonexistent_tool"];
const ALL_TOOL_NAMES = Array.from(
  new Set([
    ...LEGACY_TOOL_NAMES,
    ...restaurantVoicePack.tools.map((tool) => tool.name),
    ...UNKNOWN_TOOL_NAMES,
  ])
);

/**
 * The restaurant flow needs no external integration, so the resolved tool set
 * is the full pack tool set. This mirrors how the runtime would build the set.
 */
const restaurantToolSet = resolveToolSet(restaurantVoicePack, []);

/**
 * The pack's phase-gating decision for a (phase, tool) pair, phrased to match
 * the legacy `isToolAllowed` boolean contract.
 */
function packToolAllowed(phase: string, toolName: string): boolean {
  return isToolCallPermitted(restaurantToolSet, toolName, phase).permitted;
}

describe("Restaurant extraction compat — initial phase (Req 1.4, 1.5)", () => {
  it("the extracted pack starts in the legacy initial phase", () => {
    expect(RESTAURANT_INBOUND_INITIAL_PHASE).toBe(LEGACY_INITIAL_PHASE);
  });

  it("the inbound-order conversation type declares the legacy initial phase", () => {
    const inbound = restaurantVoicePack.conversationTypes.find(
      (conversation) => conversation.type === "restaurant_inbound_order"
    );
    expect(inbound).toBeDefined();
    expect(inbound?.initialPhase).toBe(LEGACY_INITIAL_PHASE);
  });
});

describe("Restaurant extraction compat — phase transitions (Req 1.4, 1.5)", () => {
  it("phaseEngine reproduces legacy nextPhase for every phase × event combo", () => {
    for (const phase of ALL_PHASES) {
      for (const event of ALL_EVENTS) {
        const legacy = legacyNextPhase(phase, event);
        const extracted = enginePhase(restaurantInboundPhases, phase, event);
        expect(extracted).toBe(legacy);
      }
    }
  });

  it("phaseEngine matches legacy nextPhase for arbitrary phase/event pairs", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_PHASES),
        fc.oneof(fc.constantFrom(...ALL_EVENTS), fc.string()),
        (phase, event) => {
          const legacy = legacyNextPhase(phase, event);
          const extracted = enginePhase(restaurantInboundPhases, phase, event);
          expect(extracted).toBe(legacy);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("advances through the recorded baseline sequence identically", () => {
    // Legacy walk.
    let legacy: CallPhase = "await_restaurant_id";
    legacy = legacyNextPhase(legacy, "restaurant_verified");
    legacy = legacyNextPhase(legacy, "order_id_generated");
    legacy = legacyNextPhase(legacy, "order_finalized");

    // Extracted walk.
    let extracted: string = RESTAURANT_INBOUND_INITIAL_PHASE;
    extracted = enginePhase(restaurantInboundPhases, extracted, "restaurant_verified");
    extracted = enginePhase(restaurantInboundPhases, extracted, "order_id_generated");
    extracted = enginePhase(restaurantInboundPhases, extracted, "order_finalized");

    expect(extracted).toBe(legacy);
    expect(extracted).toBe("order_finalized");
  });
});

describe("Restaurant extraction compat — per-phase tool gating (Req 1.4, 1.5)", () => {
  it("pack gating matches legacy isToolAllowed for every phase × tool combo", () => {
    for (const phase of ALL_PHASES) {
      for (const toolName of ALL_TOOL_NAMES) {
        const legacy = legacyIsToolAllowed(phase, toolName);
        const extracted = packToolAllowed(phase, toolName);
        expect(extracted).toBe(legacy);
      }
    }
  });

  it("pack gating matches legacy isToolAllowed for arbitrary phase/tool pairs", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_PHASES),
        fc.oneof(fc.constantFrom(...ALL_TOOL_NAMES), fc.string()),
        (phase, toolName) => {
          const legacy = legacyIsToolAllowed(phase, toolName);
          const extracted = packToolAllowed(phase, toolName);
          expect(extracted).toBe(legacy);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("every legacy-permitted (phase, tool) pair is permitted by the pack, and vice versa", () => {
    // Build the legacy permitted set and the pack permitted set independently,
    // then assert they are identical.
    const legacyPermitted = new Set<string>();
    const packPermitted = new Set<string>();
    for (const phase of ALL_PHASES) {
      for (const toolName of ALL_TOOL_NAMES) {
        const key = `${phase}::${toolName}`;
        if (legacyIsToolAllowed(phase, toolName)) legacyPermitted.add(key);
        if (packToolAllowed(phase, toolName)) packPermitted.add(key);
      }
    }
    expect([...packPermitted].sort()).toEqual([...legacyPermitted].sort());
  });
});
