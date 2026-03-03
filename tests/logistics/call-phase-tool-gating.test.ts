/**
 * Property-Based Test — Logistics Call Phase Tool Gating (Property 10)
 *
 * **Validates: Requirements 27.1, 27.2, 27.4**
 *
 * Property 10: Tools are only accessible in their allowed phases
 * - For all (phase, tool) pairs not in ALLOWED_TOOLS: isLogisticsToolAllowed returns false
 * - For all (phase, tool) pairs in ALLOWED_TOOLS: returns true
 * - No shipment mutation tools are accessible in await_org_verification phase
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  type LogisticsCallPhase,
  isLogisticsToolAllowed,
  nextLogisticsPhase,
} from "../../src/app/ws-server/logistics-call-phase";

const ALL_PHASES: LogisticsCallPhase[] = [
  "await_org_verification",
  "org_verified",
  "shipment_open",
  "shipment_confirmed",
];

const ALL_TOOLS: string[] = [
  "get_organization_details",
  "create_shipment",
  "quote_delivery",
  "update_shipment",
  "assign_rider",
  "add_shipment_event",
];

const SHIPMENT_MUTATION_TOOLS: string[] = [
  "create_shipment",
  "update_shipment",
  "assign_rider",
  "add_shipment_event",
];

/** The ground-truth allowed tools map, mirroring the source module. */
const ALLOWED_TOOLS: Record<LogisticsCallPhase, Set<string>> = {
  await_org_verification: new Set(["get_organization_details"]),
  org_verified: new Set(["create_shipment", "quote_delivery"]),
  shipment_open: new Set(["update_shipment", "assign_rider", "add_shipment_event"]),
  shipment_confirmed: new Set(["add_shipment_event"]),
};

const phaseArb = fc.constantFrom(...ALL_PHASES);
const toolArb = fc.constantFrom(...ALL_TOOLS);

describe("Logistics Call Phase Tool Gating — Property 10", () => {
  /**
   * **Validates: Requirements 27.1, 27.2**
   *
   * For all (phase, tool) pairs NOT in ALLOWED_TOOLS,
   * isLogisticsToolAllowed must return false.
   */
  it("rejects all disallowed (phase, tool) pairs", () => {
    fc.assert(
      fc.property(phaseArb, toolArb, (phase, tool) => {
        const isAllowed = ALLOWED_TOOLS[phase].has(tool);
        if (!isAllowed) {
          expect(isLogisticsToolAllowed(phase, tool)).toBe(false);
        }
      }),
      { numRuns: 300 },
    );
  });

  /**
   * **Validates: Requirements 27.1**
   *
   * For all (phase, tool) pairs IN ALLOWED_TOOLS,
   * isLogisticsToolAllowed must return true.
   */
  it("permits all allowed (phase, tool) pairs", () => {
    fc.assert(
      fc.property(phaseArb, toolArb, (phase, tool) => {
        const isAllowed = ALLOWED_TOOLS[phase].has(tool);
        if (isAllowed) {
          expect(isLogisticsToolAllowed(phase, tool)).toBe(true);
        }
      }),
      { numRuns: 300 },
    );
  });

  /**
   * **Validates: Requirements 27.4**
   *
   * No shipment mutation tools (create_shipment, update_shipment,
   * assign_rider, add_shipment_event) are accessible in the
   * await_org_verification phase.
   */
  it("blocks all shipment mutation tools in await_org_verification phase", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SHIPMENT_MUTATION_TOOLS),
        (tool) => {
          expect(isLogisticsToolAllowed("await_org_verification", tool)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 27.2**
   *
   * Unknown tools (not in any phase's allowed set) are always rejected
   * regardless of the current phase.
   */
  it("rejects unknown tools in every phase", () => {
    const unknownToolArb = fc.string({ minLength: 1, maxLength: 30 }).filter(
      (s) => !ALL_TOOLS.includes(s),
    );

    fc.assert(
      fc.property(phaseArb, unknownToolArb, (phase, unknownTool) => {
        expect(isLogisticsToolAllowed(phase, unknownTool)).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 27.1**
   *
   * Phase transitions follow the expected sequence. Unknown events
   * do not change the phase.
   */
  it("phase transitions follow the expected sequence and unknown events are no-ops", () => {
    // Valid transitions
    expect(nextLogisticsPhase("await_org_verification", "org_verified")).toBe("org_verified");
    expect(nextLogisticsPhase("org_verified", "shipment_created")).toBe("shipment_open");
    expect(nextLogisticsPhase("shipment_open", "shipment_finalized")).toBe("shipment_confirmed");

    // Unknown events leave phase unchanged
    fc.assert(
      fc.property(
        phaseArb,
        fc.string({ minLength: 1, maxLength: 30 }).filter(
          (e) => !["org_verified", "shipment_created", "shipment_finalized"].includes(e),
        ),
        (phase, unknownEvent) => {
          expect(nextLogisticsPhase(phase, unknownEvent)).toBe(phase);
        },
      ),
      { numRuns: 200 },
    );
  });
});
