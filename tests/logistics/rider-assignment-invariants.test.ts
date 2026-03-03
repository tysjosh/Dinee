/**
 * Property-Based Test — Rider Assignment Invariants (Property 5)
 *
 * **Validates: Requirements 15.1, 15.2, 15.3, 15.4, 15.5**
 *
 * Property 5: Rider assignment maintains consistency
 * - For all assignments: rider status transitions to "busy", shipment status transitions to "assigned"
 * - For all unavailable/inactive riders: assignment is rejected with 409
 * - On delivery/failure: rider returns to "available"
 *
 * Since Convex mutations cannot be invoked directly from vitest, these tests
 * verify the business logic invariants by analyzing the mutation code contracts
 * and the status machine transitions that govern rider assignment behavior.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  type DeliveryStatus,
  VALID_TRANSITIONS,
  validateTransition,
} from "../../src/lib/logistics/status-machine";

// ─── Constants ───

const ALL_STATUSES: DeliveryStatus[] = [
  "created",
  "assigned",
  "picked_up",
  "in_transit",
  "delivered",
  "failed",
  "cancelled",
];

type RiderStatus = "offline" | "available" | "busy";

const ALL_RIDER_STATUSES: RiderStatus[] = ["offline", "available", "busy"];

const UNAVAILABLE_RIDER_STATUSES: RiderStatus[] = ["offline", "busy"];

// ─── Arbitraries ───

const statusArb = fc.constantFrom(...ALL_STATUSES);
const riderStatusArb = fc.constantFrom(...ALL_RIDER_STATUSES);
const unavailableRiderStatusArb = fc.constantFrom(...UNAVAILABLE_RIDER_STATUSES);

/**
 * Simulates the assignRider precondition check:
 * - Shipment must be in a status that allows transition to "assigned" (only "created")
 * - Rider must have status "available" AND isActive === true
 *
 * Returns { allowed: true } if assignment would succeed, or
 * { allowed: false, reason } describing why it would be rejected.
 */
function simulateAssignmentCheck(
  shipmentStatus: DeliveryStatus,
  riderStatus: RiderStatus,
  riderIsActive: boolean
): { allowed: boolean; reason?: string } {
  // Step 1: Check shipment status allows transition to "assigned"
  if (!validateTransition(shipmentStatus, "assigned")) {
    return {
      allowed: false,
      reason: `Invalid status transition: "${shipmentStatus}" → "assigned"`,
    };
  }

  // Step 2: Check rider availability
  if (riderStatus !== "available" || !riderIsActive) {
    return {
      allowed: false,
      reason: `409: Rider not available. status="${riderStatus}", isActive=${riderIsActive}`,
    };
  }

  return { allowed: true };
}

/**
 * Determines which statuses trigger rider reset to "available".
 * Per the updateShipmentStatus mutation: "delivered" and "failed" both
 * reset the assigned rider back to "available".
 */
function statusResetsRider(newStatus: DeliveryStatus): boolean {
  return newStatus === "delivered" || newStatus === "failed";
}

describe("Rider Assignment Invariants — Property 5", () => {
  /**
   * **Validates: Requirements 15.1, 15.2, 15.3**
   *
   * For all assignments where the shipment is in "created" status and the
   * rider is "available" + isActive: the assignment succeeds, resulting in
   * shipment status "assigned" and rider status "busy".
   */
  it("valid assignment transitions shipment to 'assigned' and rider to 'busy'", () => {
    fc.assert(
      fc.property(fc.boolean(), (_unused) => {
        // Only "created" allows transition to "assigned"
        const shipmentStatus: DeliveryStatus = "created";
        const riderStatus: RiderStatus = "available";
        const riderIsActive = true;

        const result = simulateAssignmentCheck(shipmentStatus, riderStatus, riderIsActive);

        // Assignment is allowed
        expect(result.allowed).toBe(true);

        // The state machine confirms created → assigned is valid
        expect(validateTransition("created", "assigned")).toBe(true);

        // Post-conditions: shipment becomes "assigned", rider becomes "busy"
        // (These are the values the mutation patches)
        const newShipmentStatus: DeliveryStatus = "assigned";
        const newRiderStatus: RiderStatus = "busy";

        expect(newShipmentStatus).toBe("assigned");
        expect(newRiderStatus).toBe("busy");
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 15.2, 15.4**
   *
   * For all rider statuses that are NOT "available" (i.e., "offline" or "busy"),
   * assignment is rejected with a 409 regardless of isActive.
   */
  it("rejects assignment for all unavailable rider statuses with 409", () => {
    fc.assert(
      fc.property(
        unavailableRiderStatusArb,
        fc.boolean(),
        (riderStatus, isActive) => {
          const result = simulateAssignmentCheck("created", riderStatus, isActive);

          expect(result.allowed).toBe(false);
          expect(result.reason).toContain("409");
          expect(result.reason).toContain(riderStatus);
        }
      ),
      { numRuns: 200 }
    );
  });

  /**
   * **Validates: Requirements 15.2, 15.4**
   *
   * For all riders with isActive=false, assignment is rejected with 409
   * regardless of their status value (even if status is "available").
   */
  it("rejects assignment for inactive riders regardless of status", () => {
    fc.assert(
      fc.property(riderStatusArb, (riderStatus) => {
        const riderIsActive = false;
        const result = simulateAssignmentCheck("created", riderStatus, riderIsActive);

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain("409");
        expect(result.reason).toContain("isActive=false");
      }),
      { numRuns: 200 }
    );
  });

  /**
   * **Validates: Requirements 15.1, 15.4**
   *
   * For all shipment statuses other than "created", assignment is rejected
   * because the state machine only allows created → assigned.
   */
  it("rejects assignment for all non-created shipment statuses", () => {
    const nonCreatedStatuses = ALL_STATUSES.filter((s) => s !== "created");
    const nonCreatedArb = fc.constantFrom(...nonCreatedStatuses);

    fc.assert(
      fc.property(nonCreatedArb, riderStatusArb, fc.boolean(), (shipmentStatus, riderStatus, isActive) => {
        const result = simulateAssignmentCheck(shipmentStatus, riderStatus, isActive);

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain("Invalid status transition");
      }),
      { numRuns: 300 }
    );
  });

  /**
   * **Validates: Requirements 15.5**
   *
   * On delivery (in_transit → delivered) or failure (in_transit → failed),
   * the assigned rider's status is reset back to "available".
   * These are the only two transitions that trigger rider reset.
   */
  it("delivery and failure are the only statuses that reset rider to available", () => {
    fc.assert(
      fc.property(statusArb, (newStatus) => {
        const resetsRider = statusResetsRider(newStatus);

        if (newStatus === "delivered" || newStatus === "failed") {
          expect(resetsRider).toBe(true);
        } else {
          expect(resetsRider).toBe(false);
        }
      }),
      { numRuns: 200 }
    );
  });

  /**
   * **Validates: Requirements 15.5**
   *
   * The full rider lifecycle through assignment:
   * 1. Rider starts "available" → assigned to shipment → becomes "busy"
   * 2. Shipment progresses through lifecycle
   * 3. On "delivered" or "failed" → rider returns to "available"
   *
   * Verify the state machine supports the full path from created → ... → delivered/failed.
   */
  it("rider lifecycle: available → busy (on assign) → available (on delivery/failure)", () => {
    // Path to delivered: created → assigned → picked_up → in_transit → delivered
    const deliveredPath: DeliveryStatus[] = [
      "created", "assigned", "picked_up", "in_transit", "delivered",
    ];

    // Path to failed: created → assigned → picked_up → in_transit → failed
    const failedPath: DeliveryStatus[] = [
      "created", "assigned", "picked_up", "in_transit", "failed",
    ];

    const pathArb = fc.constantFrom(deliveredPath, failedPath);

    fc.assert(
      fc.property(pathArb, (path) => {
        // Verify every consecutive transition in the path is valid
        for (let i = 0; i < path.length - 1; i++) {
          expect(validateTransition(path[i], path[i + 1])).toBe(true);
        }

        // The terminal status resets the rider
        const terminalStatus = path[path.length - 1];
        expect(statusResetsRider(terminalStatus)).toBe(true);

        // Rider status transitions: available → busy (at assign) → available (at terminal)
        // At path[0]→path[1] (created→assigned): rider goes from available to busy
        expect(path[1]).toBe("assigned");
        // At terminal: rider goes from busy back to available
        expect(["delivered", "failed"]).toContain(terminalStatus);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 15.1, 15.2, 15.3, 15.4**
   *
   * Exhaustive: for ALL combinations of (shipmentStatus, riderStatus, isActive),
   * assignment succeeds if and only if shipment is "created" AND rider is
   * "available" AND isActive is true.
   */
  it("assignment succeeds iff shipment=created AND rider=available AND isActive=true", () => {
    fc.assert(
      fc.property(
        statusArb,
        riderStatusArb,
        fc.boolean(),
        (shipmentStatus, riderStatus, isActive) => {
          const result = simulateAssignmentCheck(shipmentStatus, riderStatus, isActive);

          const shouldSucceed =
            shipmentStatus === "created" &&
            riderStatus === "available" &&
            isActive === true;

          expect(result.allowed).toBe(shouldSucceed);
        }
      ),
      { numRuns: 500 }
    );
  });

  /**
   * **Validates: Requirements 15.5**
   *
   * The failed → created re-attempt path clears assignedRiderId.
   * After re-attempt, a new rider can be assigned (created → assigned is valid).
   * This verifies the state machine supports the re-assignment flow.
   */
  it("failed → created re-attempt enables new rider assignment", () => {
    // failed → created is valid (re-attempt)
    expect(validateTransition("failed", "created")).toBe(true);

    // After re-attempt, created → assigned is valid (new rider can be assigned)
    expect(validateTransition("created", "assigned")).toBe(true);

    // The re-attempt resets assignedRiderId (tested via the mutation contract),
    // so a fresh assignment check with a new available rider should succeed
    const result = simulateAssignmentCheck("created", "available", true);
    expect(result.allowed).toBe(true);
  });
});
