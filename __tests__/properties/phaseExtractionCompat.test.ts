/**
 * Feature: dinee-voice-platform, Task 4.6 — Phase-machine extraction compatibility test.
 *
 * Validates: Requirements 1.4, 1.5
 *
 * This test GATES legacy removal (task 4.8). It asserts that the generic,
 * pack-driven `phaseEngine.nextPhase(<pack>Phases, phase, event)` reproduces the
 * behavior of the legacy call-phase modules recorded against the Phase 0
 * baseline — for BOTH the restaurant and logistics verticals — including the
 * no-op behavior when an event does not match any transition in the current
 * phase.
 *
 * Legacy modules (still intact until task 4.8):
 *   - src/app/ws-server/call-phase.ts            → nextPhase (restaurant)
 *   - src/app/ws-server/logistics-call-phase.ts  → nextLogisticsPhase (logistics)
 *
 * Extracted definitions driven by the generic engine:
 *   - src/lib/modules/packs/restaurant/phases.ts → restaurantInboundPhases
 *   - src/lib/modules/packs/logistics/phases.ts  → logisticsPhases
 *   - src/app/ws-server/runtime/phaseEngine.ts   → nextPhase (generic)
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import { nextPhase as genericNextPhase } from "@/app/ws-server/runtime/phaseEngine";

import { restaurantInboundPhases } from "@/lib/modules/packs/restaurant/phases";
import { logisticsPhases } from "@/lib/modules/packs/logistics/phases";

// Frozen Phase 0 baseline — the recorded transition behavior of the legacy
// call-phase modules (`src/app/ws-server/call-phase.ts` and
// `logistics-call-phase.ts`), removed in task 4.8. Their `nextPhase` functions
// are reproduced here verbatim as the golden reference so this compatibility
// test still asserts the generic engine matches the recorded baseline without
// importing the deleted modules.
type CallPhase =
  | "await_restaurant_id"
  | "restaurant_verified"
  | "order_open"
  | "order_finalized";

type LogisticsCallPhase =
  | "await_org_verification"
  | "org_verified"
  | "shipment_open"
  | "shipment_confirmed";

function legacyRestaurantNextPhase(current: CallPhase, event: string): CallPhase {
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
  return current;
}

function legacyLogisticsNextPhase(
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
  return current;
}

// Every legacy phase for each vertical (the complete phase space).
const RESTAURANT_PHASES: CallPhase[] = [
  "await_restaurant_id",
  "restaurant_verified",
  "order_open",
  "order_finalized",
];

const LOGISTICS_PHASES: LogisticsCallPhase[] = [
  "await_org_verification",
  "org_verified",
  "shipment_open",
  "shipment_confirmed",
];

// Every event that drives a legacy transition (known events, across both
// verticals) — these are the events that must produce a real transition in the
// phase(s) that declare them, and a no-op everywhere else.
const KNOWN_TRANSITION_EVENTS = [
  // restaurant
  "restaurant_verified",
  "order_id_generated",
  "order_finalized",
  // logistics
  "org_verified",
  "shipment_created",
  "shipment_finalized",
];

// A mix of known transition events plus arbitrary strings so we also exercise
// unknown / cross-vertical events (which must be no-ops).
const eventArb = fc.oneof(
  fc.constantFrom(...KNOWN_TRANSITION_EVENTS),
  fc.string({ minLength: 0, maxLength: 40 })
);

const restaurantPhaseArb = fc.constantFrom(...RESTAURANT_PHASES);
const logisticsPhaseArb = fc.constantFrom(...LOGISTICS_PHASES);

describe("Phase-machine extraction compatibility (task 4.6, gates 4.8)", () => {
  describe("restaurant: phaseEngine + restaurantInboundPhases ≡ legacy call-phase.nextPhase", () => {
    // Deterministic exhaustive matrix over every phase × every known event.
    it("matches the legacy machine for every phase and every known transition event", () => {
      for (const phase of RESTAURANT_PHASES) {
        for (const event of KNOWN_TRANSITION_EVENTS) {
          const generic = genericNextPhase(
            restaurantInboundPhases,
            phase,
            event
          );
          const legacy = legacyRestaurantNextPhase(phase, event);
          expect(generic).toBe(legacy);
        }
      }
    });

    it("is a no-op for unknown/unmatched events in every phase", () => {
      for (const phase of RESTAURANT_PHASES) {
        for (const event of ["", "unknown", "shipment_created", "  "]) {
          const generic = genericNextPhase(
            restaurantInboundPhases,
            phase,
            event
          );
          const legacy = legacyRestaurantNextPhase(phase, event);
          expect(generic).toBe(legacy);
          // Unknown events never advance the phase.
          expect(generic).toBe(phase);
        }
      }
    });

    it("agrees with the legacy machine for every (phase, event) pair", () => {
      fc.assert(
        fc.property(restaurantPhaseArb, eventArb, (phase, event) => {
          const generic = genericNextPhase(
            restaurantInboundPhases,
            phase,
            event
          );
          const legacy = legacyRestaurantNextPhase(phase, event);
          expect(generic).toBe(legacy);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe("logistics: phaseEngine + logisticsPhases ≡ legacy logistics-call-phase.nextLogisticsPhase", () => {
    it("matches the legacy machine for every phase and every known transition event", () => {
      for (const phase of LOGISTICS_PHASES) {
        for (const event of KNOWN_TRANSITION_EVENTS) {
          const generic = genericNextPhase(logisticsPhases, phase, event);
          const legacy = legacyLogisticsNextPhase(phase, event);
          expect(generic).toBe(legacy);
        }
      }
    });

    it("is a no-op for unknown/unmatched events in every phase", () => {
      for (const phase of LOGISTICS_PHASES) {
        for (const event of ["", "unknown", "order_finalized", "  "]) {
          const generic = genericNextPhase(logisticsPhases, phase, event);
          const legacy = legacyLogisticsNextPhase(phase, event);
          expect(generic).toBe(legacy);
          expect(generic).toBe(phase);
        }
      }
    });

    it("agrees with the legacy machine for every (phase, event) pair", () => {
      fc.assert(
        fc.property(logisticsPhaseArb, eventArb, (phase, event) => {
          const generic = genericNextPhase(logisticsPhases, phase, event);
          const legacy = legacyLogisticsNextPhase(phase, event);
          expect(generic).toBe(legacy);
        }),
        { numRuns: 100 }
      );
    });
  });
});
